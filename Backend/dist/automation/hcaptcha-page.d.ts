/**
 * Utilitários de detecção/injeção de hCaptcha na página Playwright.
 * Compartilhados entre provedores 2Captcha e Central Manual.
 */
import { Page } from 'playwright';
import type { PortalCaptchaResult } from './captcha-diagnostic';
export declare const CAPTCHA_SUBMIT_SELECTOR = "#btnSubmitHCaptcha";
export interface DadosCaptcha {
    sitekey: string;
    /** Sempre a URL da página principal do portal (nunca URL do iframe hCaptcha). */
    pageurl: string;
    /** Opcional: só presente quando houver valor real. */
    rqdata?: string;
    action?: string;
    callbackName?: string;
}
/** Extrai sitekey / pageurl / rqdata / action do modal hCaptcha aberto. */
export declare function capturarDadosCaptcha(page: Page): Promise<DadosCaptcha | null>;
export interface InjecaoTokenResultado {
    fieldsFound: number;
    fieldsFilled: number;
    eventsDispatched: string[];
    callbackExecuted: boolean;
    callbackName?: string;
    fieldDetails: Array<{
        name?: string;
        id?: string;
        beforeLen: number;
        afterLen: number;
        frameUrl: string;
    }>;
}
/**
 * Preenche campos h-captcha-response em TODOS os frames, dispara input/change
 * e invoca data-callback nomeado quando existir.
 */
export declare function injetarTokenHCaptcha(page: Page, token: string, options?: {
    callbackName?: string;
}): Promise<InjecaoTokenResultado>;
export interface PortalObservacao {
    result: PortalCaptchaResult;
    requestSent: boolean;
    responseStatus?: number;
    message?: string;
    modalVisibleAfter: boolean;
    relevantUrls: string[];
}
/**
 * Observa rede/modal após clique no Confirmar para classificar aceitação do portal.
 */
export declare function observarResultadoPortalAposSubmit(page: Page, submitAction: () => Promise<void>, observeMs?: number): Promise<PortalObservacao>;
/**
 * Injeta o token, dispara callback/eventos e clica em Confirmar do modal NFSe.
 * Quando CAPTCHA_DEBUG, observa a resposta do portal.
 */
export declare function aplicarTokenCaptchaNaPagina(page: Page, token: string, options?: {
    callbackName?: string;
    observePortal?: boolean;
}): Promise<{
    injection: InjecaoTokenResultado;
    portal?: PortalObservacao;
}>;
//# sourceMappingURL=hcaptcha-page.d.ts.map