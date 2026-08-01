/**
 * Contratos de provedores de resolução de hCaptcha.
 * Modo do lote (UI) é independente do CAPTCHA_MODE de ambiente (auto/manual/auto_manual).
 */
export type CaptchaMode = 'TWO_CAPTCHA' | 'MANUAL';
export declare const CAPTCHA_MODES: readonly CaptchaMode[];
export declare function parseCaptchaMode(value: unknown): CaptchaMode;
export declare function isCaptchaMode(value: unknown): value is CaptchaMode;
export interface CaptchaRequest {
    batchId: string;
    executionId: string;
    empresaId: string;
    empresaNome: string;
    cnpj: string;
    siteKey: string;
    pageUrl: string;
    rqdata?: string;
    action?: string;
    userAgent?: string;
    /** Timeout em segundos (padrão do serviço manual: 120). */
    timeoutSeconds?: number;
    /** Identificador da tentativa (diagnóstico). */
    attemptId?: string;
    callbackName?: string;
}
export type CaptchaSolutionStatus = 'RESOLVED' | 'SKIPPED' | 'TIMEOUT' | 'CANCELLED';
export interface CaptchaSolution {
    status: CaptchaSolutionStatus;
    captchaId?: string;
    attemptId?: string;
    token?: string;
    reason?: string;
    resolvedAt?: string;
}
export interface CaptchaProvider {
    readonly mode: CaptchaMode;
    solve(request: CaptchaRequest): Promise<CaptchaSolution>;
}
/** Modo de interação na Central: cliques remotos (padrão) ou token legado. */
export type ManualInteractionMode = 'remote_click' | 'token';
/** Último frame de screenshot publicado na sessão remota. */
export interface ManualCaptchaFrameMeta {
    seq: number;
    mime: 'image/jpeg' | 'image/png';
    base64: string;
    width: number;
    height: number;
    viewportWidth: number;
    viewportHeight: number;
    capturedAt: string;
}
/** Payload publicado na Central Manual (Socket.IO). */
export interface ManualCaptchaRequest {
    captchaId: string;
    attemptId: string;
    batchId: string;
    executionId: string;
    empresaId: string;
    empresaNome: string;
    cnpj: string;
    siteKey: string;
    pageUrl: string;
    interactionMode?: ManualInteractionMode;
    latestFrame?: ManualCaptchaFrameMeta;
    rqdata?: string;
    action?: string;
    userAgent?: string;
    callbackName?: string;
    payloadFingerprint: string;
    createdAt: string;
    expiresAt: string;
    timeoutSeconds: number;
    /** Quando CAPTCHA_DEBUG no backend. */
    debug?: boolean;
}
export type ManualCaptchaResult = {
    status: 'RESOLVED';
    captchaId: string;
    attemptId: string;
    /** Presente no modo token; ausente no remote_click. */
    token?: string;
    resolvedBy?: 'token' | 'remote_click' | 'confirm';
    resolvedAt: string;
} | {
    status: 'SKIPPED';
    captchaId: string;
    attemptId: string;
} | {
    status: 'TIMEOUT';
    captchaId: string;
    attemptId: string;
} | {
    status: 'CANCELLED';
    captchaId: string;
    attemptId: string;
    reason?: string;
};
//# sourceMappingURL=types.d.ts.map