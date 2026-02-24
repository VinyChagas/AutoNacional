/**
 * Serviço de eventos SSE para execuções em tempo real.
 * Emite execution:started, execution:stage, execution:counts, execution:finished.
 */
import { Response } from 'express';
export type ExecutionEventType = 'execution:started' | 'execution:stage' | 'execution:counts' | 'execution:finished';
export interface ExecutionEventStarted {
    type: 'execution:started';
    empresa_id: string;
    cnpj: string;
    razao_social?: string;
    metodo: 'CERTIFICADO' | 'CREDENCIAL';
}
export interface ExecutionEventStage {
    type: 'execution:stage';
    empresa_id: string;
    stage: string;
    message: string;
}
export interface ExecutionEventCounts {
    type: 'execution:counts';
    empresa_id: string;
    qtd_emitidas: number;
    qtd_recebidas: number;
    qtd_canceladas?: number;
}
export interface ExecutionEventFinished {
    type: 'execution:finished';
    empresa_id: string;
    status: 'OK' | 'ERRO';
    message?: string;
    qtd_emitidas?: number;
    qtd_recebidas?: number;
    qtd_canceladas?: number;
    resultado_final?: string;
}
export interface ExecutionEventLoginReady {
    type: 'execution:login_ready';
    empresa_id: string;
    message: string;
}
export type ExecutionEvent = ExecutionEventStarted | ExecutionEventStage | ExecutionEventCounts | ExecutionEventFinished | ExecutionEventLoginReady;
export declare function registrarClienteSSE(batchId: string, res: Response): void;
export declare function emitirEventoExecucao(batchId: string | undefined, evento: ExecutionEvent): void;
//# sourceMappingURL=execution-events.service.d.ts.map