/**
 * Tratamento MANUAL de hCaptcha no navegador Playwright (Portal Nacional NFSe).
 *
 * A janela já deve estar no slot visual desde o launch (captcha-window-manager).
 * Este handler NÃO redimensiona, NÃO reposiciona e NÃO restaura a janela.
 *
 * Fluxo:
 * 1) Aguarda o modal
 * 2) Espera 2,5s (animação)
 * 3) Tab → 0,5s → Tab → 0,5s → Enter — abre o desafio
 * 4) Usuário resolve no navegador visível
 * 5) Detecta token legítimo em h-captcha-response
 * 6) Clica em Confirmar (#btnSubmitHCaptcha)
 *
 * Não resolve, não injeta e não contorna o captcha.
 */
import { Page, Locator } from 'playwright';
/** Delay após o modal aparecer, antes das teclas (animação). */
export declare const MODAL_ANIMATION_DELAY_MS = 2500;
/** Intervalo entre Tab → Tab → Enter. */
export declare const KEYBOARD_STEP_DELAY_MS = 500;
/** Intervalo padrão de polling do token. */
export declare const TOKEN_POLL_INTERVAL_MS = 1000;
export interface CaptchaContexto {
    executionId?: string;
    empresaId?: string;
    batchId?: string;
    operationId?: string;
    tipoArquivo?: 'xml' | 'pdf';
    tipoNota?: string;
}
export interface CaptchaOptions {
    /** Timeout total aguardando resolução (ms). */
    timeoutMs?: number;
    /** Delay após modal visível antes de Tab/Enter (padrão 2500). */
    modalAnimationDelayMs?: number;
    /** Intervalo entre cada tecla Tab/Enter (padrão 500). */
    keyboardStepDelayMs?: number;
    /** Intervalo de polling do token (padrão 1000). */
    pollIntervalMs?: number;
    /** Se true, não espera o modal aparecer (já detectado pelo caller). */
    modalJaVisivel?: boolean;
    /** Timeout para detectar o modal (quando modalJaVisivel=false). */
    detectTimeoutMs?: number;
    /** Callback de estágio (SSE / logs). */
    onStage?: (stage: string, message: string) => void;
}
export type CaptchaResultStatus = 'RESOLVED' | 'TIMEOUT' | 'MODAL_NOT_FOUND' | 'CONFIRM_FAILED';
export interface CaptchaResult {
    status: CaptchaResultStatus;
    tokenDetected: boolean;
    modalClosed: boolean;
    reason?: string;
}
type ConfirmCandidate = {
    name: string;
    get: () => Locator;
};
/** Seletores do Confirmar: ID → XPath por id → XPath absoluto (último fallback). */
export declare function obterCandidatosBotaoConfirmar(page: Page): ConfirmCandidate[];
/**
 * Verifica se há token legítimo em h-captcha-response / g-recaptcha-response
 * na página principal ou em frames.
 */
export declare function tokenHCaptchaPreenchido(page: Page): Promise<boolean>;
/**
 * Abre o desafio hCaptcha com Tab × 2 + Enter (após delay da animação).
 * Intervalo de meio segundo entre cada tecla.
 */
export declare function abrirDesafioComTeclado(page: Page, delayMs?: number, stepDelayMs?: number): Promise<void>;
/**
 * Clica em Confirmar priorizando #btnSubmitHCaptcha.
 */
export declare function clicarBotaoConfirmarHCaptcha(page: Page): Promise<string>;
/**
 * Trata o modal de hCaptcha de forma estritamente MANUAL no navegador.
 * Não altera tamanho/posição da janela (já fixada no slot desde o launch).
 */
export declare function tratarHCaptchaManual(page: Page, contexto: CaptchaContexto, opcoes?: CaptchaOptions): Promise<CaptchaResult>;
export {};
//# sourceMappingURL=hcaptcha-manual-handler.d.ts.map