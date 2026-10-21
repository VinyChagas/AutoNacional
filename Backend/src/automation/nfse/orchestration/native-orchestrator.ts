/**
 * Orquestra descoberta → exclusividade → plano → retomada → recuperação → auditoria.
 * Recebe Page já autenticada e dependências injetadas. Não cria navegador nem CAPTCHA.
 * A trava do Commit 05 cobre a sequência crítica (checkpoint até auditoria).
 */
import { normalizarCnpjEmpresa } from '../contracts/documento-fiscal';
import { ContratoNfseError } from '../contracts/erros';
import { montarInventario, type InventarioNfse } from '../contracts/inventario';
import { criarPeriodoConsultaPortal, type PeriodoConsultaPortal } from '../contracts/periodo';
import { CheckpointNfseError } from '../checkpoint';
import { planejarRecuperacaoSefin } from '../recovery/recovery-service';
import {
  montarAuditoriaFiscal,
  persistirAuditoriaFiscal,
  criarResolvedorRaizInjetada,
  raizFiscalDistintaDeDownloads,
} from '../infrastructure';
import { mascararChaveNacional } from '../infrastructure/types';
import {
  OrquestracaoNfseError,
  type DependenciasFluxoFiscalNativo,
  type EntradaFluxoFiscalNativo,
  type ResultadoFluxoFiscalNativo,
} from './types';

const JA_COM_TRAVA = { jaComTrava: true } as const;

export async function executarFluxoFiscalNativo(
  entrada: EntradaFluxoFiscalNativo
): Promise<ResultadoFluxoFiscalNativo> {
  if (!entrada.page) {
    throw new OrquestracaoNfseError('PAGE_AUSENTE', 'Page autenticada ausente para o fluxo nativo.');
  }

  let cnpj: string;
  let periodo: PeriodoConsultaPortal;
  try {
    cnpj = normalizarCnpjEmpresa(entrada.cnpj);
  } catch (erro) {
    if (erro instanceof ContratoNfseError) {
      throw new OrquestracaoNfseError('CNPJ_INVALIDO', erro.message);
    }
    throw erro;
  }
  try {
    periodo = criarPeriodoConsultaPortal(entrada.periodoConsulta.inicio, entrada.periodoConsulta.fim);
  } catch (erro) {
    if (erro instanceof ContratoNfseError) {
      throw new OrquestracaoNfseError('PERIODO_INVALIDO', erro.message);
    }
    throw erro;
  }

  // API-02K — nativo é XML-only: baixarPdf não bloqueia; PDF não é recuperado.
  const avisoPdf = entrada.baixarPdf;

  if (!entrada.raizFiscal?.trim()) {
    throw new OrquestracaoNfseError('RAIZ_FISCAL_AUSENTE', 'Raiz fiscal nativa não configurada.');
  }
  if (!raizFiscalDistintaDeDownloads(entrada.raizFiscal, './downloads')) {
    throw new OrquestracaoNfseError(
      'RAIZ_FISCAL_AUSENTE',
      'Raiz fiscal não pode coincidir com o diretório operacional de downloads.'
    );
  }

  const deps = entrada.dependencias;
  let inventario: InventarioNfse;
  let resumoFalhasDescoberta: string[] = [];
  try {
    const descoberta = await descobrirInventario(entrada, deps, cnpj, periodo);
    inventario = descoberta.inventario;
    resumoFalhasDescoberta = descoberta.resumoFalhasDescoberta;
  } finally {
    // API-02Q — Chromium só serve à descoberta Portal; SEFIN é mTLS sem browser.
    await liberarNavegadorAposDescoberta(entrada);
  }

  if (inventario.completude !== 'COMPLETO') {
    const detalhe =
      resumoFalhasDescoberta.length > 0
        ? ` Inventário incompleto: ${resumoFalhasDescoberta.join(' · ')}`
        : ' Inventário incompleto bloqueia a recuperação nativa.';
    throw new OrquestracaoNfseError('DESCOBERTA_INCOMPLETA', detalhe.trim());
  }
  if (inventario.totais.indeterminadas > 0) {
    throw new OrquestracaoNfseError(
      'SITUACAO_INDETERMINADA',
      'Nota indeterminada bloqueia a recuperação automática.'
    );
  }

  // Descoberta completa sem documentos (ex.: emitidas+recebidas vazias) → SEM_MOVIMENTO, sem SEFIN.
  if (inventario.totais.descobertos === 0) {
    const resultado = resultadoSemMovimento(entrada, cnpj, periodo, inventario);
    if (avisoPdf) {
      resultado.compatibilidadePdf = 'PDF_NAO_RECUPERADO';
      resultado.diagnosticos.push({
        codigo: 'PDF_NAO_RECUPERADO',
        mensagem: 'Fluxo Portal+SEFIN é XML-only; DANFS-e/PDF não será recuperado nesta execução.',
      });
    }
    return resultado;
  }

  let credencial;
  try {
    credencial = await deps.provedorA1.obter(cnpj);
  } catch {
    throw new OrquestracaoNfseError(
      'CERTIFICADO_INDISPONIVEL',
      'Certificado A1 indisponível para a recuperação SEFIN.'
    );
  }

  try {
    const resultado = await deps.repositorio.executarComExclusividadeFiscal(cnpj, periodo, async () =>
      executarSequenciaCritica(entrada, deps, cnpj, periodo, inventario, credencial)
    );
    if (avisoPdf) {
      resultado.compatibilidadePdf = 'PDF_NAO_RECUPERADO';
      resultado.diagnosticos.push({
        codigo: 'PDF_NAO_RECUPERADO',
        mensagem: 'Fluxo Portal+SEFIN é XML-only; DANFS-e/PDF não será recuperado nesta execução.',
      });
    }
    return resultado;
  } catch (erro) {
    if (erro instanceof OrquestracaoNfseError) throw erro;
    if (erro instanceof CheckpointNfseError && erro.codigo === 'CHECKPOINT_EM_USO') {
      throw new OrquestracaoNfseError(
        'EXECUCAO_EM_USO',
        'Já existe execução nativa para este CNPJ e período.'
      );
    }
    throw erro;
  }
}

async function liberarNavegadorAposDescoberta(entrada: EntradaFluxoFiscalNativo): Promise<void> {
  if (!entrada.liberarNavegadorAposDescoberta) return;
  try {
    await entrada.liberarNavegadorAposDescoberta();
  } catch {
    /* fechamento best-effort; SEFIN/mTLS não depende da Page */
  }
}

function resultadoSemMovimento(
  entrada: EntradaFluxoFiscalNativo,
  cnpj: string,
  periodo: PeriodoConsultaPortal,
  inventario: InventarioNfse
): ResultadoFluxoFiscalNativo {
  return {
    modo: 'NATIVO_CONTROLADO',
    execucaoId: entrada.execucaoId,
    cnpj,
    periodoConsulta: periodo,
    inventario,
    descobertos: 0,
    vigentes: 0,
    canceladas: 0,
    indeterminadas: 0,
    persistidos: 0,
    pendentes: 0,
    coberturaPercentual: 100,
    conclusaoReconciliacao: 'RECONCILIADA',
    estadoAuditoria: null,
    caminhoAuditoria: null,
    documentosAptos: [],
    loteLiberado: true,
    compatibilidadePdf: 'NAO_APLICAVEL',
    diagnosticos: [
      {
        codigo: 'SEM_MOVIMENTO',
        mensagem: 'Descoberta completa sem documentos — SEFIN não acionado.',
      },
    ],
    recuperacoes: [],
  };
}

async function executarSequenciaCritica(
  entrada: EntradaFluxoFiscalNativo,
  deps: DependenciasFluxoFiscalNativo,
  cnpj: string,
  periodo: PeriodoConsultaPortal,
  inventario: InventarioNfse,
  credencial: Awaited<ReturnType<DependenciasFluxoFiscalNativo['provedorA1']['obter']>>
): Promise<ResultadoFluxoFiscalNativo> {
  const diagnosticos: ResultadoFluxoFiscalNativo['diagnosticos'] = [];
  const recuperacoes: ResultadoFluxoFiscalNativo['recuperacoes'] = [];

  const plano = planejarRecuperacaoSefin(inventario);
  if (!plano.podeIniciar) {
    throw new OrquestracaoNfseError(
      'PLANEJAMENTO_BLOQUEADO',
      plano.mensagem || 'Planejamento SEFIN bloqueado.'
    );
  }

  await deps.repositorio.criarCheckpoint(inventario, entrada.execucaoId, JA_COM_TRAVA);
  const retomada = await deps.repositorio.retomar(inventario, JA_COM_TRAVA);
  if (!retomada.podeRetomarAutomaticamente) {
    throw new OrquestracaoNfseError(
      'SITUACAO_INDETERMINADA',
      'Retomada automática bloqueada pelo checkpoint.'
    );
  }

  // Checkpoint atualizado pela retomada (órfãos / inconsistências).
  let checkpointAtual = retomada.checkpoint;

  for (const documento of plano.elegiveis) {
    const noCheckpoint = checkpointAtual.documentos.find(
      (item) => item.chaveNacional === documento.chaveNacional
    );
    if (noCheckpoint?.estado === 'PERSISTIDO') continue;
    if (noCheckpoint?.estado === 'FALHA_PERMANENTE' || noCheckpoint?.estado === 'INCONSISTENTE') {
      recuperacoes.push({
        chaveMascarada: mascararChaveNacional(documento.chaveNacional),
        resultado: noCheckpoint.estado,
        codigo: noCheckpoint.codigo,
      });
      continue;
    }

    try {
      checkpointAtual = await deps.repositorio.servico.marcarEmProcessamento(
        inventario,
        documento.chaveNacional,
        JA_COM_TRAVA
      );
      const resultado = await deps.recuperar({
        chave: documento.chaveNacional,
        cnpj,
        direcao: documento.direcao,
        credencial,
        transporte: deps.transporte,
        periodoConsulta: periodo,
        situacao: documento.situacao,
      });

      recuperacoes.push({
        chaveMascarada: mascararChaveNacional(documento.chaveNacional),
        resultado: resultado.resultado,
        codigo: resultado.codigo,
      });

      if (resultado.resultado === 'RECUPERADO' && resultado.xml && resultado.validacaoXml === 'CONFIRMADA') {
        try {
          checkpointAtual = await deps.repositorio.persistirXml(
            inventario,
            documento.chaveNacional,
            resultado.xml,
            JA_COM_TRAVA
          );
        } catch {
          throw new OrquestracaoNfseError(
            'FALHA_PERSISTENCIA',
            'Falha ao persistir XML fiscal recuperado.'
          );
        }
      } else if (resultado.classeErro === 'TRANSITORIO') {
        checkpointAtual = await deps.repositorio.servico.registrarFalha(
          inventario,
          documento.chaveNacional,
          'TRANSITORIA',
          sanitizarMensagemDiagnostico(resultado.mensagem),
          resultado.codigo ?? undefined,
          JA_COM_TRAVA
        );
      } else {
        checkpointAtual = await deps.repositorio.servico.registrarFalha(
          inventario,
          documento.chaveNacional,
          'PERMANENTE',
          sanitizarMensagemDiagnostico(resultado.mensagem),
          resultado.codigo ?? undefined,
          JA_COM_TRAVA
        );
      }
    } catch (erro) {
      if (erro instanceof OrquestracaoNfseError) throw erro;
      const mensagem = sanitizarMensagemDiagnostico(
        erro instanceof Error ? erro.message : 'Falha na recuperação nativa.'
      );
      diagnosticos.push({ codigo: 'FALHA_RECUPERACAO', mensagem });
      try {
        checkpointAtual = await deps.repositorio.servico.registrarFalha(
          inventario,
          documento.chaveNacional,
          'TRANSITORIA',
          mensagem,
          'FALHA_RECUPERACAO',
          JA_COM_TRAVA
        );
      } catch {
        throw new OrquestracaoNfseError('FALHA_PERSISTENCIA', 'Falha ao registrar erro no checkpoint.');
      }
    }
  }

  const { checkpoint, relatorio } = await deps.repositorio.reconciliar(inventario, checkpointAtual);
  const auditoria = montarAuditoriaFiscal({
    inventario,
    checkpoint,
    reconciliacao: relatorio,
    execucaoId: entrada.execucaoId,
  });

  let caminhoAuditoria: string;
  try {
    caminhoAuditoria = await persistirAuditoriaFiscal(
      criarResolvedorRaizInjetada(entrada.raizFiscal),
      auditoria,
      JA_COM_TRAVA
    );
  } catch {
    throw new OrquestracaoNfseError('FALHA_AUDITORIA', 'Falha ao persistir auditoria fiscal.');
  }

  const exportacao = await deps.repositorio.listarDocumentosExportaveis(inventario);

  return {
    modo: 'NATIVO_CONTROLADO',
    execucaoId: entrada.execucaoId,
    cnpj,
    periodoConsulta: periodo,
    inventario,
    descobertos: inventario.totais.descobertos,
    vigentes: inventario.totais.vigentes,
    canceladas: inventario.totais.canceladas,
    indeterminadas: inventario.totais.indeterminadas,
    persistidos: relatorio.persistidosIntegros,
    pendentes: relatorio.pendentes,
    coberturaPercentual: auditoria.coberturaPercentual,
    conclusaoReconciliacao: relatorio.conclusao,
    estadoAuditoria: auditoria.estado,
    caminhoAuditoria,
    documentosAptos: exportacao.aptos,
    loteLiberado: exportacao.lote.liberado,
    compatibilidadePdf: 'NAO_APLICAVEL',
    diagnosticos,
    recuperacoes,
  };
}

async function descobrirInventario(
  entrada: EntradaFluxoFiscalNativo,
  deps: DependenciasFluxoFiscalNativo,
  cnpj: string,
  periodo: PeriodoConsultaPortal
): Promise<{ inventario: InventarioNfse; resumoFalhasDescoberta: string[] }> {
  const tipos: Array<'EMITIDAS' | 'RECEBIDAS'> =
    entrada.tipo === 'ambas'
      ? ['EMITIDAS', 'RECEBIDAS']
      : entrada.tipo === 'emitidas'
        ? ['EMITIDAS']
        : ['RECEBIDAS'];

  const documentos = [];
  let completude: InventarioNfse['completude'] = 'COMPLETO';
  const resumoFalhasDescoberta: string[] = [];

  for (const tipo of tipos) {
    const resultado = await deps.descobrir({
      page: entrada.page,
      cnpj,
      periodoConsulta: periodo,
      tipo,
    });
    if (resultado.status !== 'DISCOVERY_COMPLETE') {
      completude = resultado.status === 'DISCOVERY_FAILED' ? 'INDETERMINADO' : 'PARCIAL';
      for (const d of resultado.diagnosticos.slice(0, 3)) {
        const partes = [
          tipo,
          d.codigo,
          d.etapa,
          d.url,
          sanitizarMensagemDiagnostico(d.mensagem),
        ].filter(Boolean);
        resumoFalhasDescoberta.push(partes.join(' | '));
      }
    }
    documentos.push(...resultado.inventario.documentos);
  }

  return {
    inventario: montarInventario({
      id: `nativo-${entrada.execucaoId}`,
      cnpj,
      periodoConsulta: periodo,
      documentos,
      completude,
    }),
    resumoFalhasDescoberta,
  };
}

/** Evita vazar senha/PFX/trechos sensíveis em diagnósticos e checkpoint. */
function sanitizarMensagemDiagnostico(mensagem: string): string {
  const texto = String(mensagem ?? '');
  if (/senha|passphrase|pfx|password|BEGIN |PRIVATE /i.test(texto)) {
    return 'Falha na recuperação nativa.';
  }
  if (texto.length > 200) return `${texto.slice(0, 200)}…`;
  return texto || 'Falha na recuperação nativa.';
}
