/**
 * Sessão MANUAL remota: screenshot do Playwright → Central → cliques → mouse no browser.
 * O desafio é resolvido no mesmo contexto do portal (não renderiza widget novo).
 */
import type { Page } from 'playwright';
import { type CaptchaFramePayload } from '../services/manual-captcha.service';
import type { CaptchaRequest, ManualCaptchaResult } from './captcha/types';
/**
 * Captura o viewport (CSS pixels) para mapear cliques 1:1.
 */
export declare function captureViewportFrame(page: Page, meta: {
    captchaId: string;
    attemptId: string;
    batchId: string;
    seq: number;
}): Promise<CaptchaFramePayload>;
/**
 * Publica frames e processa cliques/confirm até o modal fechar, skip ou timeout.
 */
export declare function resolverCaptchaPorCliquesRemotos(page: Page, request: CaptchaRequest): Promise<ManualCaptchaResult>;
//# sourceMappingURL=manual-captcha-remote.d.ts.map