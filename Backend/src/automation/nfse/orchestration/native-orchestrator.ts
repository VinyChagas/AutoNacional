/**
 * Orquestra descoberta → exclusividade → plano → retomada → recuperação → auditoria.
 * Recebe Page já autenticada e dependências injetadas. Não cria navegador nem CAPTCHA.
 * A trava do Commit 05 cobre a sequência crítica (checkpoint até auditoria).
 */
import { ajustarInventarioComXmlsSubstituicao } from '../classification/substituicao';
import { normalizarCnpjEmpresa } from '../contracts/documento-fiscal';
import { ContratoNfseError } from '../contracts/erros';
import { montarInventario, type InventarioNfse } from '../contracts/inventario';
import { criarPeriodoConsultaPortal, type PeriodoConsultaPortal } from '../contracts/periodo';
import { alinharInventarioAoCheckpoint, CheckpointNfseError } from '../checkpoint';
import { planejarRecuperacaoSefin } from '../recovery/recovery-service';
import {
  montarAuditoriaFiscal,
  persistirAuditoriaFiscal,
  criarResolvedorRaizInjetada,
  raizFiscalDistintaDeDownloads,
} from '../infrastructure';
import { getLogger } from '../../../infrastructure/logger';
import { mascararChaveNacional } from '../infrastructure/types';
import { agoraMonotonicoMs, deltaMonotonicoMs } from './metricas-operacionais';
import {
  OrquestracaoNfseError,
  type DependenciasFluxoFiscalNativo,
  type EntradaFluxoFiscalNativo,
  type ResultadoFluxoFiscalNativo,
} from './types';

const loggerIndeterminada = getLogger('nfse-situacao-indeterminada');
const loggerPreservacao = getLogger('nfse-preservacao-situacao');

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
  let duracoesDescoberta = {
    descobertaEmitidasMs: null as number | null,
    descobertaRecebidasMs: null as number | null,
  };
  try {
    const descoberta = await descobrirInventario(entrada, deps, cnpj, periodo);
    inventario = descoberta.inventario;
    resumoFalhasDescoberta = descoberta.resumoFalhasDescoberta;
    duracoesDescoberta = descoberta.duracoes;
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
  // API-03M — indeterminadas NÃO interrompem a empresa; seguem para SEFIN com atenção fiscal.
  if (inventario.totais.indeterminadas > 0) {
    const indeterminadas = inventario.documentos.filter((d) => d.situacao === 'INDETERMINADA');
    loggerIndeterminada.warn(
      {
        cnpj,
        competencia: `${periodo.inicio}-${periodo.fim}`,
        quantidade: indeterminadas.length,
        chaves: indeterminadas.map((d) => d.chaveNacional),
      },
      'NFS-e indeterminada — recuperação SEFIN continua (API-03M)'
    );
  }

  // Descoberta completa sem documentos (ex.: emitidas+recebidas vazias) → SEM_MOVIMENTO, sem SEFIN.
  if (inventario.totais.descobertos === 0) {
    const resultado = resultadoSemMovimento(entrada, cnpj, periodo, inventario);
    resultado.duracoes = {
      ...duracoesDescoberta,
      recuperacaoSefinMs: null,
    };
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
    const tSefin = agoraMonotonicoMs();
    const resultado = await deps.repositorio.executarComExclusividadeFiscal(cnpj, periodo, async () =>
      executarSequenciaCritica(entrada, deps, cnpj, periodo, inventario, credencial)
    );
    resultado.duracoes = {
      ...duracoesDescoberta,
      recuperacaoSefinMs: deltaMonotonicoMs(tSefin),
    };
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
    documentosPendentesFiscais: [],
    loteLiberado: true,
    xmlsComAtencaoFiscal: 0,
    chavesVigentesFaltantes: [],
    pendenciasFiscais: [],
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
  inventarioEntrada: InventarioNfse,
  credencial: Awaited<ReturnType<DependenciasFluxoFiscalNativo['provedorA1']['obter']>>
): Promise<ResultadoFluxoFiscalNativo> {
  const diagnosticos: ResultadoFluxoFiscalNativo['diagnosticos'] = [];
  const recuperacoes: ResultadoFluxoFiscalNativo['recuperacoes'] = [];
  const xmlsRecuperados: string[] = [];
  let inventario = inventarioEntrada;

  // API-03P — evolui/preserva situações confirmadas antes do plano SEFIN.
  const checkpointEvoluido = await deps.repositorio.criarCheckpoint(
    inventario,
    entrada.execucaoId,
    JA_COM_TRAVA
  );
  const inventarioAlinhado = alinharInventarioAoCheckpoint(inventario, checkpointEvoluido);
  if (inventarioAlinhado !== inventario) {
    const porChaveAntes = new Map(inventario.documentos.map((d) => [d.chaveNacional, d]));
    const chavesPreservadas = inventarioAlinhado.documentos
      .filter((d) => {
        const antes = porChaveAntes.get(d.chaveNacional);
        return antes && antes.situacao !== d.situacao;
      })
      .map((d) => d.chaveNacional);
    if (chavesPreservadas.length > 0) {
      loggerPreservacao.warn(
        {
          cnpj,
          competencia: `${periodo.inicio}-${periodo.fim}`,
          quantidade: chavesPreservadas.length,
          chaves: chavesPreservadas,
        },
        'Inventário alinhado ao checkpoint — situações confirmadas preservadas (API-03P)'
      );
      diagnosticos.push({
        codigo: 'PRESERVACAO_SITUACAO',
        mensagem: `Situações fiscais confirmadas preservadas diante de descoberta mais fraca: ${chavesPreservadas.length} chave(s).`,
      });
    }
    inventario = inventarioAlinhado;
  }

  const plano = planejarRecuperacaoSefin(inventario);
  if (!plano.podeIniciar) {
    throw new OrquestracaoNfseError(
      'PLANEJAMENTO_BLOQUEADO',
      plano.mensagem || 'Planejamento SEFIN bloqueado.'
    );
  }

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
    // API-03P — cancelada preservada permanece fora da recuperação/exportação.
    if (noCheckpoint?.estado === 'EXCLUIDA_DA_RECUPERACAO') continue;
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
        xmlsRecuperados.push(resultado.xml);
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

  // API-03D — originais com chSubstda comprovado saem da meta de vigentes antes da reconciliação.
  // API-03F — evolui o checkpoint para o inventário ajustado (transição VIGENTE→CANCELADA) antes de reconciliar.
  if (xmlsRecuperados.length > 0) {
    inventario = ajustarInventarioComXmlsSubstituicao(inventario, xmlsRecuperados);
    checkpointAtual = await deps.repositorio.criarCheckpoint(inventario, entrada.execucaoId, JA_COM_TRAVA);
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
  const pendenciasFiscais = montarPendenciasFiscaisDoCheckpoint(
    inventario,
    checkpoint,
    exportacao.aptosPendentesFiscais
  );

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
    documentosPendentesFiscais: exportacao.aptosPendentesFiscais,
    loteLiberado: exportacao.lote.liberado,
    xmlsComAtencaoFiscal: relatorio.xmlsComAtencaoFiscal ?? 0,
    chavesVigentesFaltantes: relatorio.chavesVigentesSemXml ?? [],
    pendenciasFiscais,
    compatibilidadePdf: 'NAO_APLICAVEL',
    diagnosticos,
    recuperacoes,
  };
}

/** API-03M — distingue XML recuperado com atenção / não recuperado / falha documental. */
function montarPendenciasFiscaisDoCheckpoint(
  inventario: InventarioNfse,
  checkpoint: { documentos: Array<{ chaveNacional: string; estado: string; diagnostico: string | null }> },
  aptosPendentes: ReadonlyArray<{ chaveNacional: string }>
): NonNullable<ResultadoFluxoFiscalNativo['pendenciasFiscais']> {
  const exportaveis = new Set(aptosPendentes.map((d) => d.chaveNacional));
  const porChave = new Map(checkpoint.documentos.map((d) => [d.chaveNacional, d]));
  return inventario.documentos
    .filter((d) => d.situacao === 'INDETERMINADA')
    .map((d) => {
      const ck = porChave.get(d.chaveNacional);
      const xmlRecuperado = exportaveis.has(d.chaveNacional) || ck?.estado === 'PERSISTIDO';
      if (xmlRecuperado) {
        return {
          chave_acesso: d.chaveNacional,
          numero_nota: null,
          codigo: 'ATENCAO_SITUACAO_NAO_CONFIRMADA',
          motivo:
            'XML documentalmente válido recuperado; situação fiscal do Portal ainda não confirmada.',
          xml_recuperado: true,
          documento_exportado: false,
        };
      }
      if (
        ck?.estado === 'FALHA_PERMANENTE' ||
        ck?.estado === 'INCONSISTENTE' ||
        (ck?.diagnostico ?? '').toLowerCase().includes('validacao') ||
        (ck?.diagnostico ?? '').toLowerCase().includes('cnpj')
      ) {
        return {
          chave_acesso: d.chaveNacional,
          numero_nota: null,
          codigo: 'BLOQUEIO_VALIDACAO_DOCUMENTAL',
          motivo: ck?.diagnostico || 'Validação documental do XML falhou.',
          xml_recuperado: false,
          documento_exportado: false,
        };
      }
      return {
        chave_acesso: d.chaveNacional,
        numero_nota: null,
        codigo: 'XML_INDETERMINADA_NAO_RECUPERADO',
        motivo: 'Situação indeterminada no Portal; XML ainda não recuperado na SEFIN.',
        xml_recuperado: false,
        documento_exportado: false,
      };
    });
}

async function descobrirInventario(
  entrada: EntradaFluxoFiscalNativo,
  deps: DependenciasFluxoFiscalNativo,
  cnpj: string,
  periodo: PeriodoConsultaPortal
): Promise<{
  inventario: InventarioNfse;
  resumoFalhasDescoberta: string[];
  duracoes: {
    descobertaEmitidasMs: number | null;
    descobertaRecebidasMs: number | null;
  };
}> {
  const tipos: Array<'EMITIDAS' | 'RECEBIDAS'> =
    entrada.tipo === 'ambas'
      ? ['EMITIDAS', 'RECEBIDAS']
      : entrada.tipo === 'emitidas'
        ? ['EMITIDAS']
        : ['RECEBIDAS'];

  const documentos = [];
  let completude: InventarioNfse['completude'] = 'COMPLETO';
  const resumoFalhasDescoberta: string[] = [];
  let descobertaEmitidasMs: number | null = null;
  let descobertaRecebidasMs: number | null = null;

  for (const tipo of tipos) {
    const t0 = agoraMonotonicoMs();
    const resultado = await deps.descobrir({
      page: entrada.page,
      cnpj,
      periodoConsulta: periodo,
      tipo,
    });
    const dt = deltaMonotonicoMs(t0);
    if (tipo === 'EMITIDAS') descobertaEmitidasMs = dt;
    if (tipo === 'RECEBIDAS') descobertaRecebidasMs = dt;
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
    duracoes: { descobertaEmitidasMs, descobertaRecebidasMs },
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
