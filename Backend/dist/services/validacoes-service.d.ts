export type JobStatus = 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELED';
export interface ValidationJob {
    id: string;
    status: JobStatus;
    progress: number;
    total: number;
    ok: number;
    errors: number;
    processed: number;
}
export interface StartPayload {
    targets: ('CERTIFICADO' | 'CREDENCIAL')[];
    scope: {
        mode: 'SELECTED' | 'FILTERED' | 'ALL';
        empresa_ids?: number[];
    };
    filters?: Record<string, unknown>;
    options?: {
        concurrency?: number;
        timeoutSeconds?: number;
        stopOnConsecutiveErrors?: number;
    };
}
export declare function iniciarValidacao(payload: StartPayload): Promise<string>;
export declare function obterJob(jobId: string): ValidationJob | undefined;
export declare function cancelarJob(jobId: string): boolean;
//# sourceMappingURL=validacoes-service.d.ts.map