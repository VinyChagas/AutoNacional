/**
 * Adaptador injetável H2.1 / H2.1.1 — DISCOVERY_ONLY.
 *
 * Orçamento GLOBAL de páginas e documentos entre EMITIDAS e RECEBIDAS.
 * Propaga AbortSignal + timeout cooperativo até a descoberta (por página).
 * Não cancela Playwright em voo — apenas impede novas etapas.
 *
 * Isolamento: não ligado ao execution-service. Sem canal seguro H1, inacessível
 * às execuções normais.
 */
import type { Page } from 'playwright';
import type { DocumentoFiscalNfse } from '../contracts/documento-fiscal';
import {
  montarInventario,
  type EstadoCompletudeInventario,
  type InventarioNfse,
} from '../contracts/inventario';
import type { PeriodoConsultaPortal } from '../contracts/periodo';
import type { DiscoverNfseInput } from '../discovery/discovery-service';
import type {
  ControleDescoberta,
  DiagnosticoDescoberta,
  ResultadoDescobertaNfse,
  TipoConsultaDescoberta,
} from '../discovery/types';
import { validarAutorizacaoHomologacao } from './autorizacao';
import {
  mascararCnpjHomologacao,
  registrarEvidenciaHomologacao,
} from './evidencias';
import {
  persistirEvidenciasHomologacao,
  type PersistenciaEvidenciasHomologacao,
} from './evidencias-persistencia';
import { ControladorLimitesHomologacao } from './limites';
import { avaliarGateHomologacao } from './modos';
import {
  HomologacaoNfseError,
  type AutorizacaoHomologacaoNfse,
  type CodigoErroHomologacao,
  type EvidenciaHomologacaoSegura,
  type ResultadoDiscoveryOnlyHomologacao,
  type VereditoDiscoveryOnly,
} from './types';

const EFEITOS_PROIBIDOS = {
  sefin: false,
  escritaXml: false,
  checkpointRecuperacao: false,
  navegadorAdicional: false,
  loginAdicional: false,
} as const;

const DIRECOES: readonly TipoConsultaDescoberta[] = ['EMITIDAS', 'RECEBIDAS'];

export type DiscoverNfseInjetavel = (
  input: DiscoverNfseInput
) => Promise<ResultadoDescobertaNfse>;

export interface EntradaDiscoveryOnlyHomologacao {
  readonly autorizacao: AutorizacaoHomologacaoNfse | null | undefined;
  readonly page: Page;
  readonly cnpj: string;
  readonly periodoConsulta: PeriodoConsultaPortal;
  readonly execucaoId: string;
  readonly diretorioFiscal: string;
  readonly discover: DiscoverNfseInjetavel;
  readonly agora?: Date;
  readonly inicioLimitesEm?: Date;
  /** Relógio para timeout durante paginação (testes). Padrão: agora fixo. */
  readonly relogio?: () => Date;
  readonly signal?: AbortSignal;
  /** Se true, grava evidências no diretório autorizado (atômico). */
  readonly persistirEvidencias?: boolean;
}

/**
 * Executa descoberta controlada EMITIDAS + RECEBIDAS sob autorização H1.
 */
export async function executarDiscoveryOnlyHomologacao(
  entrada: EntradaDiscoveryOnlyHomologacao
): Promise<ResultadoDiscoveryOnlyHomologacao> {
  const evidencias: EvidenciaHomologacaoSegura[] = [];
  const agora = entrada.agora ?? new Date();
  const agoraAtual = (): Date => entrada.relogio?.() ?? agora;
  const diagnosticos: DiagnosticoDescoberta[] = [];
  let inventariosParciais: InventarioNfse[] = [];
  let paginasTotais = 0;
  let codigoErro: CodigoErroHomologacao | null = null;
  let cancelado = false;
  let limitesAplicados = entrada.autorizacao?.limites;
  let persistencia: PersistenciaEvidenciasHomologacao | null = null;

  const registrar = (
    evento: string,
    detalhes: Record<string, unknown> = {},
    auth?: AutorizacaoHomologacaoNfse
  ): void => {
    const base = auth ?? entrada.autorizacao;
    if (!base || typeof base !== 'object' || !('execucaoId' in base)) return;
    evidencias.push(
      registrarEvidenciaHomologacao({
        execucaoId: String(base.execucaoId),
        cnpj: String(base.cnpj ?? entrada.cnpj),
        periodoConsulta:
          (base as AutorizacaoHomologacaoNfse).periodoConsulta ?? entrada.periodoConsulta,
        operacao: 'DISCOVERY_ONLY',
        evento,
        detalhes,
        agora: agoraAtual(),
      })
    );
  };

  try {
    const contexto = {
      cnpj: entrada.cnpj,
      periodoConsulta: entrada.periodoConsulta,
      execucaoId: entrada.execucaoId,
      operacaoSolicitada: 'DISCOVERY_ONLY' as const,
      diretorioFiscal: entrada.diretorioFiscal,
      agora,
    };

    const auth = validarAutorizacaoHomologacao(entrada.autorizacao, contexto);
    limitesAplicados = auth.limites;
    const gate = avaliarGateHomologacao(auth, contexto);

    if (gate.permiteSefin || gate.permitePersistenciaXml || gate.permiteCheckpointRecuperacao) {
      throw new HomologacaoNfseError(
        'OPERACAO_NAO_AUTORIZADA',
        'DISCOVERY_ONLY não pode autorizar SEFIN, XML ou checkpoint.'
      );
    }

    registrar(
      'discovery_only_inicio',
      {
        operacao: auth.operacao,
        maxDocumentos: auth.limites.maxDocumentos,
        maxPaginas: auth.limites.maxPaginas,
        timeoutMs: auth.limites.timeoutMs,
        maxRequisicoesSefin: auth.limites.maxRequisicoesSefin,
        orcamentoPaginas: 'global',
      },
      auth
    );

    const limites = new ControladorLimitesHomologacao(
      auth.limites,
      entrada.inicioLimitesEm ?? agora
    );

    const controle: ControleDescoberta = {
      signal: entrada.signal,
      antesDeOperacao: () => {
        verificarInterrupcaoExterna(entrada.signal, limites);
        limites.exigirDentroDoTimeout(agoraAtual());
      },
    };

    for (const tipo of DIRECOES) {
      verificarInterrupcaoExterna(entrada.signal, limites);
      limites.exigirDentroDoTimeout(agoraAtual());

      const paginasRestantes = limites.paginasRestantes();
      const docsRestantes = limites.documentosRestantes();
      if (paginasRestantes < 1) {
        codigoErro = 'LIMITE_PAGINAS';
        limites.interromper('Orçamento global de páginas esgotado.', 'LIMITE_PAGINAS');
        registrar('discovery_only_limite_paginas', { tipo, motivo: 'orcamento_esgotado' }, auth);
        break;
      }

      let resultado: ResultadoDescobertaNfse;
      try {
        resultado = await entrada.discover({
          page: entrada.page,
          cnpj: auth.cnpj,
          periodoConsulta: auth.periodoConsulta,
          tipo,
          maxPaginas: paginasRestantes,
          maxDocumentos: docsRestantes,
          controle,
        });
      } catch (erroDiscover) {
        if (erroDiscover instanceof HomologacaoNfseError) {
          if (
            erroDiscover.codigo === 'TIMEOUT' ||
            erroDiscover.codigo === 'INTERRUPCAO' ||
            erroDiscover.codigo === 'LIMITE_PAGINAS' ||
            erroDiscover.codigo === 'LIMITE_DOCUMENTOS'
          ) {
            cancelado = true;
            codigoErro = erroDiscover.codigo;
            registrar(
              'discovery_only_interrupcao',
              { tipo, codigo: erroDiscover.codigo },
              auth
            );
            break;
          }
          throw erroDiscover;
        }
        throw erroDiscover;
      }

      // Pós-direção: timeout / abort antes de registrar resultado da direção.
      try {
        verificarInterrupcaoExterna(entrada.signal, limites);
        limites.exigirDentroDoTimeout(agoraAtual());
      } catch (erroPos) {
        if (erroPos instanceof HomologacaoNfseError) {
          cancelado = true;
          codigoErro = erroPos.codigo;
          inventariosParciais.push(resultado.inventario);
          paginasTotais += resultado.paginasPercorridas;
          diagnosticos.push(...resultado.diagnosticos);
          registrar(
            'discovery_only_interrupcao',
            { tipo, codigo: erroPos.codigo, fase: 'pos_direcao' },
            auth
          );
          break;
        }
        throw erroPos;
      }

      diagnosticos.push(...resultado.diagnosticos);
      inventariosParciais.push(resultado.inventario);
      paginasTotais += resultado.paginasPercorridas;

      const atingiuLimitePaginas = resultado.diagnosticos.some((d) => d.codigo === 'LIMITE_PAGINAS');
      const atingiuLimiteDocs = resultado.diagnosticos.some((d) => d.codigo === 'LIMITE_DOCUMENTOS');
      const interrompidoNaDescoberta = resultado.diagnosticos.some((d) => d.codigo === 'INTERRUPCAO');

      try {
        limites.registrarPaginas(
          resultado.paginasPercorridas,
          atingiuLimitePaginas || resultado.status === 'DISCOVERY_INCOMPLETE'
            ? atingiuLimitePaginas
            : false
        );
      } catch (erroLimite) {
        if (erroLimite instanceof HomologacaoNfseError && erroLimite.codigo === 'LIMITE_PAGINAS') {
          codigoErro = 'LIMITE_PAGINAS';
          registrar(
            'discovery_only_limite_paginas',
            { tipo, paginas: resultado.paginasPercorridas, global: limites.contagem().paginas },
            auth
          );
          break;
        }
        throw erroLimite;
      }

      try {
        limites.exigirDocumentos(
          inventariosParciais.reduce((acc, inv) => acc + inv.documentos.length, 0)
        );
      } catch (erroDoc) {
        if (erroDoc instanceof HomologacaoNfseError && erroDoc.codigo === 'LIMITE_DOCUMENTOS') {
          codigoErro = 'LIMITE_DOCUMENTOS';
          registrar(
            'discovery_only_limite_documentos',
            {
              documentos: inventariosParciais.reduce((a, i) => a + i.documentos.length, 0),
            },
            auth
          );
          break;
        }
        throw erroDoc;
      }

      if (atingiuLimiteDocs) {
        codigoErro = 'LIMITE_DOCUMENTOS';
        registrar('discovery_only_limite_documentos', { tipo, origem: 'descoberta' }, auth);
        break;
      }

      if (interrompidoNaDescoberta) {
        cancelado = true;
        codigoErro = 'INTERRUPCAO';
        registrar('discovery_only_interrupcao', { tipo, origem: 'descoberta' }, auth);
        break;
      }

      if (resultado.status === 'DISCOVERY_FAILED') {
        codigoErro = 'INVENTARIO_INCOMPLETO';
        registrar('discovery_only_falha_direcao', { tipo, status: resultado.status }, auth);
        break;
      }

      if (resultado.status === 'DISCOVERY_INCOMPLETE' || atingiuLimitePaginas) {
        codigoErro = codigoErro ?? (atingiuLimitePaginas ? 'LIMITE_PAGINAS' : 'INVENTARIO_INCOMPLETO');
        if (atingiuLimitePaginas) {
          registrar(
            'discovery_only_limite_paginas',
            { tipo, paginas: resultado.paginasPercorridas },
            auth
          );
          break;
        }
      }

      registrar(
        'discovery_only_direcao',
        {
          tipo,
          status: resultado.status,
          documentos: resultado.inventario.totais.descobertos,
          paginas: resultado.paginasPercorridas,
          paginasGlobais: limites.contagem().paginas,
        },
        auth
      );
    }

    // Antes do resultado final: não declarar PASS após cancelamento.
    try {
      verificarInterrupcaoExterna(entrada.signal, limites);
      limites.exigirDentroDoTimeout(agoraAtual());
    } catch (erroFinal) {
      if (erroFinal instanceof HomologacaoNfseError) {
        cancelado = true;
        codigoErro = erroFinal.codigo;
      } else {
        throw erroFinal;
      }
    }

    const inventario = consolidarInventarios(
      auth.execucaoId,
      auth.cnpj,
      auth.periodoConsulta,
      inventariosParciais,
      codigoErro != null || limites.foiInterrompido() || cancelado
    );

    let veredito = decidirVeredito(inventario.completude, codigoErro, diagnosticos, cancelado);
    if (cancelado && veredito === 'PASS') {
      veredito = 'INCOMPLETO';
      codigoErro = codigoErro ?? 'INTERRUPCAO';
    }
    if (veredito === 'INCOMPLETO' && codigoErro == null) {
      codigoErro = 'INVENTARIO_INCOMPLETO';
    }

    registrar(
      'discovery_only_fim',
      {
        veredito,
        estadoInventario: inventario.completude,
        emitidas: inventario.totais.emitidas,
        recebidas: inventario.totais.recebidas,
        vigentes: inventario.totais.vigentes,
        canceladas: inventario.totais.canceladas,
        indeterminadas: inventario.totais.indeterminadas,
        paginas: paginasTotais,
        codigoErro: codigoErro ?? null,
        cancelado,
      },
      auth
    );

    const resultadoBase = montarResultado({
      auth,
      inventario,
      paginasTotais,
      diagnosticos,
      evidencias,
      veredito,
      codigoErro: veredito === 'PASS' ? null : codigoErro,
      limitesAplicados: auth.limites,
    });

    if (entrada.persistirEvidencias) {
      persistencia = await persistirEvidenciasHomologacao({
        diretorioFiscal: auth.diretorioFiscal,
        execucaoId: auth.execucaoId,
        evidencias,
        resultado: resultadoBase,
        agora: agoraAtual(),
      });
      evidencias.push(
        registrarEvidenciaHomologacao({
          execucaoId: auth.execucaoId,
          cnpj: auth.cnpj,
          periodoConsulta: auth.periodoConsulta,
          operacao: 'DISCOVERY_ONLY',
          evento: 'discovery_only_evidencia_persistida',
          detalhes: {
            caminho: pathBasename(persistencia.caminho),
            bytes: persistencia.bytes,
          },
          agora: agoraAtual(),
        })
      );
      return { ...resultadoBase, evidencias: [...evidencias] };
    }

    return resultadoBase;
  } catch (erro) {
    const codigo =
      erro instanceof HomologacaoNfseError ? erro.codigo : ('CONTEXTO_INVALIDO' as const);
    const mensagem = erro instanceof Error ? erro.message : 'Falha na descoberta controlada.';
    const limitesFallback = limitesAplicados ?? {
      maxDocumentos: 0,
      maxPaginas: 1,
      maxRequisicoesSefin: 0,
      timeoutMs: 1,
    };

    evidencias.push(
      registrarEvidenciaHomologacao({
        execucaoId: entrada.execucaoId,
        cnpj: entrada.cnpj,
        periodoConsulta: entrada.periodoConsulta,
        operacao: 'DISCOVERY_ONLY',
        evento: 'discovery_only_erro',
        detalhes: { codigo, mensagem: sanitizarMensagem(mensagem) },
        agora: agoraAtual(),
      })
    );

    const docsParciais = inventariosParciais.flatMap((i) => i.documentos);
    return {
      execucaoId: entrada.execucaoId,
      cnpjMascarado: mascararCnpjHomologacao(entrada.cnpj),
      periodoConsulta: entrada.periodoConsulta,
      veredito: 'FAIL',
      totais: {
        emitidas: docsParciais.filter((d) => d.direcao === 'EMITIDA').length,
        recebidas: docsParciais.filter((d) => d.direcao === 'RECEBIDA').length,
        vigentes: docsParciais.filter((d) => d.situacao === 'VIGENTE').length,
        canceladas: docsParciais.filter((d) => d.situacao === 'CANCELADA').length,
        indeterminadas: docsParciais.filter((d) => d.situacao === 'INDETERMINADA').length,
        paginas: paginasTotais,
      },
      estadoInventario: docsParciais.length > 0 ? 'PARCIAL' : 'INDETERMINADO',
      diagnosticos: [
        ...diagnosticos.map((d) => ({
          codigo: d.codigo,
          mensagem: sanitizarMensagem(d.mensagem),
        })),
        { codigo: String(codigo), mensagem: sanitizarMensagem(mensagem) },
      ],
      evidencias: [...evidencias],
      limitesAplicados: limitesFallback,
      codigoErro: codigo,
      efeitosProibidos: EFEITOS_PROIBIDOS,
    };
  }
}

function verificarInterrupcaoExterna(
  signal: AbortSignal | undefined,
  limites: ControladorLimitesHomologacao
): void {
  if (signal?.aborted) {
    limites.interromper('Interrupção solicitada via signal.', 'INTERRUPCAO');
    throw new HomologacaoNfseError('INTERRUPCAO', 'Homologação interrompida pelo operador.');
  }
}

function consolidarInventarios(
  execucaoId: string,
  cnpj: string,
  periodo: PeriodoConsultaPortal,
  parciais: InventarioNfse[],
  forcarIncompleto: boolean
): InventarioNfse {
  const vistos = new Set<string>();
  const documentos: DocumentoFiscalNfse[] = [];
  let algumaParcial = forcarIncompleto;
  let algumaIndeterminada = false;

  for (const inv of parciais) {
    if (inv.completude === 'PARCIAL') algumaParcial = true;
    if (inv.completude === 'INDETERMINADO') algumaIndeterminada = true;
    for (const doc of inv.documentos) {
      if (vistos.has(doc.chaveNacional)) continue;
      vistos.add(doc.chaveNacional);
      documentos.push(doc);
    }
  }

  let completude: EstadoCompletudeInventario = 'COMPLETO';
  if (algumaIndeterminada) completude = 'INDETERMINADO';
  else if (algumaParcial || parciais.length < DIRECOES.length) completude = 'PARCIAL';

  return montarInventario({
    id: `h2.1-${execucaoId}`,
    cnpj,
    periodoConsulta: periodo,
    documentos,
    completude,
  });
}

function decidirVeredito(
  completude: EstadoCompletudeInventario,
  codigoErro: CodigoErroHomologacao | null,
  diagnosticos: readonly DiagnosticoDescoberta[],
  cancelado: boolean
): VereditoDiscoveryOnly {
  if (cancelado) {
    return codigoErro === 'TIMEOUT' || codigoErro === 'INTERRUPCAO' ? 'FAIL' : 'INCOMPLETO';
  }
  if (
    codigoErro &&
    codigoErro !== 'INVENTARIO_INCOMPLETO' &&
    codigoErro !== 'LIMITE_PAGINAS' &&
    codigoErro !== 'LIMITE_DOCUMENTOS' &&
    codigoErro !== 'TIMEOUT' &&
    codigoErro !== 'INTERRUPCAO'
  ) {
    return 'FAIL';
  }
  if (completude !== 'COMPLETO' || codigoErro != null) {
    return 'INCOMPLETO';
  }
  if (
    diagnosticos.some((d) => d.codigo === 'DUPLICIDADE' || d.codigo === 'CHAVE_EM_AMBAS_DIRECOES')
  ) {
    return 'INCOMPLETO';
  }
  return 'PASS';
}

function montarResultado(input: {
  auth: {
    execucaoId: string;
    cnpj: string;
    periodoConsulta: PeriodoConsultaPortal;
    limites: ResultadoDiscoveryOnlyHomologacao['limitesAplicados'];
  };
  inventario: InventarioNfse;
  paginasTotais: number;
  diagnosticos: readonly DiagnosticoDescoberta[];
  evidencias: readonly EvidenciaHomologacaoSegura[];
  veredito: VereditoDiscoveryOnly;
  codigoErro: CodigoErroHomologacao | null;
  limitesAplicados: ResultadoDiscoveryOnlyHomologacao['limitesAplicados'];
}): ResultadoDiscoveryOnlyHomologacao {
  return {
    execucaoId: input.auth.execucaoId,
    cnpjMascarado: mascararCnpjHomologacao(input.auth.cnpj),
    periodoConsulta: input.auth.periodoConsulta,
    veredito: input.veredito,
    totais: {
      emitidas: input.inventario.totais.emitidas,
      recebidas: input.inventario.totais.recebidas,
      vigentes: input.inventario.totais.vigentes,
      canceladas: input.inventario.totais.canceladas,
      indeterminadas: input.inventario.totais.indeterminadas,
      paginas: input.paginasTotais,
    },
    estadoInventario: input.inventario.completude,
    diagnosticos: input.diagnosticos.map((d) => ({
      codigo: d.codigo,
      mensagem: sanitizarMensagem(d.mensagem),
    })),
    evidencias: [...input.evidencias],
    limitesAplicados: input.limitesAplicados,
    codigoErro: input.codigoErro,
    efeitosProibidos: EFEITOS_PROIBIDOS,
  };
}

function sanitizarMensagem(mensagem: string): string {
  return mensagem
    .replace(/senha[=:\s]\S+/gi, 'senha=***')
    .replace(/passphrase[=:\s]\S+/gi, 'passphrase=***')
    .replace(/\b\d{50}\b/g, '[chave-omitida]')
    .slice(0, 200);
}

function pathBasename(caminho: string): string {
  const partes = caminho.replace(/\\/g, '/').split('/');
  return partes[partes.length - 1] ?? caminho;
}
