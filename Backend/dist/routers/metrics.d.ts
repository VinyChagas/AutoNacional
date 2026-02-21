declare const router: import("express-serve-static-core").Router;
export interface BillingSummaryResponse {
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
export default router;
//# sourceMappingURL=metrics.d.ts.map