"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.captchaWindowManager = exports.CaptchaWindowManager = exports.DEFAULT_BROWSER_WINDOW = exports.CAPTCHA_MIN_SLOT_HEIGHT = exports.CAPTCHA_MIN_SLOT_WIDTH = exports.BROWSER_WINDOW_WIDTH = exports.CAPTCHA_LAYOUT_TASKBAR_PX = exports.CAPTCHA_LAYOUT_GAP_PX = exports.CAPTCHA_LAYOUT_MARGIN_PX = void 0;
exports.calcularLayoutCaptcha = calcularLayoutCaptcha;
exports.slotsSemSobreposicao = slotsSemSobreposicao;
exports.viewportForWindowSize = viewportForWindowSize;
exports.buildLaunchArgsForSlot = buildLaunchArgsForSlot;
exports.getVisualSlotCapacityFromSettings = getVisualSlotCapacityFromSettings;
const logger_1 = require("../infrastructure/logger");
const settingsRepo = __importStar(require("../repositories/settings"));
const viewport_resolution_1 = require("./viewport-resolution");
const logger = (0, logger_1.getLogger)('captcha-window-manager');
/** Margem nas bordas do monitor (px). */
exports.CAPTCHA_LAYOUT_MARGIN_PX = 12;
/** Espaçamento entre janelas (px). */
exports.CAPTCHA_LAYOUT_GAP_PX = 10;
/** Reserva para barra de tarefas / bordas do SO (px). */
exports.CAPTCHA_LAYOUT_TASKBAR_PX = 48;
/**
 * Largura fixa da janela Chromium / viewport Playwright (px) desde o launch.
 * O portal NFSe só exibe o botão "Certificado Digital" a partir de ~769px
 * (breakpoint responsivo). Abaixo disso o layout mobile esconde o botão.
 */
exports.BROWSER_WINDOW_WIDTH = 769;
/** Alias usado no cálculo de layout (largura fixa da janela). */
exports.CAPTCHA_MIN_SLOT_WIDTH = exports.BROWSER_WINDOW_WIDTH;
/** Altura mínima útil da janela (px). */
exports.CAPTCHA_MIN_SLOT_HEIGHT = 680;
/**
 * No Chromium, `--window-size` define a área de conteúdo (≈ viewport Playwright).
 * Não subtrair “chrome” alto aqui — isso gerava viewport ~591px e o portal
 * NFSe não renderizava o botão de certificado (falha em ~500ms).
 */
/** Fallback quando layout está desabilitado / headless (não usar resolução do monitor). */
exports.DEFAULT_BROWSER_WINDOW = {
    width: exports.BROWSER_WINDOW_WIDTH,
    height: 720,
};
/**
 * Máximo de células que cabem em `available` com tamanho mínimo e gap.
 * n * minSize + (n - 1) * gap <= available
 */
function maxCellsFitting(available, minSize, gap) {
    if (available < minSize)
        return 1;
    return Math.max(1, Math.floor((available + gap) / (minSize + gap)));
}
/**
 * Calcula grade dinâmica de slots a partir da resolução do MONITOR.
 *
 * A última linha pode ser parcial (ex.: 5 colunas × 2 linhas com 8 slots).
 * Nunca reduz linhas para forçar retângulo cols×rows === maxSlots.
 */
function calcularLayoutCaptcha(params) {
    const margin = params.marginPx ?? exports.CAPTCHA_LAYOUT_MARGIN_PX;
    const gap = params.gapPx ?? exports.CAPTCHA_LAYOUT_GAP_PX;
    const taskbar = params.taskbarReservePx ?? exports.CAPTCHA_LAYOUT_TASKBAR_PX;
    const minW = params.minSlotWidth ?? exports.CAPTCHA_MIN_SLOT_WIDTH;
    const minH = params.minSlotHeight ?? exports.CAPTCHA_MIN_SLOT_HEIGHT;
    // Permite encolher ~6% na altura para caber mais uma linha (ex.: 1440 → 2 linhas)
    const minHFlexible = Math.max(640, Math.floor(minH * 0.94));
    const maxSimultaneous = Math.max(1, Math.floor(params.maxSimultaneous || 1));
    const monitorWidth = Math.max(640, Math.floor(params.monitorWidth));
    const monitorHeight = Math.max(480, Math.floor(params.monitorHeight));
    const availableWidth = Math.max(minW, monitorWidth - margin * 2);
    const availableHeight = Math.max(minHFlexible, monitorHeight - taskbar - margin * 2);
    let cols = maxCellsFitting(availableWidth, minW, gap);
    while (cols > 1 && cols * minW + (cols - 1) * gap > availableWidth) {
        cols -= 1;
    }
    let rows = maxCellsFitting(availableHeight, minHFlexible, gap);
    while (rows > 1) {
        const h = Math.floor((availableHeight - (rows - 1) * gap) / rows);
        if (h >= minHFlexible)
            break;
        rows -= 1;
    }
    const gridCapacity = cols * rows;
    // Quantidade real de janelas (última linha pode ser parcial)
    const maxSlots = Math.min(gridCapacity, maxSimultaneous);
    // Linhas geométricas necessárias para posicionar maxSlots (sem colapsar a 2ª linha)
    const usedRows = Math.min(rows, Math.max(1, Math.ceil(maxSlots / cols)));
    // Largura fixa da janela (769px) — não esticar para preencher o monitor
    const slotWidth = minW;
    const slotHeight = Math.min(minH, Math.floor((availableHeight - (usedRows - 1) * gap) / usedRows));
    const slots = [];
    for (let i = 0; i < maxSlots; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        slots.push({
            index: i,
            left: margin + col * (slotWidth + gap),
            top: margin + row * (slotHeight + gap),
            width: slotWidth,
            height: slotHeight,
        });
    }
    return {
        monitorWidth,
        monitorHeight,
        cols,
        rows: usedRows,
        maxSlots,
        slotWidth,
        slotHeight,
        slots,
    };
}
/** Garante que nenhum par de slots se sobrepõe (área interior). */
function slotsSemSobreposicao(slots) {
    for (let i = 0; i < slots.length; i++) {
        for (let j = i + 1; j < slots.length; j++) {
            const a = slots[i];
            const b = slots[j];
            const overlapX = a.left < b.left + b.width && a.left + a.width > b.left;
            const overlapY = a.top < b.top + b.height && a.top + a.height > b.top;
            if (overlapX && overlapY)
                return false;
        }
    }
    return true;
}
/**
 * Viewport Playwright = área de conteúdo do Chromium (= `--window-size`).
 * Usa o tamanho do slot integralmente para o portal desktop renderizar.
 */
function viewportForWindowSize(window) {
    return {
        // Sempre 769px de largura para o portal desktop (Certificado Digital)
        width: exports.BROWSER_WINDOW_WIDTH,
        height: Math.max(600, Math.floor(window.height)),
    };
}
function buildLaunchArgsForSlot(slot) {
    const vp = viewportForWindowSize(slot);
    return [
        `--window-position=${Math.round(slot.left)},${Math.round(slot.top)}`,
        `--window-size=${vp.width},${vp.height}`,
    ];
}
/**
 * Capacidade visual atual (maxSlots) a partir das settings — para alinhar a PQueue.
 */
async function getVisualSlotCapacityFromSettings() {
    const config = await settingsRepo.obterConfiguracoes();
    const monitor = (0, viewport_resolution_1.resolveMonitorResolutionFromSettings)(config);
    const maxSimultaneous = Math.max(1, config?.maxConcurrentBrowsers ?? config?.defaultConcurrentBrowsers ?? 3);
    const layout = calcularLayoutCaptcha({
        monitorWidth: monitor.width,
        monitorHeight: monitor.height,
        maxSimultaneous,
    });
    return layout.maxSlots;
}
class CaptchaWindowManager {
    occupied = new Map();
    reservations = new Set();
    waiters = [];
    layout = null;
    claimChain = Promise.resolve();
    getCurrentLayout() {
        return this.layout;
    }
    getOccupiedCount() {
        return this.occupied.size;
    }
    async refreshLayoutFromSettings() {
        const config = await settingsRepo.obterConfiguracoes();
        const monitor = (0, viewport_resolution_1.resolveMonitorResolutionFromSettings)(config);
        const maxSimultaneous = Math.max(1, config?.maxConcurrentBrowsers ??
            config?.defaultConcurrentBrowsers ??
            3);
        const next = calcularLayoutCaptcha({
            monitorWidth: monitor.width,
            monitorHeight: monitor.height,
            maxSimultaneous,
        });
        // Não encolhe a grade enquanto houver slots ocupados/reservados além do novo max
        const highestHeld = Math.max(-1, ...this.occupied.keys(), ...this.reservations.values());
        if (this.layout &&
            highestHeld >= 0 &&
            next.maxSlots <= highestHeld) {
            return this.layout;
        }
        this.layout = next;
        logger.info({
            monitorWidth: this.layout.monitorWidth,
            monitorHeight: this.layout.monitorHeight,
            cols: this.layout.cols,
            rows: this.layout.rows,
            maxSlots: this.layout.maxSlots,
            slotWidth: this.layout.slotWidth,
            slotHeight: this.layout.slotHeight,
            preset: config?.viewportPreset,
            maxSimultaneous,
        }, 'Layout de slots de navegador calculado (resolução do monitor)');
        return this.layout;
    }
    findFreeSlotIndex() {
        if (!this.layout)
            return null;
        for (const slot of this.layout.slots) {
            if (!this.occupied.has(slot.index) &&
                !this.reservations.has(slot.index)) {
                return slot.index;
            }
        }
        return null;
    }
    takeNextWaiter(slotIndex) {
        const next = this.waiters.shift();
        if (!next)
            return;
        this.reservations.add(slotIndex);
        next.resolve(slotIndex);
    }
    /**
     * Reserva um índice livre. Se a grade estiver cheia, registra o waiter
     * DENTRO do mesmo lock do claim — evita race em que o release ocorre
     * entre o "não há slot" e o registro na fila de espera.
     */
    claimSlotIndex(leaseId) {
        return new Promise((resolve, reject) => {
            const tryClaim = async () => {
                try {
                    await this.refreshLayoutFromSettings();
                    if (!this.layout || this.layout.maxSlots < 1) {
                        reject(new Error('Nenhum slot visual disponível no layout'));
                        return;
                    }
                    const idx = this.findFreeSlotIndex();
                    if (idx != null) {
                        this.reservations.add(idx);
                        resolve(idx);
                        return;
                    }
                    // Sem slot livre: entra na fila ainda sob o claimChain
                    this.waiters.push({ leaseId, resolve, reject });
                    logger.info({
                        leaseId,
                        waiting: this.waiters.length,
                        occupied: this.occupied.size,
                    }, 'Aguardando slot visual livre antes de abrir o navegador');
                }
                catch (e) {
                    reject(e instanceof Error ? e : new Error(String(e)));
                }
            };
            this.claimChain = this.claimChain.then(tryClaim, tryClaim);
        });
    }
    /**
     * Reserva um slot visual ANTES de iniciar o Chromium.
     * O caller deve passar launchArgs/viewport ao launch e chamar release()
     * somente ao fechar o navegador.
     */
    async reserveSlot(leaseId, options = {}) {
        const enabled = options.enabled !== false;
        if (!enabled) {
            return this.createFallbackSlot(leaseId);
        }
        let slotIndex;
        try {
            slotIndex = await this.claimSlotIndex(leaseId);
        }
        catch (e) {
            logger.warn({ err: e, leaseId }, 'Falha ao reservar slot — usando fallback');
            return this.createFallbackSlot(leaseId);
        }
        const slot = this.layout?.slots[slotIndex];
        if (!slot) {
            this.reservations.delete(slotIndex);
            this.takeNextWaiter(slotIndex);
            return this.createFallbackSlot(leaseId);
        }
        this.occupied.set(slotIndex, { leaseId, slot });
        this.reservations.delete(slotIndex);
        const viewport = viewportForWindowSize(slot);
        const launchArgs = buildLaunchArgsForSlot(slot);
        logger.info({
            leaseId,
            slotId: slot.index,
            left: slot.left,
            top: slot.top,
            width: slot.width,
            height: slot.height,
            viewport,
        }, 'Slot visual reservado — Chromium deve abrir nesta posição/tamanho');
        let released = false;
        const release = () => {
            if (released)
                return;
            released = true;
            this.releaseSlot(slotIndex, leaseId);
        };
        return {
            leaseId,
            slotId: slot.index,
            left: slot.left,
            top: slot.top,
            width: slot.width,
            height: slot.height,
            viewport,
            launchArgs,
            release,
        };
    }
    releaseSlot(slotIndex, leaseId) {
        this.occupied.delete(slotIndex);
        this.reservations.delete(slotIndex);
        logger.info({
            leaseId,
            slotIndex,
            waiting: this.waiters.length,
            occupied: this.occupied.size,
        }, 'Slot visual liberado (navegador fechado) — reutilização imediata');
        // Entrega o mesmo índice ao próximo waiter, ou fica livre para findFreeSlotIndex
        this.takeNextWaiter(slotIndex);
    }
    createFallbackSlot(leaseId) {
        const width = exports.DEFAULT_BROWSER_WINDOW.width;
        const height = exports.DEFAULT_BROWSER_WINDOW.height;
        return {
            leaseId,
            slotId: -1,
            left: 0,
            top: 0,
            width,
            height,
            viewport: viewportForWindowSize({ width, height }),
            launchArgs: [`--window-size=${width},${height}`, '--window-position=0,0'],
            release: () => undefined,
        };
    }
    _resetForTests() {
        for (const w of this.waiters) {
            w.reject(new Error('CaptchaWindowManager reset'));
        }
        this.waiters = [];
        this.occupied.clear();
        this.reservations.clear();
        this.layout = null;
        this.claimChain = Promise.resolve();
    }
}
exports.CaptchaWindowManager = CaptchaWindowManager;
/** Singleton do gerenciador de slots visuais. */
exports.captchaWindowManager = new CaptchaWindowManager();
//# sourceMappingURL=captcha-window-manager.js.map