/**
 * Serviço em memória para desafios hCaptcha da Central Manual.
 * Modo atual: remote_click (screenshot + cliques no Playwright).
 * Mantém resolveCaptcha(token) para compatibilidade/testes.
 */
import type { Server as SocketServer } from 'socket.io';
import type { CaptchaRequest, ManualCaptchaRequest, ManualCaptchaResult } from '../automation/captcha/types';
export type ManualCaptchaAck = {
    ok: true;
    captchaId: string;
    attemptId: string;
    tokenLength: number;
    tokenHash: string;
    receivedAt: string;
} | {
    ok: false;
    error: string;
    message?: string;
};
export interface CaptchaFramePayload {
    captchaId: string;
    attemptId: string;
    batchId: string;
    seq: number;
    mime: 'image/jpeg' | 'image/png';
    base64: string;
    width: number;
    height: number;
    viewportWidth: number;
    viewportHeight: number;
    capturedAt: string;
}
export interface RemoteCaptchaHandlers {
    onClick: (input: {
        xNorm: number;
        yNorm: number;
    }) => Promise<{
        ok: boolean;
        modalClosed?: boolean;
        error?: string;
        message?: string;
    }>;
    onRefresh: () => Promise<{
        ok: boolean;
        error?: string;
        message?: string;
    }>;
    onConfirm: () => Promise<{
        ok: boolean;
        modalClosed?: boolean;
        error?: string;
        message?: string;
    }>;
}
export declare function setManualCaptchaSocketServer(io: SocketServer): void;
export declare function roomName(batchId: string): string;
/**
 * Inicia sessão remota (screenshot + cliques). Retorna Promise + ids.
 */
export declare function beginRemoteCaptcha(input: CaptchaRequest, handlers: RemoteCaptchaHandlers): {
    captchaId: string;
    attemptId: string;
    promise: Promise<ManualCaptchaResult>;
};
export declare function publishCaptchaFrame(captchaId: string, frame: CaptchaFramePayload): boolean;
export declare function completeRemoteCaptcha(captchaId: string, resolvedBy?: 'remote_click' | 'confirm'): boolean;
export declare function handleRemoteClick(input: {
    batchId: string;
    captchaId: string;
    xNorm: number;
    yNorm: number;
}): Promise<ManualCaptchaAck>;
export declare function handleRemoteRefresh(input: {
    batchId: string;
    captchaId: string;
}): Promise<ManualCaptchaAck>;
export declare function handleRemoteConfirm(input: {
    batchId: string;
    captchaId: string;
}): Promise<ManualCaptchaAck>;
/**
 * Cria desafio legado (token). Preferir beginRemoteCaptcha no fluxo MANUAL.
 */
export declare function requestCaptcha(input: CaptchaRequest): Promise<ManualCaptchaResult>;
export declare function resolveCaptcha(input: {
    batchId: string;
    captchaId: string;
    token: string;
    attemptId?: string;
}): ManualCaptchaAck;
export declare function skipCaptcha(input: {
    batchId: string;
    captchaId: string;
}): ManualCaptchaAck;
export declare function cancelByExecution(executionId: string, reason?: string): void;
export declare function cancelByBatch(batchId: string, reason?: string): void;
/** Snapshot dos desafios pendentes (inclui latestFrame se houver). */
export declare function listPendingByBatch(batchId: string): ManualCaptchaRequest[];
export declare function __getPendingCountForTests(): number;
export declare function __resetManualCaptchaStateForTests(): void;
export declare function getSocketServer(): SocketServer | null;
//# sourceMappingURL=manual-captcha.service.d.ts.map