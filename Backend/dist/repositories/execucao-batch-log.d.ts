export interface ExecucaoBatchLogCreate {
    batchId: string;
    contabilidadeId?: number | null;
    competencia: string;
    dataInicio: string;
    dataFim: string;
    tipo: string;
    headless: boolean;
    totalEmpresas: number;
    totalSucesso: number;
    totalFalha: number;
    totalEmitidas: number;
    totalRecebidas: number;
    totaisPorResultado?: Record<string, number>;
    itens: unknown[];
}
export declare function criarExecucaoBatchLog(data: ExecucaoBatchLogCreate): Promise<{
    id: number;
}>;
export declare function existeBatchLog(batchId: string): Promise<boolean>;
//# sourceMappingURL=execucao-batch-log.d.ts.map