import { describe, it, expect, vi } from 'vitest';
import {
  obterCandidatosBotaoConfirmar,
  MODAL_ANIMATION_DELAY_MS,
  KEYBOARD_STEP_DELAY_MS,
  TOKEN_POLL_INTERVAL_MS,
  tratarHCaptchaManual,
} from './hcaptcha-manual-handler';
import { CAPTCHA_SUBMIT_SELECTOR } from './hcaptcha-page';

function createMockPage(opts?: {
  modalVisible?: boolean;
  tokenFilled?: boolean;
  confirmClickFails?: boolean;
}) {
  const modalVisible = opts?.modalVisible ?? true;
  const tokenFilled = opts?.tokenFilled ?? false;
  let clicks = 0;

  const submitLocator = {
    waitFor: vi.fn(async ({ state }: { state: string }) => {
      if (state === 'visible' && !modalVisible) {
        throw new Error('timeout');
      }
      if (state === 'hidden' && modalVisible && clicks === 0) {
        throw new Error('timeout');
      }
    }),
    isVisible: vi.fn(async () => modalVisible && clicks === 0),
    isEnabled: vi.fn(async () => true),
    count: vi.fn(async () => 1),
    last: vi.fn(function (this: typeof submitLocator) {
      return this;
    }),
    scrollIntoViewIfNeeded: vi.fn(async () => undefined),
    click: vi.fn(async () => {
      if (opts?.confirmClickFails) throw new Error('click failed');
      clicks += 1;
    }),
  };

  return {
    page: {
      locator: vi.fn((sel: string) => {
        if (
          sel === CAPTCHA_SUBMIT_SELECTOR ||
          sel.includes('btnSubmitHCaptcha') ||
          sel.includes('button[1]')
        ) {
          return submitLocator;
        }
        return {
          waitFor: vi.fn(),
          isVisible: vi.fn(async () => false),
          count: vi.fn(async () => 0),
          last: vi.fn(function (this: { isVisible: () => Promise<boolean> }) {
            return this;
          }),
        };
      }),
      frames: vi.fn(() => [
        {
          evaluate: vi.fn(async () => tokenFilled),
        },
      ]),
      keyboard: {
        press: vi.fn(async () => undefined),
      },
      waitForTimeout: vi.fn(async () => undefined),
    } as unknown as import('playwright').Page,
    submitLocator,
    getClicks: () => clicks,
  };
}

describe('hcaptcha-manual-handler', () => {
  it('prioriza seletor por ID do Confirmar', () => {
    const { page } = createMockPage();
    const candidates = obterCandidatosBotaoConfirmar(page);
    expect(candidates[0].name).toBe('#btnSubmitHCaptcha');
    expect(candidates[1].name).toContain('btnSubmitHCaptcha');
    expect(candidates[2].name).toBe('xpath-absoluto');
  });

  it('usa delay de animação de 2,5s, intervalo de 0,5s entre teclas e poll de 1s', () => {
    expect(MODAL_ANIMATION_DELAY_MS).toBe(2500);
    expect(KEYBOARD_STEP_DELAY_MS).toBe(500);
    expect(TOKEN_POLL_INTERVAL_MS).toBe(1000);
  });

  it('abre desafio com Tab/Tab/Enter e confirma após token', async () => {
    const { page, submitLocator } = createMockPage({
      modalVisible: true,
      tokenFilled: true,
    });

    // Após o click, isVisible passa a false via clicks
    submitLocator.isVisible = vi.fn(async () => {
      return submitLocator.click.mock.calls.length === 0;
    });
    submitLocator.waitFor = vi.fn(async ({ state }: { state: string }) => {
      if (state === 'hidden' && submitLocator.click.mock.calls.length > 0) {
        return;
      }
      if (state === 'visible') return;
      throw new Error('timeout');
    });

    const result = await tratarHCaptchaManual(
      page,
      { executionId: 'e1', tipoArquivo: 'xml' },
      {
        timeoutMs: 5000,
        modalJaVisivel: true,
        modalAnimationDelayMs: 0,
        keyboardStepDelayMs: 0,
        pollIntervalMs: 1,
      }
    );

    expect(result.status).toBe('RESOLVED');
    expect(result.tokenDetected).toBe(true);
    expect(page.keyboard.press).toHaveBeenCalledWith('Tab');
    expect(page.keyboard.press).toHaveBeenCalledWith('Enter');
    expect(
      (page.keyboard.press as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c) => c[0] === 'Tab'
      )
    ).toHaveLength(2);
    expect(submitLocator.click).toHaveBeenCalled();
  });

  it('retorna TIMEOUT se o usuário não resolver', async () => {
    const { page } = createMockPage({
      modalVisible: true,
      tokenFilled: false,
    });

    const result = await tratarHCaptchaManual(
      page,
      { executionId: 'e2' },
      {
        timeoutMs: 20,
        modalJaVisivel: true,
        modalAnimationDelayMs: 0,
        keyboardStepDelayMs: 0,
        pollIntervalMs: 5,
      }
    );

    expect(result.status).toBe('TIMEOUT');
    expect(result.tokenDetected).toBe(false);
  });

  it('retorna MODAL_NOT_FOUND quando o modal não aparece', async () => {
    const { page } = createMockPage({ modalVisible: false });

    const result = await tratarHCaptchaManual(
      page,
      {},
      {
        timeoutMs: 1000,
        modalJaVisivel: false,
        detectTimeoutMs: 10,
      }
    );

    expect(result.status).toBe('MODAL_NOT_FOUND');
  });
});
