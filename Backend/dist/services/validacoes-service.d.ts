/**
 * Serviço de validação em lote de certificados e credenciais.
 * Suporta SSE para atualizações em tempo real.
 */
import { Response } from 'express';
export type JobStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELED';
export interface ValidationProgressItem {
    empresa_id: number;
    cnpj?: string;
    razao_social?: string;
    step: 'cert' | 'cred';
    status: string;
    message?: string;
    updated_at?: string;
    cred_status?: string;
    cert_status?: string;
    status_geral?: string;
}
export interface ValidationJob {
    id: string;
    status: JobStatus;
    progress: number;
    total: number;
    ok: number;
    invalidas: number;
    erros: number;
    processed: number;
    items: ValidationProgressItem[];
    clients: Set<Response>;
    isRunning: boolean;
}
export interface IniciarPayload {
    empresa_ids: number[];
    validar_certificados: boolean;
    validar_credenciais: boolean;
    headless?: boolean;
}
export declare function registrarClienteSSE(jobId: string, res: Response): void;
export declare function iniciarValidacao(payload: IniciarPayload): Promise<string>;
export declare function obterJob(jobId: string): ValidationJob | undefined;
export declare function cancelarJob(jobId: string): boolean;
export interface StartPayloadLegacy {
    targets: ('CERTIFICADO' | 'CREDENCIAL')[];
    scope: {
        mode: 'SELECTED' | 'FILTERED' | 'ALL';
        empresa_ids?: number[];
    };
    filters?: Record<string, unknown>;
}
export declare function iniciarValidacaoLegacy(payload: StartPayloadLegacy): Promise<string>;
//# sourceMappingURL=validacoes-service.d.ts.map