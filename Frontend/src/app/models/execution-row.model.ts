/**
 * Model para linha de execução na tela de Execução de Processos.
 * Cada empresa ocupa 1 linha na tabela unificada.
 */
export type ExecutionRowStatus = 'FILA' | 'EM_EXECUCAO' | 'OK' | 'ERRO';
export type ExecutionRowMetodo = 'CERTIFICADO' | 'CREDENCIAL';

export interface ExecutionRow {
  empresa_id: string | number;
  cnpj: string;
  razao_social: string;
  metodo: ExecutionRowMetodo;
  qtd_emitidas: number;
  qtd_recebidas: number;
  qtd_canceladas: number;
  status: ExecutionRowStatus;
  mensagem: string;
  started_at?: string;
  finished_at?: string;
}
