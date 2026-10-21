/**
 * Model para linha de execução na tela de Execução de Processos.
 * Cada empresa ocupa 1 linha na tabela unificada.
 */
import type { ProgressoFiscalNfse } from './progresso-fiscal.model';
import type { MetricasOperacionaisApi } from './metricas-operacionais.model';

export type ExecutionRowStatus = 'FILA' | 'EM_EXECUCAO' | 'AGUARDANDO_CAPTCHA' | 'OK' | 'ERRO';
export type ExecutionRowMetodo = 'CERTIFICADO' | 'CREDENCIAL';
/** Motor efetivo após roteamento Iniciar (API-02K: PORTAL_SEFIN padrão A1). */
export type ExecutionRowMotor = 'ADN' | 'PLAYWRIGHT' | 'PORTAL_SEFIN';

export interface ExecutionRow {
  empresa_id: string | number;
  cnpj: string;
  razao_social: string;
  metodo: ExecutionRowMetodo;
  /** Ausente até o backend informar o roteamento. */
  motor?: ExecutionRowMotor | null;
  /**
   * Competência fiscal consultada (YYYY-MM), vinda do Backend / período Iniciar.
   * Não confundir com o mês da pasta de downloads operacionais.
   */
  competencia_fiscal?: string | null;
  qtd_emitidas: number;
  qtd_recebidas: number;
  qtd_canceladas: number;
  status: ExecutionRowStatus;
  mensagem: string;
  started_at?: string;
  finished_at?: string;
  /** Último stage SSE (execution:stage) — opcional, para visão fiscal UI-01d. */
  ultimo_stage?: string;
  /** resultado_final do finished/polling quando disponível (ex.: HOMOLOGACAO_DISCOVERY_ONLY_*). */
  resultado_final?: string;
  /** ID Prisma da execução (canônico do progresso fiscal). */
  execucao_id?: string;
  /** Progresso fiscal estruturado (UI-01e-C); ausente = fallback UI-01d. */
  progresso_fiscal?: ProgressoFiscalNfse;
  /** Sequência local de aplicação aceita (não é versão Backend). */
  fiscal_seq?: number;
  /** API-02W — durações/contadores; ausente = UI mostra "—". */
  metricas_operacionais?: MetricasOperacionaisApi | null;
}
