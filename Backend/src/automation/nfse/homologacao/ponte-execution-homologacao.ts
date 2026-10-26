/**
 * Ponte operacional H2.2.2-B: canal + ativação individual + Discovery-Only + evidências.
 *
 * Gate global permanece FECHADO por padrão e NÃO autoriza descoberta sozinho.
 * Descoberta real exige ticket DISCOVERY_ONLY válido + ativacaoDiscoveryReal
 * + Page autenticada + discover injetado; consome 1× antes da descoberta; sem legado.
 *
 * Nunca SEFIN / XML / checkpoint / segundo browser/login.
 */
import type { Page } from 'playwright';
import type { PeriodoConsultaPortal } from '../contracts/periodo';
import { obterCanalHomologacaoOperacional } from './canal-autorizacao';
import type { TicketAutorizacaoOperacional } from './canal-autorizacao-types';
import type { DiscoverNfseInjetavel } from './discovery-only-adapter';
import { executarDiscoveryOnlyHomologacao } from './discovery-only-adapter';
import { validarDiretorioFiscalSeguro } from './diretorio-seguro';
import { mascararCnpjHomologacao, registrarEvidenciaHomologacao } from './evidencias';
import {
  mapearVereditoParaEstadoOperacional,
  type EstadoOperacionalHomologacao,
} from './estados-operacionais';
import { execucaoRealDiscoveryOnlyHabilitada } from './gate-execucao-real';
import {
  HomologacaoNfseError,
  type CodigoErroHomologacao,
  type EvidenciaHomologacaoSegura,
  type ResultadoDiscoveryOnlyHomologacao,
} from './types';

export type SituacaoPonteHomologacao =
  | 'SEM_AUTORIZACAO'
  | 'PREPARADA_GATE_FECHADO'
  | 'RECUSADA'
  | 'BLOQUEADA_GATE_REAL'
  | 'DESCOBERTA_CONCLUIDA'
  | 'DESCOBERTA_INCOMPLETA'
  | 'DESCOBERTA_FALHA'
  | 'DESCOBERTA_CANCELADA';

export interface EntradaPonteHomologacao {
  readonly execucaoId: string;
  readonly cnpj: string;
  readonly periodoConsulta: PeriodoConsultaPortal;
  readonly pagePresente: boolean;
  /** Page autenticada da execução — reutilizada; nunca abre novo browser. */
  readonly page?: Page | null;
  /** discoverNfse (ou mock). Sem default interno no adaptador. */
  readonly discover?: DiscoverNfseInjetavel;
  readonly signal?: AbortSignal;
  readonly persistirEvidencias?: boolean;
  readonly agora?: Date;
  readonly relogio?: () => Date;
  readonly inicioLimitesEm?: Date;
}

export interface ResultadoPonteHomologacao {
  readonly situacao: SituacaoPonteHomologacao;
  readonly estadoOperacional: EstadoOperacionalHomologacao | null;
  readonly encerrarEtapaFiscal: boolean;
  readonly motivo: string;
  readonly codigoErro: CodigoErroHomologacao | null;
  readonly autorizacaoId: string | null;
  readonly cnpjMascarado: string;
  readonly evidencias: readonly EvidenciaHomologacaoSegura[];
  readonly ticket: TicketAutorizacaoOperacional | null;
  readonly descobertaExecutada: boolean;
  readonly ticketConsumido: boolean;
  readonly resultadoDiscovery: ResultadoDiscoveryOnlyHomologacao | null;
  readonly efeitosProibidos: {
    readonly sefin: false;
    readonly escritaXml: false;
    readonly checkpointRecuperacao: false;
    readonly navegadorAdicional: false;
    readonly loginAdicional: false;
    readonly navegacaoPortal: boolean;
    readonly execucaoDuplaLegado: false;
    readonly discoverNfse: boolean;
  };
}

const EFEITOS_BLOQUEADO = {
  sefin: false,
  escritaXml: false,
  checkpointRecuperacao: false,
  navegadorAdicional: false,
  loginAdicional: false,
  navegacaoPortal: false,
  execucaoDuplaLegado: false,
  discoverNfse: false,
} as const;

/**
 * Avalia / executa homologação DISCOVERY_ONLY.
 * Autorização suficiente = ticket válido + ativação individual desta execução.
 * Gate global aberto sozinho → BLOQUEADA (não basta).
 */
export async function avaliarPonteHomologacaoDiscoveryOnly(
  entrada: EntradaPonteHomologacao
): Promise<ResultadoPonteHomologacao> {
  const evidencias: EvidenciaHomologacaoSegura[] = [];
  const agora = entrada.agora ?? new Date();
  const cnpjMascarado = mascararCnpjHomologacao(entrada.cnpj);
  const canal = obterCanalHomologacaoOperacional();
  const gateAberto = execucaoRealDiscoveryOnlyHabilitada();

  const base = (
    parcial: Partial<ResultadoPonteHomologacao> &
      Pick<ResultadoPonteHomologacao, 'situacao' | 'encerrarEtapaFiscal' | 'motivo'>
  ): ResultadoPonteHomologacao => ({
    situacao: parcial.situacao,
    estadoOperacional: parcial.estadoOperacional ?? null,
    encerrarEtapaFiscal: parcial.encerrarEtapaFiscal,
    motivo: parcial.motivo,
    codigoErro: parcial.codigoErro ?? null,
    autorizacaoId: parcial.autorizacaoId ?? null,
    cnpjMascarado,
    evidencias: [...evidencias],
    ticket: parcial.ticket ?? null,
    descobertaExecutada: parcial.descobertaExecutada ?? false,
    ticketConsumido: parcial.ticketConsumido ?? false,
    resultadoDiscovery: parcial.resultadoDiscovery ?? null,
    efeitosProibidos: parcial.efeitosProibidos ?? EFEITOS_BLOQUEADO,
  });

  if (!canal) {
    return base({
      situacao: 'SEM_AUTORIZACAO',
      estadoOperacional: null,
      encerrarEtapaFiscal: false,
      motivo: 'Canal de homologação não configurado; fluxo legado preservado.',
    });
  }

  const ticketExistente = await canal.consultar(entrada.execucaoId);
  if (!ticketExistente) {
    return base({
      situacao: 'SEM_AUTORIZACAO',
      estadoOperacional: null,
      encerrarEtapaFiscal: false,
      motivo: 'Sem ticket para a execução; fluxo legado preservado.',
    });
  }

  const diretorioFiscal = ticketExistente.autorizacao.diretorioFiscal;
  const contexto = {
    execucaoId: entrada.execucaoId,
    cnpj: entrada.cnpj,
    periodoConsulta: entrada.periodoConsulta,
    diretorioFiscal,
    agora,
  };

  try {
    await validarDiretorioFiscalSeguro({
      diretorioFiscal,
      criarSeAusente: true,
    });
  } catch (erro) {
    const codigo =
      erro instanceof HomologacaoNfseError ? erro.codigo : ('DIRETORIO_INSEGURO' as const);
    evidencias.push(ev(entrada, 'ponte_diretorio_inseguro', { codigo }, agora));
    return base({
      situacao: 'RECUSADA',
      estadoOperacional: 'FALHA',
      encerrarEtapaFiscal: true,
      motivo: 'Diretório fiscal inseguro; etapa fiscal encerrada sem legado.',
      codigoErro: codigo,
      autorizacaoId: ticketExistente.autorizacaoId,
      ticket: ticketExistente,
    });
  }

  if (!entrada.pagePresente) {
    evidencias.push(
      ev(entrada, 'ponte_page_ausente', { autorizacaoId: ticketExistente.autorizacaoId }, agora)
    );
    return base({
      situacao: 'RECUSADA',
      estadoOperacional: 'FALHA',
      encerrarEtapaFiscal: true,
      motivo: 'Page autenticada ausente; homologação recusada sem legado.',
      codigoErro: 'CONTEXTO_INVALIDO',
      autorizacaoId: ticketExistente.autorizacaoId,
      ticket: ticketExistente,
    });
  }

  // ---------- Validação sem consumo ----------
  let ticketValidado: TicketAutorizacaoOperacional;
  try {
    ticketValidado = await canal.validarSemConsumir(entrada.execucaoId, contexto);
  } catch (erro) {
    const codigo =
      erro instanceof HomologacaoNfseError ? erro.codigo : ('CONTEXTO_INVALIDO' as const);
    evidencias.push(
      ev(
        entrada,
        'ponte_validacao_recusada',
        {
          codigo,
          ticketConsumido: false,
          descobertaExecutada: false,
        },
        agora
      )
    );
    return base({
      situacao: 'RECUSADA',
      estadoOperacional: 'FALHA',
      encerrarEtapaFiscal: true,
      motivo: `Validação recusada (${codigo}); ticket não consumido; sem legado.`,
      codigoErro: codigo,
      autorizacaoId: ticketExistente.autorizacaoId,
      ticket: ticketExistente,
    });
  }

  // ---------- Gate global aberto sozinho NÃO autoriza ----------
  if (gateAberto && !ticketValidado.ativacaoDiscoveryReal) {
    evidencias.push(
      ev(
        entrada,
        'ponte_gate_insuficiente_sem_ativacao',
        {
          autorizacaoId: ticketValidado.autorizacaoId,
          gateAberto: true,
          ativacaoDiscoveryReal: false,
          ticketConsumido: false,
          descobertaExecutada: false,
          estadoOperacional: 'BLOQUEADA',
        },
        agora
      )
    );
    return base({
      situacao: 'BLOQUEADA_GATE_REAL',
      estadoOperacional: 'BLOQUEADA',
      encerrarEtapaFiscal: true,
      motivo:
        'Gate global aberto é insuficiente sem ativação individual do ticket; BLOQUEADA.',
      codigoErro: 'ATIVACAO_INDIVIDUAL_AUSENTE',
      autorizacaoId: ticketValidado.autorizacaoId,
      ticket: ticketValidado,
      ticketConsumido: false,
      descobertaExecutada: false,
    });
  }

  // ---------- Sem ativação individual → BLOQUEADA (gate permanece fechado) ----------
  if (!ticketValidado.ativacaoDiscoveryReal) {
    evidencias.push(
      ev(
        entrada,
        'ponte_preparada_gate_fechado',
        {
          autorizacaoId: ticketValidado.autorizacaoId,
          estadoTicket: ticketValidado.estado,
          gateAberto: false,
          ativacaoDiscoveryReal: false,
          ticketConsumido: false,
          descobertaExecutada: false,
          estadoOperacional: 'BLOQUEADA',
          vereditoPass: false,
          coberturaFiscal: false,
          discoverNfse: false,
          sefin: false,
        },
        agora
      )
    );
    return base({
      situacao: 'PREPARADA_GATE_FECHADO',
      estadoOperacional: 'BLOQUEADA',
      encerrarEtapaFiscal: true,
      motivo:
        'Ticket validado sem consumo; ativação individual ausente — BLOQUEADA (sem descoberta).',
      codigoErro: 'ATIVACAO_INDIVIDUAL_AUSENTE',
      autorizacaoId: ticketValidado.autorizacaoId,
      ticket: ticketValidado,
      ticketConsumido: false,
      descobertaExecutada: false,
    });
  }

  if (!entrada.discover) {
    evidencias.push(
      ev(
        entrada,
        'ponte_discover_ausente',
        { ativacaoDiscoveryReal: true, autorizacaoId: ticketValidado.autorizacaoId },
        agora
      )
    );
    return base({
      situacao: 'RECUSADA',
      estadoOperacional: 'FALHA',
      encerrarEtapaFiscal: true,
      motivo: 'Ativação individual sem discover injetado; descoberta recusada.',
      codigoErro: 'CONTEXTO_INVALIDO',
      autorizacaoId: ticketValidado.autorizacaoId,
      ticket: ticketValidado,
    });
  }

  if (!entrada.page) {
    evidencias.push(
      ev(entrada, 'ponte_page_objeto_ausente', { ativacaoDiscoveryReal: true }, agora)
    );
    return base({
      situacao: 'RECUSADA',
      estadoOperacional: 'FALHA',
      encerrarEtapaFiscal: true,
      motivo: 'Ativação individual sem objeto Page; descoberta recusada.',
      codigoErro: 'CONTEXTO_INVALIDO',
      autorizacaoId: ticketValidado.autorizacaoId,
      ticket: ticketValidado,
    });
  }

  // ---------- Consumir 1× ANTES da descoberta (falha/timeout/cancel não liberam) ----------
  let consumo;
  try {
    consumo = await canal.consumir(entrada.execucaoId, contexto, 'EXECUCAO_REAL');
  } catch (erro) {
    const codigo =
      erro instanceof HomologacaoNfseError ? erro.codigo : ('CONTEXTO_INVALIDO' as const);
    evidencias.push(
      ev(entrada, 'ponte_consumo_recusado', { codigo, descobertaExecutada: false }, agora)
    );
    return base({
      situacao: 'RECUSADA',
      estadoOperacional: 'FALHA',
      encerrarEtapaFiscal: true,
      motivo: `Consumo recusado (${codigo}); sem fallback legado.`,
      codigoErro: codigo,
      autorizacaoId: ticketValidado.autorizacaoId,
      ticket: ticketValidado,
      ticketConsumido: false,
    });
  }

  evidencias.push(
    ev(
      entrada,
      'ponte_autorizacao_consumida',
      {
        autorizacaoId: consumo.ticket.autorizacaoId,
        motivoConsumo: consumo.ticket.motivoConsumo ?? null,
        ativacaoMotivo: consumo.ticket.ativacaoMotivo ?? null,
        ativacaoEm: consumo.ticket.ativacaoEm ?? null,
      },
      agora
    )
  );

  const canceladoPorSignal = Boolean(entrada.signal?.aborted);
  let resultadoDiscovery: ResultadoDiscoveryOnlyHomologacao;
  try {
    resultadoDiscovery = await executarDiscoveryOnlyHomologacao({
      autorizacao: consumo.ticket.autorizacao,
      page: entrada.page,
      cnpj: entrada.cnpj,
      periodoConsulta: entrada.periodoConsulta,
      execucaoId: entrada.execucaoId,
      diretorioFiscal,
      discover: entrada.discover,
      agora,
      relogio: entrada.relogio,
      inicioLimitesEm: entrada.inicioLimitesEm,
      signal: entrada.signal,
      persistirEvidencias: entrada.persistirEvidencias ?? true,
    });
  } catch (erro) {
    const codigo =
      erro instanceof HomologacaoNfseError ? erro.codigo : ('CONTEXTO_INVALIDO' as const);
    evidencias.push(
      ev(
        entrada,
        'ponte_descoberta_erro',
        {
          codigo,
          mensagem: erro instanceof Error ? erro.message.slice(0, 200) : 'erro',
          ticketConsumido: true,
        },
        agora
      )
    );
    return base({
      situacao: 'DESCOBERTA_FALHA',
      estadoOperacional: 'FALHA',
      encerrarEtapaFiscal: true,
      motivo: `Falha técnica na descoberta (${codigo}); ticket consumido; sem legado.`,
      codigoErro: codigo,
      autorizacaoId: consumo.ticket.autorizacaoId,
      ticket: consumo.ticket,
      ticketConsumido: true,
      descobertaExecutada: false,
      efeitosProibidos: {
        ...EFEITOS_BLOQUEADO,
        navegacaoPortal: true,
        discoverNfse: true,
      },
    });
  }

  evidencias.push(...resultadoDiscovery.evidencias);

  if (resultadoDiscovery.codigoErro === 'FALHA_EVIDENCIA') {
    evidencias.push(
      ev(entrada, 'ponte_persistencia_falhou', { veredito: resultadoDiscovery.veredito }, agora)
    );
    return base({
      situacao: 'DESCOBERTA_FALHA',
      estadoOperacional: 'FALHA',
      encerrarEtapaFiscal: true,
      motivo: 'Persistência de evidências falhou; homologação não aprovada.',
      codigoErro: 'FALHA_EVIDENCIA',
      autorizacaoId: consumo.ticket.autorizacaoId,
      ticket: consumo.ticket,
      ticketConsumido: true,
      descobertaExecutada: true,
      resultadoDiscovery,
      efeitosProibidos: {
        ...EFEITOS_BLOQUEADO,
        navegacaoPortal: true,
        discoverNfse: true,
      },
    });
  }

  const estadoOperacional = mapearVereditoParaEstadoOperacional(
    resultadoDiscovery.veredito,
    resultadoDiscovery.codigoErro,
    canceladoPorSignal || resultadoDiscovery.codigoErro === 'INTERRUPCAO'
  );

  const situacao: SituacaoPonteHomologacao =
    estadoOperacional === 'CONCLUIDA'
      ? 'DESCOBERTA_CONCLUIDA'
      : estadoOperacional === 'INCOMPLETA'
        ? 'DESCOBERTA_INCOMPLETA'
        : estadoOperacional === 'CANCELADA'
          ? 'DESCOBERTA_CANCELADA'
          : 'DESCOBERTA_FALHA';

  evidencias.push(
    ev(
      entrada,
      'ponte_descoberta_encerrada',
      {
        estadoOperacional,
        veredito: resultadoDiscovery.veredito,
        estadoInventario: resultadoDiscovery.estadoInventario,
        ticketConsumido: true,
        descobertaExecutada: true,
        ativacaoDiscoveryReal: true,
        coberturaFiscal:
          resultadoDiscovery.veredito === 'PASS' &&
          resultadoDiscovery.estadoInventario === 'COMPLETO',
      },
      agora
    )
  );

  return base({
    situacao,
    estadoOperacional,
    encerrarEtapaFiscal: true,
    motivo: `Discovery-Only ${estadoOperacional}; ticket consumido; sem continuação no legado.`,
    codigoErro: resultadoDiscovery.codigoErro,
    autorizacaoId: consumo.ticket.autorizacaoId,
    ticket: consumo.ticket,
    ticketConsumido: true,
    descobertaExecutada: true,
    resultadoDiscovery,
    efeitosProibidos: {
      ...EFEITOS_BLOQUEADO,
      navegacaoPortal: true,
      discoverNfse: true,
    },
  });
}

function ev(
  entrada: EntradaPonteHomologacao,
  evento: string,
  detalhes: Record<string, unknown>,
  agora: Date
): EvidenciaHomologacaoSegura {
  return registrarEvidenciaHomologacao({
    execucaoId: entrada.execucaoId,
    cnpj: entrada.cnpj,
    periodoConsulta: entrada.periodoConsulta,
    operacao: 'DISCOVERY_ONLY',
    evento,
    detalhes,
    agora,
  });
}
