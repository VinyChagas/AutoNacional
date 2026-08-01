/**
 * Instrumentação e evidências da Central Manual de Captchas.
 * Ativa somente com CAPTCHA_DEBUG=true.
 */
import type { Page } from 'playwright';
export type PortalCaptchaResult = 'ACCEPTED' | 'REJECTED' | 'NO_REQUEST_SENT' | 'CALLBACK_NOT_EXECUTED' | 'MODAL_REMAINED_OPEN' | 'NEW_CHALLENGE_CREATED' | 'UNKNOWN';
export interface TokenFingerprint {
    tokenLength: number;
    tokenHash: string;
    tokenPreview: string;
}
export interface CaptchaOriginalPageSnapshot {
    batchId: string;
    executionId: string;
    captchaId?: string;
    attemptId: string;
    pageUrl: string;
    hostname: string;
    origin: string;
    userAgent: string;
    siteKey?: string;
    rqdata?: string;
    action?: string;
    callbackName?: string;
    iframeCount: number;
    iframeSrcSanitized: string[];
    responseFields: Array<{
        name?: string;
        id?: string;
        valueLength: number;
        frameUrl?: string;
    }>;
    modalVisible: boolean;
    capturedAt: string;
}
export interface CaptchaDiagnosticReport {
    identifiers: {
        batchId: string;
        executionId: string;
        empresaId: string;
        captchaId: string;
        attemptId: string;
    };
    originalPage: {
        pageUrl: string;
        hostname: string;
        siteKeyPresent: boolean;
        rqdataPresent: boolean;
        actionPresent: boolean;
        callbackDetected: boolean;
    };
    central: {
        payloadIntegrity: boolean;
        widgetRendered?: boolean;
        widgetId?: string;
        tokenGenerated?: boolean;
    };
    tokenFlow: {
        frontendHash?: string;
        socketHash?: string;
        serviceHash?: string;
        providerHash?: string;
        playwrightHash?: string;
        allHashesMatch: boolean;
    };
    injection: {
        responseFieldsFound: number;
        fieldsFilled: number;
        callbackExecuted: boolean;
        eventsDispatched: string[];
    };
    portal: {
        requestSent: boolean;
        responseStatus?: number;
        result: PortalCaptchaResult;
        message?: string;
    };
    classification: string;
    probableCause: string;
    evidence: string[];
    timings?: {
        detectedAt?: string;
        publishedAt?: string;
        tokenReceivedAt?: string;
        injectedAt?: string;
        submittedAt?: string;
    };
}
export declare function isCaptchaDebug(): boolean;
export declare function newAttemptId(): string;
export declare function fingerprintToken(token: string): TokenFingerprint;
export declare function payloadFingerprint(parts: {
    captchaId: string;
    attemptId: string;
    siteKey: string;
    pageUrl: string;
    rqdata?: string;
    action?: string;
}): string;
export declare function sanitizeUrl(url: string): string;
export declare function initAttemptReport(input: {
    batchId: string;
    executionId: string;
    empresaId: string;
    captchaId: string;
    attemptId: string;
    snapshot?: CaptchaOriginalPageSnapshot;
}): CaptchaDiagnosticReport;
export declare function recordTokenHash(attemptId: string, layer: 'frontend' | 'socket' | 'service' | 'provider' | 'playwright', token: string): TokenFingerprint;
export declare function appendEvidence(attemptId: string, evidence: string): void;
export declare function patchReport(attemptId: string, patch: Partial<CaptchaDiagnosticReport>): void;
export declare function finalizeAttemptReport(attemptId: string, classification: string, probableCause: string): CaptchaDiagnosticReport | null;
export declare function getAttemptReport(attemptId: string): CaptchaDiagnosticReport | null;
export declare function ensureDebugDir(batchId: string, executionId: string, attemptId: string): Promise<string | null>;
export declare function writeDiagnosticJson(attemptId: string): Promise<string | null>;
export declare function captureDebugScreenshot(page: Page, attemptId: string, name: string): Promise<void>;
/**
 * Snapshot rico da página original no momento do hCaptcha.
 */
export declare function captureOriginalPageSnapshot(page: Page, ids: {
    batchId: string;
    executionId: string;
    attemptId: string;
    captchaId?: string;
}): Promise<CaptchaOriginalPageSnapshot>;
export declare function clearAttempt(attemptId: string): void;
export declare function clearAllAttemptsForTests(): void;
export declare function classifyFromPortalResult(result: PortalCaptchaResult, hashesMatch: boolean): {
    classification: string;
    probableCause: string;
};
//# sourceMappingURL=captcha-diagnostic.d.ts.map