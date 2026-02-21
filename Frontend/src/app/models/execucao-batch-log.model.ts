/**
 * Interfaces para persistência de logs de lote de execução NFSe.
 * Compatível com POST /api/logs/execucoes/salvar
 */

export interface ExecutionBatchLogItem {
  empresa_id: string;
  cnpj: string;
  nome_empresa: string;
  tipo_autenticacao?: 'certificado' | 'credenciais';
  status_final: 'finalizado' | 'falhou';
  qtd_emitidas: number;
  qtd_recebidas: number;
  resultado_final?: string;
  started_at?: string;
  finished_at?: string;
  erro_msg?: string;
}

export interface ExecutionBatchLogPayload {
  batch_id: string;
  contabilidade_id: string;
  competencia: string;
  dataInicio: string | null;
  dataFim: string | null;
  tipo: 'ambas' | 'emitidas' | 'recebidas';
  headless: boolean;
  totais: {
    total_empresas: number;
    total_sucesso: number;
    total_falha: number;
    total_emitidas: number;
    total_recebidas: number;
    totais_por_resultado: Record<string, number>;
  };
  itens: ExecutionBatchLogItem[];
}
