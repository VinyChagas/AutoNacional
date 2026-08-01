/**
 * Sessão MANUAL remota: screenshot do Playwright → Central → cliques → mouse no browser.
 * O desafio é resolvido no mesmo contexto do portal (não renderiza widget novo).
 */

import type { Page } from 'playwright';
import { getLogger } from '../infrastructure/logger';
import {
  beginRemoteCaptcha,
  publishCaptchaFrame,
  completeRemoteCaptcha,
  type RemoteCaptchaHandlers,
  type CaptchaFramePayload,
} from '../services/manual-captcha.service';
import type { CaptchaRequest, ManualCaptchaResult } from './captcha/types';
import { CAPTCHA_SUBMIT_SELECTOR } from './hcaptcha-page';

const logger = getLogger('manual-captcha-remote');

const POST_CLICK_DELAY_MS = 400;
const POST_CONFIRM_DELAY_MS = 900;
const MODAL_POLL_MS = 800;

async function modalCaptchaVisivel(page: Page): Promise<boolean> {
  return page
    .locator(CAPTCHA_SUBMIT_SELECTOR)
    .isVisible()
    .catch(() => false);
}

/**
 * Captura o viewport (CSS pixels) para mapear cliques 1:1.
 */
export async function captureViewportFrame(
  page: Page,
  meta: {
    captchaId: string;
    attemptId: string;
    batchId: string;
    seq: number;
  }
): Promise<CaptchaFramePayload> {
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
  const buffer = await page.screenshot({
    type: 'jpeg',
    quality: 72,
    fullPage: false,
    // 1 CSS px = 1 px na imagem → cliques normalizados batem no viewport
    scale: 'css',
  });

  return {
    captchaId: meta.captchaId,
    attemptId: meta.attemptId,
    batchId: meta.batchId,
    seq: meta.seq,
    mime: 'image/jpeg',
    base64: buffer.toString('base64'),
    width: viewport.width,
    height: viewport.height,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    capturedAt: new Date().toISOString(),
  };
}

async function clicarPorNorm(
  page: Page,
  xNorm: number,
  yNorm: number
): Promise<{ x: number; y: number }> {
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
  const x = Math.max(0, Math.min(viewport.width - 1, xNorm * viewport.width));
  const y = Math.max(0, Math.min(viewport.height - 1, yNorm * viewport.height));
  await page.mouse.click(x, y);
  return { x, y };
}

/**
 * Publica frames e processa cliques/confirm até o modal fechar, skip ou timeout.
 */
export async function resolverCaptchaPorCliquesRemotos(
  page: Page,
  request: CaptchaRequest
): Promise<ManualCaptchaResult> {
  let seq = 0;

  const publish = async (captchaId: string, attemptId: string): Promise<void> => {
    seq += 1;
    try {
      const frame = await captureViewportFrame(page, {
        captchaId,
        attemptId,
        batchId: request.batchId,
        seq,
      });
      publishCaptchaFrame(captchaId, frame);
    } catch (err) {
      logger.warn(
        { err, captchaId, attemptId, seq },
        'Falha ao capturar/publicar frame do captcha'
      );
      throw err;
    }
  };

  // captchaId é conhecido só após beginRemoteCaptcha — handlers fecham sobre refs mutáveis
  let captchaIdRef = '';
  let attemptIdRef = '';

  const handlers: RemoteCaptchaHandlers = {
    onClick: async ({ xNorm, yNorm }) => {
      const { x, y } = await clicarPorNorm(page, xNorm, yNorm);
      logger.info(
        {
          evento: 'remote_captcha_click',
          batchId: request.batchId,
          executionId: request.executionId,
          captchaId: captchaIdRef,
          xNorm,
          yNorm,
          x,
          y,
        },
        'Clique remoto aplicado no Playwright'
      );
      await page.waitForTimeout(POST_CLICK_DELAY_MS);
      const closed = !(await modalCaptchaVisivel(page));
      return { ok: true, modalClosed: closed };
    },
    onRefresh: async () => {
      await publish(captchaIdRef, attemptIdRef);
      return { ok: true };
    },
    onConfirm: async () => {
      const botao = page.locator(CAPTCHA_SUBMIT_SELECTOR);
      if (!(await botao.isVisible().catch(() => false))) {
        return { ok: true, modalClosed: true };
      }
      await botao.click({ timeout: 10000 });
      await page.waitForTimeout(POST_CONFIRM_DELAY_MS);
      const closed = !(await modalCaptchaVisivel(page));
      logger.info(
        {
          evento: 'remote_captcha_confirm',
          batchId: request.batchId,
          executionId: request.executionId,
          captchaId: captchaIdRef,
          modalClosed: closed,
        },
        'Confirmar remoto no portal'
      );
      return { ok: true, modalClosed: closed };
    },
  };

  const { captchaId, attemptId, promise } = beginRemoteCaptcha(request, handlers);
  captchaIdRef = captchaId;
  attemptIdRef = attemptId;

  // Primeiro frame
  await publish(captchaId, attemptId);

  // Se o modal sumir sozinho (desafio + confirmação via cliques), completa
  const poll = setInterval(() => {
    void (async () => {
      try {
        if (!(await modalCaptchaVisivel(page))) {
          completeRemoteCaptcha(captchaId, 'remote_click');
        }
      } catch {
        /* página fechada */
      }
    })();
  }, MODAL_POLL_MS);

  try {
    return await promise;
  } finally {
    clearInterval(poll);
  }
}
