/**
 * Ponte mínima execution-service ↔ canal H2.2.1.
 *
 * Sem canal configurado → legado idêntico.
 * Com ticket válido + gate fechado → valida SEM consumir, registra evidência,
 * encerra etapa fiscal (sem legado, sem navegação, sem SEFIN, sem discoverNfse).
 * Consumo atômico reserva-se à execução real (H2.2.2, gate aberto).
 */
import type { PeriodoConsultaPortal } from '../contracts/periodo';
import { obterCanalHomologacaoOperacional } from './canal-autorizacao';
import type { TicketAutorizacaoOperacional } from './canal-autorizacao-types';
import { validarDiretorioFiscalSeguro } from './diretorio-seguro';
import { mascararCnpjHomologacao, registrarEvidenciaHomologacao } from './evidencias';
import { execucaoRealDiscoveryOnlyHabilitada } from './gate-execucao-real';
import {
  HomologacaoNfseError,
  type CodigoErroHomologacao,
  type EvidenciaHomologacaoSegura,
} from './types';

export type SituacaoPonteHomologacao =
  | 'SEM_AUTORIZACAO'
  | 'PREPARADA_GATE_FECHADO'
  | 'RECUSADA'
  | 'BLOQUEADA_GATE_REAL';

export interface EntradaPonteHomologacao {
  readonly execucaoId: string;
  readonly cnpj: string;
  readonly periodoConsulta: PeriodoConsultaPortal;
  readonly pagePresente: boolean;
  readonly agora?: Date;
}

export interface ResultadoPonteHomologacao {
  readonly situacao: SituacaoPonteHomologacao;
  readonly encerrarEtapaFiscal: boolean;
  readonly motivo: string;
  readonly codigoErro: CodigoErroHomologacao | null;
  readonly autorizacaoId: string | null;
  readonly cnpjMascarado: string;
  readonly evidencias: readonly EvidenciaHomologacaoSegura[];
  readonly ticket: TicketAutorizacaoOperacional | null;
  /** Sempre false em H2.2.1 — nenhuma descoberta fiscal ocorreu. */
  readonly descobertaExecutada: false;
  /** Sempre false em H2.2.1 com gate fechado. */
  readonly ticketConsumido: boolean;
  readonly efeitosProibidos: {
    readonly sefin: false;
    readonly escritaXml: false;
    readonly checkpointRecuperacao: false;
    readonly navegadorAdicional: false;
    readonly loginAdicional: false;
    readonly navegacaoPortal: false;
    readonly execucaoDuplaLegado: false;
    readonly discoverNfse: false;
  };
}

const EFEITOS = {
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
 * Avalia se a execução deve seguir legado ou encerrar na preparação homologada.
 * Nunca inicia discoverNfse / Playwright fiscal / SEFIN nesta etapa.
 */
export async function avaliarPonteHomologacaoDiscoveryOnly(
  entrada: EntradaPonteHomologacao
): Promise<ResultadoPonteHomologacao> {
  const evidencias: EvidenciaHomologacaoSegura[] = [];
  const agora = entrada.agora ?? new Date();
  const cnpjMascarado = mascararCnpjHomologacao(entrada.cnpj);
  const canal = obterCanalHomologacaoOperacional();

  const base = (
    parcial: Partial<ResultadoPonteHomologacao> &
      Pick<ResultadoPonteHomologacao, 'situacao' | 'encerrarEtapaFiscal' | 'motivo'>
  ): ResultadoPonteHomologacao => ({
    situacao: parcial.situacao,
    encerrarEtapaFiscal: parcial.encerrarEtapaFiscal,
    motivo: parcial.motivo,
    codigoErro: parcial.codigoErro ?? null,
    autorizacaoId: parcial.autorizacaoId ?? null,
    cnpjMascarado,
    evidencias: [...evidencias],
    ticket: parcial.ticket ?? null,
    descobertaExecutada: false,
    ticketConsumido: parcial.ticketConsumido ?? false,
    efeitosProibidos: EFEITOS,
  });

  if (!canal) {
    return base({
      situacao: 'SEM_AUTORIZACAO',
      encerrarEtapaFiscal: false,
      motivo: 'Canal de homologação não configurado; fluxo legado preservado.',
    });
  }

  const ticketExistente = await canal.consultar(entrada.execucaoId);
  if (!ticketExistente) {
    return base({
      situacao: 'SEM_AUTORIZACAO',
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
    evidencias.push(
      registrarEvidenciaHomologacao({
        execucaoId: entrada.execucaoId,
        cnpj: entrada.cnpj,
        periodoConsulta: entrada.periodoConsulta,
        operacao: 'DISCOVERY_ONLY',
        evento: 'ponte_diretorio_inseguro',
        detalhes: { codigo, descobertaExecutada: false },
        agora,
      })
    );
    return base({
      situacao: 'RECUSADA',
      encerrarEtapaFiscal: true,
      motivo: 'Diretório fiscal inseguro; etapa fiscal encerrada sem legado.',
      codigoErro: codigo,
      autorizacaoId: ticketExistente.autorizacaoId,
      ticket: ticketExistente,
    });
  }

  if (!entrada.pagePresente) {
    evidencias.push(
      registrarEvidenciaHomologacao({
        execucaoId: entrada.execucaoId,
        cnpj: entrada.cnpj,
        periodoConsulta: entrada.periodoConsulta,
        operacao: 'DISCOVERY_ONLY',
        evento: 'ponte_page_ausente',
        detalhes: { autorizacaoId: ticketExistente.autorizacaoId, descobertaExecutada: false },
        agora,
      })
    );
    return base({
      situacao: 'RECUSADA',
      encerrarEtapaFiscal: true,
      motivo: 'Page autenticada ausente; homologação recusada sem legado.',
      codigoErro: 'CONTEXTO_INVALIDO',
      autorizacaoId: ticketExistente.autorizacaoId,
      ticket: ticketExistente,
    });
  }

  // --- Gate fechado (H2.2.1): validar SEM consumir ---
  if (!execucaoRealDiscoveryOnlyHabilitada()) {
    let ticketValidado: TicketAutorizacaoOperacional;
    try {
      ticketValidado = await canal.validarSemConsumir(entrada.execucaoId, contexto);
    } catch (erro) {
      const codigo =
        erro instanceof HomologacaoNfseError ? erro.codigo : ('CONTEXTO_INVALIDO' as const);
      evidencias.push(
        registrarEvidenciaHomologacao({
          execucaoId: entrada.execucaoId,
          cnpj: entrada.cnpj,
          periodoConsulta: entrada.periodoConsulta,
          operacao: 'DISCOVERY_ONLY',
          evento: 'ponte_validacao_recusada',
          detalhes: {
            codigo,
            mensagem: erro instanceof Error ? erro.message.slice(0, 200) : 'erro',
            ticketConsumido: false,
            descobertaExecutada: false,
          },
          agora,
        })
      );
      return base({
        situacao: 'RECUSADA',
        encerrarEtapaFiscal: true,
        motivo: `Validação de autorização recusada (${codigo}); ticket não consumido; sem legado.`,
        codigoErro: codigo,
        autorizacaoId: ticketExistente.autorizacaoId,
        ticket: ticketExistente,
        ticketConsumido: false,
      });
    }

    evidencias.push(
      registrarEvidenciaHomologacao({
        execucaoId: entrada.execucaoId,
        cnpj: entrada.cnpj,
        periodoConsulta: entrada.periodoConsulta,
        operacao: 'DISCOVERY_ONLY',
        evento: 'ponte_preparada_gate_fechado',
        detalhes: {
          autorizacaoId: ticketValidado.autorizacaoId,
          estadoTicket: ticketValidado.estado,
          ticketConsumido: false,
          descobertaExecutada: false,
          navegacaoPortal: false,
          discoverNfse: false,
          sefin: false,
          coberturaFiscal: false,
          vereditoPass: false,
          maxPaginas: ticketValidado.autorizacao.limites.maxPaginas,
          maxDocumentos: ticketValidado.autorizacao.limites.maxDocumentos,
        },
        agora,
      })
    );

    return base({
      situacao: 'PREPARADA_GATE_FECHADO',
      encerrarEtapaFiscal: true,
      motivo:
        'Ticket DISCOVERY_ONLY validado sem consumo; gate real fechado — nenhuma descoberta, SEFIN, XML ou cobertura fiscal.',
      codigoErro: 'GATE_EXECUCAO_FECHADO',
      autorizacaoId: ticketValidado.autorizacaoId,
      ticket: ticketValidado,
      ticketConsumido: false,
    });
  }

  // --- Gate aberto (reservado H2.2.2): consome, mas H2.2.1 ainda bloqueia navegação ---
  let consumo;
  try {
    consumo = await canal.consumir(entrada.execucaoId, contexto, 'EXECUCAO_REAL');
  } catch (erro) {
    const codigo =
      erro instanceof HomologacaoNfseError ? erro.codigo : ('CONTEXTO_INVALIDO' as const);
    evidencias.push(
      registrarEvidenciaHomologacao({
        execucaoId: entrada.execucaoId,
        cnpj: entrada.cnpj,
        periodoConsulta: entrada.periodoConsulta,
        operacao: 'DISCOVERY_ONLY',
        evento: 'ponte_consumo_recusado',
        detalhes: {
          codigo,
          mensagem: erro instanceof Error ? erro.message.slice(0, 200) : 'erro',
          descobertaExecutada: false,
        },
        agora,
      })
    );
    return base({
      situacao: 'RECUSADA',
      encerrarEtapaFiscal: true,
      motivo: `Consumo de autorização recusado (${codigo}); sem fallback legado.`,
      codigoErro: codigo,
      autorizacaoId: ticketExistente.autorizacaoId,
      ticket: ticketExistente,
      ticketConsumido: false,
    });
  }

  evidencias.push(
    registrarEvidenciaHomologacao({
      execucaoId: entrada.execucaoId,
      cnpj: entrada.cnpj,
      periodoConsulta: entrada.periodoConsulta,
      operacao: 'DISCOVERY_ONLY',
      evento: 'ponte_gate_real_bloqueado',
      detalhes: {
        autorizacaoId: consumo.ticket.autorizacaoId,
        ticketConsumido: true,
        descobertaExecutada: false,
        motivo: 'H2.2.1 bloqueia navegação mesmo se gate constasse aberto.',
      },
      agora,
    })
  );

  return base({
    situacao: 'BLOQUEADA_GATE_REAL',
    encerrarEtapaFiscal: true,
    motivo: 'Gate aparentava aberto, mas H2.2.1 bloqueia navegação; ticket consumido sem descoberta.',
    codigoErro: 'GATE_EXECUCAO_FECHADO',
    autorizacaoId: consumo.ticket.autorizacaoId,
    ticket: consumo.ticket,
    ticketConsumido: true,
  });
}
