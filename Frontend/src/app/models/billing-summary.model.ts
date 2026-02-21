export interface BillingSummary {
  competencia: string;
  contabilidade_id: number | null;
  empresas_processadas_total: number;
  empresas_ok: number;
  empresas_erro: number;
  nf_emitidas: number;
  nf_recebidas: number;
  nf_canceladas: number;
  total_notas: number;
  tempo_total_segundos?: number;
  tempo_medio_por_empresa_segundos?: number;
}
