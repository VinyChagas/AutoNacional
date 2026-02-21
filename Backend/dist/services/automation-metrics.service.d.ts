export interface CriarBatchInput {
    batchId: string;
    competencia: string;
    contabilidadeId: number | null;
    totalEmpresas: number;
}
export interface PersistirExecutionInput {
    batchId: string;
    empresaId: number;
    empresaCnpj: string;
    contabilidadeId: number | null;
    competencia: string;
    status: 'OK' | 'ERRO';
    loginMetodo?: 'CERTIFICADO' | 'CREDENCIAL';
    qtdEmitidas: number;
    qtdRecebidas: number;
    qtdCanceladas: number;
    tempoExecucaoSegundos: number;
    erroResumo?: string | null;
    startedAt: Date | null;
    finishedAt: Date | null;
}
/**
 * Cria um batch de execução (ao clicar Iniciar).
 * Chamado pelo router POST /multiplas.
 */
export declare function criarBatch(input: CriarBatchInput): Promise<void>;
/**
 * Persiste a execução de 1 empresa (ao finalizar - OK ou ERRO).
 * Chamado pelo execution-service em execution:finished.
 * Usa UPSERT para evitar duplicatas (unique batch_id, empresa_id).
 */
export declare function persistirExecution(input: PersistirExecutionInput): Promise<void>;
//# sourceMappingURL=automation-metrics.service.d.ts.map