/**
 * Contrato do canal operacional H2.2.1 — ticket vinculado ao execucaoId.
 */
import type { AutorizacaoHomologacaoNfse } from './types';
import type { PeriodoConsultaPortal } from '../contracts/periodo';

export const ESTADOS_TICKET_AUTORIZACAO = [
  'DISPONIVEL',
  'CONSUMIDA',
  'EXPIRADA',
  'CANCELADA',
  'FALHA',
] as const;
export type EstadoTicketAutorizacao = (typeof ESTADOS_TICKET_AUTORIZACAO)[number];

/**
 * Ticket operacional: autorização H1 + identificador único + estado de consumo.
 * Somente DISCOVERY_ONLY é aceito neste canal.
 */
export interface TicketAutorizacaoOperacional {
  readonly versao: 1;
  readonly autorizacaoId: string;
  readonly autorizacao: AutorizacaoHomologacaoNfse;
  readonly estado: EstadoTicketAutorizacao;
  readonly emitidoEm: string;
  readonly consumidoEm?: string;
  readonly motivoConsumo?: string;
}

export interface ContextoConsumoAutorizacao {
  readonly execucaoId: string;
  readonly cnpj: string;
  readonly periodoConsulta: PeriodoConsultaPortal;
  readonly diretorioFiscal: string;
  readonly agora?: Date;
}

export type MotivoConsumoAutorizacao =
  | 'EXECUCAO_REAL'
  | 'FALHA'
  | 'TIMEOUT'
  | 'CANCELAMENTO'
  | 'TESTE';

export interface ResultadoConsumoAutorizacao {
  readonly ticket: TicketAutorizacaoOperacional;
  readonly consumidoAgora: boolean;
}

export interface CanalAutorizacaoHomologacao {
  /** Emite ticket DISPONIVEL. Recusa SEFIN e genéricos. */
  emitir(ticket: Omit<TicketAutorizacaoOperacional, 'estado' | 'consumidoEm' | 'motivoConsumo'>): Promise<TicketAutorizacaoOperacional>;
  /** Consulta sem consumir. */
  consultar(execucaoId: string): Promise<TicketAutorizacaoOperacional | null>;
  /**
   * Valida vínculo sem alterar estado (gate fechado / preparação).
   * Não cria lease nem consome.
   */
  validarSemConsumir(
    execucaoId: string,
    contexto: ContextoConsumoAutorizacao
  ): Promise<TicketAutorizacaoOperacional>;
  /**
   * Consome atomicamente uma única vez (somente para execução real — H2.2.2+).
   * Valida vínculo execucaoId/CNPJ/período/diretório e operação DISCOVERY_ONLY.
   */
  consumir(
    execucaoId: string,
    contexto: ContextoConsumoAutorizacao,
    motivo: MotivoConsumoAutorizacao
  ): Promise<ResultadoConsumoAutorizacao>;
  /** Marca cancelamento sem permitir reuso. */
  cancelar(autorizacaoId: string, motivo: string): Promise<void>;
}
