import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  calcularLayoutCaptcha,
  captchaWindowManager,
  buildLaunchArgsForSlot,
  viewportForWindowSize,
  slotsSemSobreposicao,
  BROWSER_WINDOW_WIDTH,
  CAPTCHA_MIN_SLOT_WIDTH,
  CAPTCHA_MIN_SLOT_HEIGHT,
} from './captcha-window-manager';
import {
  resolveMonitorResolutionFromSettings,
  resolveViewportFromSettings,
} from './viewport-resolution';

vi.mock('../repositories/settings', () => ({
  obterConfiguracoes: vi.fn(async () => ({
    viewportPreset: 'CUSTOM',
    viewportWidth: 3440,
    viewportHeight: 1440,
    maxConcurrentBrowsers: 8,
    defaultConcurrentBrowsers: 8,
  })),
}));

describe('calcularLayoutCaptcha', () => {
  it('usa largura fixa de 769px na janela do navegador', () => {
    expect(BROWSER_WINDOW_WIDTH).toBe(769);
    expect(CAPTCHA_MIN_SLOT_WIDTH).toBe(769);
  });

  it('calcula slots em 1366×768 com janela 769px', () => {
    const layout = calcularLayoutCaptcha({
      monitorWidth: 1366,
      monitorHeight: 768,
      maxSimultaneous: 5,
    });
    expect(layout.cols).toBe(1);
    expect(layout.slotWidth).toBe(769);
    expect(layout.slots).toHaveLength(layout.maxSlots);
    expect(layout.slots.every((s) => s.width === 769)).toBe(true);
  });

  it('calcula ~2 slots lado a lado em Full HD com largura 769', () => {
    const layout = calcularLayoutCaptcha({
      monitorWidth: 1920,
      monitorHeight: 1080,
      maxSimultaneous: 5,
    });
    expect(layout.cols).toBe(2);
    expect(layout.rows).toBe(1);
    expect(layout.maxSlots).toBe(2);
    expect(layout.slotWidth).toBe(769);
    expect(layout.slotHeight).toBe(CAPTCHA_MIN_SLOT_HEIGHT);

    const [a, b] = layout.slots;
    expect(a.width).toBe(769);
    expect(b.width).toBe(769);
    expect(a.left + a.width).toBeLessThanOrEqual(b.left);
  });

  it('permite mais de uma linha em QHD quando o máximo permite', () => {
    const layout = calcularLayoutCaptcha({
      monitorWidth: 2560,
      monitorHeight: 1440,
      maxSimultaneous: 8,
    });
    expect(layout.cols).toBeGreaterThanOrEqual(3);
    expect(layout.rows).toBeGreaterThanOrEqual(2);
    expect(layout.slotWidth).toBe(769);
    expect(layout.maxSlots).toBeGreaterThanOrEqual(6);
    expect(slotsSemSobreposicao(layout.slots)).toBe(true);
  });

  it('em ultrawide 3440×1440 com max 8: 4 colunas × 2 linhas a 769px', () => {
    const layout = calcularLayoutCaptcha({
      monitorWidth: 3440,
      monitorHeight: 1440,
      maxSimultaneous: 8,
    });
    expect(layout.cols).toBe(4);
    expect(layout.rows).toBe(2);
    expect(layout.maxSlots).toBe(8);
    expect(layout.slotWidth).toBe(769);
    expect(layout.slots).toHaveLength(8);
    expect(layout.slots.every((s) => s.width === 769)).toBe(true);
    expect(slotsSemSobreposicao(layout.slots)).toBe(true);

    const firstRowBottom = layout.slots[0].top + layout.slots[0].height;
    const secondRowTop = layout.slots[4].top;
    expect(secondRowTop).toBeGreaterThanOrEqual(firstRowBottom);
  });

  it('respeita maxSimultaneous como teto', () => {
    const layout = calcularLayoutCaptcha({
      monitorWidth: 3840,
      monitorHeight: 2160,
      maxSimultaneous: 2,
    });
    expect(layout.maxSlots).toBe(2);
    expect(layout.slots).toHaveLength(2);
    expect(layout.slotWidth).toBe(769);
  });

  it('usa resolução CUSTOM informada como área do monitor', () => {
    const layout = calcularLayoutCaptcha({
      monitorWidth: 1600,
      monitorHeight: 900,
      maxSimultaneous: 4,
    });
    expect(layout.monitorWidth).toBe(1600);
    expect(layout.monitorHeight).toBe(900);
    expect(layout.slotWidth).toBe(769);
    expect(layout.maxSlots).toBeGreaterThanOrEqual(1);
  });

  it('slots não ultrapassam a área útil do monitor', () => {
    const layout = calcularLayoutCaptcha({
      monitorWidth: 1920,
      monitorHeight: 1080,
      maxSimultaneous: 3,
    });
    for (const slot of layout.slots) {
      expect(slot.left + slot.width).toBeLessThanOrEqual(1920);
      expect(slot.top + slot.height).toBeLessThanOrEqual(1080);
      expect(slot.width).toBe(769);
    }
  });
});

describe('buildLaunchArgsForSlot / viewportForWindowSize', () => {
  it('gera args de posição e tamanho 769 para o Chromium', () => {
    const args = buildLaunchArgsForSlot({
      index: 0,
      left: 12,
      top: 12,
      width: 769,
      height: 680,
    });
    expect(args).toContain('--window-position=12,12');
    expect(args).toContain('--window-size=769,680');
  });

  it('viewport Playwright sempre usa 769 de largura', () => {
    const vp = viewportForWindowSize({ width: 800, height: 679 });
    expect(vp.width).toBe(769);
    expect(vp.height).toBe(679);
  });

  it('força 769 mesmo se o slot vier com outra largura', () => {
    const vp = viewportForWindowSize({ width: 900, height: 680 });
    expect(vp.width).toBe(769);
  });
});

describe('resolveMonitorResolutionFromSettings', () => {
  it('resolve presets conhecidos como resolução do MONITOR', () => {
    expect(
      resolveMonitorResolutionFromSettings({ viewportPreset: 'FULLHD' })
    ).toEqual({ width: 1920, height: 1080 });
    expect(
      resolveViewportFromSettings({ viewportPreset: 'DESKTOP_1366x768' })
    ).toEqual({ width: 1366, height: 768 });
  });

  it('resolve CUSTOM com largura/altura', () => {
    expect(
      resolveMonitorResolutionFromSettings({
        viewportPreset: 'CUSTOM',
        viewportWidth: 1680,
        viewportHeight: 1050,
      })
    ).toEqual({ width: 1680, height: 1050 });
  });
});

describe('CaptchaWindowManager.reserveSlot', () => {
  beforeEach(() => {
    captchaWindowManager._resetForTests();
  });

  it('retorna fallback com window-size 769 quando layout desabilitado', async () => {
    const lease = await captchaWindowManager.reserveSlot('t1', {
      enabled: false,
    });
    expect(lease.slotId).toBe(-1);
    expect(lease.launchArgs).toContain('--window-size=769,720');
    expect(lease.viewport.width).toBe(769);
    lease.release();
  });

  it('abre Chromium com 769px no slot (não só no captcha)', async () => {
    const first = await captchaWindowManager.reserveSlot('reuse-1');
    expect(first.slotId).toBe(0);
    expect(first.width).toBe(769);
    expect(first.viewport.width).toBe(769);
    expect(
      first.launchArgs.some((a) => a.startsWith('--window-size=769,'))
    ).toBe(true);
    expect(captchaWindowManager.getOccupiedCount()).toBe(1);

    first.release();
    expect(captchaWindowManager.getOccupiedCount()).toBe(0);

    const second = await captchaWindowManager.reserveSlot('reuse-2');
    expect(second.slotId).toBe(0);
    expect(second.width).toBe(769);
    expect(captchaWindowManager.getCurrentLayout()?.maxSlots).toBe(8);
    expect(captchaWindowManager.getCurrentLayout()?.cols).toBe(4);
    expect(captchaWindowManager.getCurrentLayout()?.rows).toBe(2);
    second.release();
  });

  it('entrega slot liberado ao waiter sem sobrepor', async () => {
    const leases = [];
    for (let i = 0; i < 8; i++) {
      leases.push(await captchaWindowManager.reserveSlot(`full-${i}`));
    }
    expect(captchaWindowManager.getOccupiedCount()).toBe(8);

    const waiting = captchaWindowManager.reserveSlot('waiter-9');
    await vi.waitFor(
      () => {
        expect(captchaWindowManager.getOccupiedCount()).toBe(8);
      },
      { timeout: 500, interval: 5 }
    );
    await new Promise((r) => setTimeout(r, 20));

    leases[3].release();
    const got = await waiting;
    expect(got.slotId).toBe(3);
    expect(got.width).toBe(769);
    expect(got.viewport.width).toBe(769);
    expect(captchaWindowManager.getOccupiedCount()).toBe(8);

    got.release();
    for (const l of leases) {
      if (l.slotId !== 3) l.release();
    }
  });
});
