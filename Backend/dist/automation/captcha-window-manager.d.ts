/**
 * Gerenciador de slots visuais para janelas Chromium.
 *
 * Fluxo correto:
 * 1) reserveSlot() ANTES do launch
 * 2) Chromium abre já na posição/tamanho do slot (--window-position / --window-size)
 * 3) Janela permanece no slot durante toda a execução
 * 4) release() somente quando o navegador for fechado
 *
 * A resolução configurada (viewportPreset) é a área do MONITOR, não o tamanho
 * de cada janela.
 */
import { type AutomationBrowserWindowSize } from './viewport-resolution';
/** Margem nas bordas do monitor (px). */
export declare const CAPTCHA_LAYOUT_MARGIN_PX = 12;
/** Espaçamento entre janelas (px). */
export declare const CAPTCHA_LAYOUT_GAP_PX = 10;
/** Reserva para barra de tarefas / bordas do SO (px). */
export declare const CAPTCHA_LAYOUT_TASKBAR_PX = 48;
/**
 * Largura fixa da janela Chromium / viewport Playwright (px) desde o launch.
 * O portal NFSe só exibe o botão "Certificado Digital" a partir de ~769px
 * (breakpoint responsivo). Abaixo disso o layout mobile esconde o botão.
 */
export declare const BROWSER_WINDOW_WIDTH = 769;
/** Alias usado no cálculo de layout (largura fixa da janela). */
export declare const CAPTCHA_MIN_SLOT_WIDTH = 769;
/** Altura mínima útil da janela (px). */
export declare const CAPTCHA_MIN_SLOT_HEIGHT = 680;
/**
 * No Chromium, `--window-size` define a área de conteúdo (≈ viewport Playwright).
 * Não subtrair “chrome” alto aqui — isso gerava viewport ~591px e o portal
 * NFSe não renderizava o botão de certificado (falha em ~500ms).
 */
/** Fallback quando layout está desabilitado / headless (não usar resolução do monitor). */
export declare const DEFAULT_BROWSER_WINDOW: AutomationBrowserWindowSize;
export interface CaptchaSlotBounds {
    index: number;
    left: number;
    top: number;
    width: number;
    height: number;
}
export interface CaptchaSlotLayout {
    monitorWidth: number;
    monitorHeight: number;
    cols: number;
    rows: number;
    maxSlots: number;
    slotWidth: number;
    slotHeight: number;
    slots: CaptchaSlotBounds[];
}
export interface CalcularLayoutParams {
    monitorWidth: number;
    monitorHeight: number;
    maxSimultaneous: number;
    marginPx?: number;
    gapPx?: number;
    taskbarReservePx?: number;
    minSlotWidth?: number;
    minSlotHeight?: number;
}
/**
 * Slot reservado antes do launch — a janela deve abrir diretamente aqui
 * e permanecer até o fechamento do browser.
 */
export interface ReservedBrowserSlot {
    leaseId: string;
    slotId: number;
    left: number;
    top: number;
    width: number;
    height: number;
    /** Viewport Playwright (área de conteúdo). */
    viewport: AutomationBrowserWindowSize;
    /** Args Chromium para abrir já posicionado. */
    launchArgs: string[];
    /** Libera o slot (chamar ao fechar o navegador). */
    release(): void;
}
export interface ReserveSlotOptions {
    enabled?: boolean;
}
/**
 * Calcula grade dinâmica de slots a partir da resolução do MONITOR.
 *
 * A última linha pode ser parcial (ex.: 5 colunas × 2 linhas com 8 slots).
 * Nunca reduz linhas para forçar retângulo cols×rows === maxSlots.
 */
export declare function calcularLayoutCaptcha(params: CalcularLayoutParams): CaptchaSlotLayout;
/** Garante que nenhum par de slots se sobrepõe (área interior). */
export declare function slotsSemSobreposicao(slots: CaptchaSlotBounds[]): boolean;
/**
 * Viewport Playwright = área de conteúdo do Chromium (= `--window-size`).
 * Usa o tamanho do slot integralmente para o portal desktop renderizar.
 */
export declare function viewportForWindowSize(window: AutomationBrowserWindowSize): AutomationBrowserWindowSize;
export declare function buildLaunchArgsForSlot(slot: CaptchaSlotBounds): string[];
/**
 * Capacidade visual atual (maxSlots) a partir das settings — para alinhar a PQueue.
 */
export declare function getVisualSlotCapacityFromSettings(): Promise<number>;
export declare class CaptchaWindowManager {
    private occupied;
    private reservations;
    private waiters;
    private layout;
    private claimChain;
    getCurrentLayout(): CaptchaSlotLayout | null;
    getOccupiedCount(): number;
    refreshLayoutFromSettings(): Promise<CaptchaSlotLayout>;
    private findFreeSlotIndex;
    private takeNextWaiter;
    /**
     * Reserva um índice livre. Se a grade estiver cheia, registra o waiter
     * DENTRO do mesmo lock do claim — evita race em que o release ocorre
     * entre o "não há slot" e o registro na fila de espera.
     */
    private claimSlotIndex;
    /**
     * Reserva um slot visual ANTES de iniciar o Chromium.
     * O caller deve passar launchArgs/viewport ao launch e chamar release()
     * somente ao fechar o navegador.
     */
    reserveSlot(leaseId: string, options?: ReserveSlotOptions): Promise<ReservedBrowserSlot>;
    private releaseSlot;
    private createFallbackSlot;
    _resetForTests(): void;
}
/** Singleton do gerenciador de slots visuais. */
export declare const captchaWindowManager: CaptchaWindowManager;
//# sourceMappingURL=captcha-window-manager.d.ts.map