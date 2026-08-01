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

import { getLogger } from '../infrastructure/logger';
import * as settingsRepo from '../repositories/settings';
import {
  resolveMonitorResolutionFromSettings,
  type AutomationBrowserWindowSize,
  type MonitorResolution,
} from './viewport-resolution';

const logger = getLogger('captcha-window-manager');

/** Margem nas bordas do monitor (px). */
export const CAPTCHA_LAYOUT_MARGIN_PX = 12;
/** Espaçamento entre janelas (px). */
export const CAPTCHA_LAYOUT_GAP_PX = 10;
/** Reserva para barra de tarefas / bordas do SO (px). */
export const CAPTCHA_LAYOUT_TASKBAR_PX = 48;
/**
 * Largura fixa da janela Chromium / viewport Playwright (px) desde o launch.
 * O portal NFSe só exibe o botão "Certificado Digital" a partir de ~769px
 * (breakpoint responsivo). Abaixo disso o layout mobile esconde o botão.
 */
export const BROWSER_WINDOW_WIDTH = 769;
/** Alias usado no cálculo de layout (largura fixa da janela). */
export const CAPTCHA_MIN_SLOT_WIDTH = BROWSER_WINDOW_WIDTH;
/** Altura mínima útil da janela (px). */
export const CAPTCHA_MIN_SLOT_HEIGHT = 680;
/**
 * No Chromium, `--window-size` define a área de conteúdo (≈ viewport Playwright).
 * Não subtrair “chrome” alto aqui — isso gerava viewport ~591px e o portal
 * NFSe não renderizava o botão de certificado (falha em ~500ms).
 */

/** Fallback quando layout está desabilitado / headless (não usar resolução do monitor). */
export const DEFAULT_BROWSER_WINDOW: AutomationBrowserWindowSize = {
  width: BROWSER_WINDOW_WIDTH,
  height: 720,
};

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

interface OccupiedSlot {
  leaseId: string;
  slot: CaptchaSlotBounds;
}

interface Waiter {
  leaseId: string;
  resolve: (slotIndex: number) => void;
  reject: (err: Error) => void;
}

/**
 * Máximo de células que cabem em `available` com tamanho mínimo e gap.
 * n * minSize + (n - 1) * gap <= available
 */
function maxCellsFitting(
  available: number,
  minSize: number,
  gap: number
): number {
  if (available < minSize) return 1;
  return Math.max(1, Math.floor((available + gap) / (minSize + gap)));
}

/**
 * Calcula grade dinâmica de slots a partir da resolução do MONITOR.
 *
 * A última linha pode ser parcial (ex.: 5 colunas × 2 linhas com 8 slots).
 * Nunca reduz linhas para forçar retângulo cols×rows === maxSlots.
 */
export function calcularLayoutCaptcha(
  params: CalcularLayoutParams
): CaptchaSlotLayout {
  const margin = params.marginPx ?? CAPTCHA_LAYOUT_MARGIN_PX;
  const gap = params.gapPx ?? CAPTCHA_LAYOUT_GAP_PX;
  const taskbar = params.taskbarReservePx ?? CAPTCHA_LAYOUT_TASKBAR_PX;
  const minW = params.minSlotWidth ?? CAPTCHA_MIN_SLOT_WIDTH;
  const minH = params.minSlotHeight ?? CAPTCHA_MIN_SLOT_HEIGHT;
  // Permite encolher ~6% na altura para caber mais uma linha (ex.: 1440 → 2 linhas)
  const minHFlexible = Math.max(640, Math.floor(minH * 0.94));
  const maxSimultaneous = Math.max(1, Math.floor(params.maxSimultaneous || 1));

  const monitorWidth = Math.max(640, Math.floor(params.monitorWidth));
  const monitorHeight = Math.max(480, Math.floor(params.monitorHeight));

  const availableWidth = Math.max(minW, monitorWidth - margin * 2);
  const availableHeight = Math.max(
    minHFlexible,
    monitorHeight - taskbar - margin * 2
  );

  let cols = maxCellsFitting(availableWidth, minW, gap);
  while (cols > 1 && cols * minW + (cols - 1) * gap > availableWidth) {
    cols -= 1;
  }

  let rows = maxCellsFitting(availableHeight, minHFlexible, gap);
  while (rows > 1) {
    const h = Math.floor((availableHeight - (rows - 1) * gap) / rows);
    if (h >= minHFlexible) break;
    rows -= 1;
  }

  const gridCapacity = cols * rows;
  // Quantidade real de janelas (última linha pode ser parcial)
  const maxSlots = Math.min(gridCapacity, maxSimultaneous);
  // Linhas geométricas necessárias para posicionar maxSlots (sem colapsar a 2ª linha)
  const usedRows = Math.min(rows, Math.max(1, Math.ceil(maxSlots / cols)));

  // Largura fixa da janela (769px) — não esticar para preencher o monitor
  const slotWidth = minW;
  const slotHeight = Math.min(
    minH,
    Math.floor((availableHeight - (usedRows - 1) * gap) / usedRows)
  );

  const slots: CaptchaSlotBounds[] = [];
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
export function slotsSemSobreposicao(slots: CaptchaSlotBounds[]): boolean {
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const a = slots[i];
      const b = slots[j];
      const overlapX = a.left < b.left + b.width && a.left + a.width > b.left;
      const overlapY = a.top < b.top + b.height && a.top + a.height > b.top;
      if (overlapX && overlapY) return false;
    }
  }
  return true;
}

/**
 * Viewport Playwright = área de conteúdo do Chromium (= `--window-size`).
 * Usa o tamanho do slot integralmente para o portal desktop renderizar.
 */
export function viewportForWindowSize(
  window: AutomationBrowserWindowSize
): AutomationBrowserWindowSize {
  return {
    // Sempre 769px de largura para o portal desktop (Certificado Digital)
    width: BROWSER_WINDOW_WIDTH,
    height: Math.max(600, Math.floor(window.height)),
  };
}

export function buildLaunchArgsForSlot(slot: CaptchaSlotBounds): string[] {
  const vp = viewportForWindowSize(slot);
  return [
    `--window-position=${Math.round(slot.left)},${Math.round(slot.top)}`,
    `--window-size=${vp.width},${vp.height}`,
  ];
}

/**
 * Capacidade visual atual (maxSlots) a partir das settings — para alinhar a PQueue.
 */
export async function getVisualSlotCapacityFromSettings(): Promise<number> {
  const config = await settingsRepo.obterConfiguracoes();
  const monitor = resolveMonitorResolutionFromSettings(config);
  const maxSimultaneous = Math.max(
    1,
    config?.maxConcurrentBrowsers ?? config?.defaultConcurrentBrowsers ?? 3
  );
  const layout = calcularLayoutCaptcha({
    monitorWidth: monitor.width,
    monitorHeight: monitor.height,
    maxSimultaneous,
  });
  return layout.maxSlots;
}

export class CaptchaWindowManager {
  private occupied = new Map<number, OccupiedSlot>();
  private reservations = new Set<number>();
  private waiters: Waiter[] = [];
  private layout: CaptchaSlotLayout | null = null;
  private claimChain: Promise<void> = Promise.resolve();

  getCurrentLayout(): CaptchaSlotLayout | null {
    return this.layout;
  }

  getOccupiedCount(): number {
    return this.occupied.size;
  }

  async refreshLayoutFromSettings(): Promise<CaptchaSlotLayout> {
    const config = await settingsRepo.obterConfiguracoes();
    const monitor: MonitorResolution =
      resolveMonitorResolutionFromSettings(config);
    const maxSimultaneous = Math.max(
      1,
      config?.maxConcurrentBrowsers ??
        config?.defaultConcurrentBrowsers ??
        3
    );

    const next = calcularLayoutCaptcha({
      monitorWidth: monitor.width,
      monitorHeight: monitor.height,
      maxSimultaneous,
    });

    // Não encolhe a grade enquanto houver slots ocupados/reservados além do novo max
    const highestHeld = Math.max(
      -1,
      ...this.occupied.keys(),
      ...this.reservations.values()
    );
    if (
      this.layout &&
      highestHeld >= 0 &&
      next.maxSlots <= highestHeld
    ) {
      return this.layout;
    }

    this.layout = next;

    logger.info(
      {
        monitorWidth: this.layout.monitorWidth,
        monitorHeight: this.layout.monitorHeight,
        cols: this.layout.cols,
        rows: this.layout.rows,
        maxSlots: this.layout.maxSlots,
        slotWidth: this.layout.slotWidth,
        slotHeight: this.layout.slotHeight,
        preset: config?.viewportPreset,
        maxSimultaneous,
      },
      'Layout de slots de navegador calculado (resolução do monitor)'
    );

    return this.layout;
  }

  private findFreeSlotIndex(): number | null {
    if (!this.layout) return null;
    for (const slot of this.layout.slots) {
      if (
        !this.occupied.has(slot.index) &&
        !this.reservations.has(slot.index)
      ) {
        return slot.index;
      }
    }
    return null;
  }

  private takeNextWaiter(slotIndex: number): void {
    const next = this.waiters.shift();
    if (!next) return;
    this.reservations.add(slotIndex);
    next.resolve(slotIndex);
  }

  /**
   * Reserva um índice livre. Se a grade estiver cheia, registra o waiter
   * DENTRO do mesmo lock do claim — evita race em que o release ocorre
   * entre o "não há slot" e o registro na fila de espera.
   */
  private claimSlotIndex(leaseId: string): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const tryClaim = async (): Promise<void> => {
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
          logger.info(
            {
              leaseId,
              waiting: this.waiters.length,
              occupied: this.occupied.size,
            },
            'Aguardando slot visual livre antes de abrir o navegador'
          );
        } catch (e) {
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
  async reserveSlot(
    leaseId: string,
    options: ReserveSlotOptions = {}
  ): Promise<ReservedBrowserSlot> {
    const enabled = options.enabled !== false;

    if (!enabled) {
      return this.createFallbackSlot(leaseId);
    }

    let slotIndex: number;
    try {
      slotIndex = await this.claimSlotIndex(leaseId);
    } catch (e) {
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

    logger.info(
      {
        leaseId,
        slotId: slot.index,
        left: slot.left,
        top: slot.top,
        width: slot.width,
        height: slot.height,
        viewport,
      },
      'Slot visual reservado — Chromium deve abrir nesta posição/tamanho'
    );

    let released = false;
    const release = (): void => {
      if (released) return;
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

  private releaseSlot(slotIndex: number, leaseId: string): void {
    this.occupied.delete(slotIndex);
    this.reservations.delete(slotIndex);
    logger.info(
      {
        leaseId,
        slotIndex,
        waiting: this.waiters.length,
        occupied: this.occupied.size,
      },
      'Slot visual liberado (navegador fechado) — reutilização imediata'
    );
    // Entrega o mesmo índice ao próximo waiter, ou fica livre para findFreeSlotIndex
    this.takeNextWaiter(slotIndex);
  }

  private createFallbackSlot(leaseId: string): ReservedBrowserSlot {
    const width = DEFAULT_BROWSER_WINDOW.width;
    const height = DEFAULT_BROWSER_WINDOW.height;
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

  _resetForTests(): void {
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

/** Singleton do gerenciador de slots visuais. */
export const captchaWindowManager = new CaptchaWindowManager();
