/**
 * Utilitários de detecção/injeção de hCaptcha na página Playwright.
 * Compartilhados entre provedores 2Captcha e Central Manual.
 */

import { Page, Request, Response } from 'playwright';
import { TWOCAPTCHA_RQDATA } from '../infrastructure/config';
import { getLogger } from '../infrastructure/logger';
import type { PortalCaptchaResult } from './captcha-diagnostic';
import { isCaptchaDebug } from './captcha-diagnostic';

const logger = getLogger('hcaptcha-page');

export const CAPTCHA_SUBMIT_SELECTOR = '#btnSubmitHCaptcha';

export interface DadosCaptcha {
  sitekey: string;
  /** Sempre a URL da página principal do portal (nunca URL do iframe hCaptcha). */
  pageurl: string;
  /** Opcional: só presente quando houver valor real. */
  rqdata?: string;
  action?: string;
  callbackName?: string;
}

function normalizeRqdata(value?: string | null): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function sitekeyDoSrc(src: string | null | undefined): string | null {
  if (!src) return null;
  const m = /sitekey=([\w-]+)/i.exec(src);
  return m ? m[1] : null;
}

async function tentarExtrairRqdataOpcional(page: Page): Promise<string | undefined> {
  const script = `(() => {
    var el = document.querySelector('[data-rqdata]');
    if (el) {
      var v = el.getAttribute('data-rqdata');
      if (v && String(v).trim()) return String(v).trim();
    }
    var iframes = document.querySelectorAll('iframe[src*="hcaptcha"]');
    for (var i = 0; i < iframes.length; i++) {
      var src = iframes[i].getAttribute('src') || '';
      var m = src.match(/[?&#]rqdata=([^&]+)/i);
      if (m) {
        try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
      }
    }
    return null;
  })()`;

  for (const frame of page.frames()) {
    try {
      const v = await frame.evaluate(script);
      const n = normalizeRqdata(typeof v === 'string' ? v : null);
      if (n) return n;
    } catch {
      /* frame destacado */
    }
  }
  return undefined;
}

async function tentarExtrairAtributosWidget(page: Page): Promise<{
  sitekey?: string;
  action?: string;
  callbackName?: string;
  rqdata?: string;
}> {
  const script = `(() => {
    var el = document.querySelector('[data-sitekey]');
    if (!el) return null;
    return {
      sitekey: (el.getAttribute('data-sitekey') || '').trim() || undefined,
      action: (el.getAttribute('data-action') || '').trim() || undefined,
      callbackName: (el.getAttribute('data-callback') || '').trim() || undefined,
      rqdata: (el.getAttribute('data-rqdata') || '').trim() || undefined
    };
  })()`;

  for (const frame of page.frames()) {
    try {
      const v = (await frame.evaluate(script)) as {
        sitekey?: string;
        action?: string;
        callbackName?: string;
        rqdata?: string;
      } | null;
      if (v?.sitekey) return v;
    } catch {
      /* ignore */
    }
  }
  return {};
}

/** Extrai sitekey / pageurl / rqdata / action do modal hCaptcha aberto. */
export async function capturarDadosCaptcha(page: Page): Promise<DadosCaptcha | null> {
  // pageurl SEMPRE da página principal do portal — nunca do iframe hCaptcha
  const pageurl = page.url();
  let sitekey: string | null = null;

  const attrs = await tentarExtrairAtributosWidget(page);
  if (attrs.sitekey) sitekey = attrs.sitekey;

  if (!sitekey) {
    for (const frame of page.frames()) {
      try {
        const iframe = frame.locator('iframe[src*="hcaptcha.com"]').first();
        if ((await iframe.count()) > 0) {
          const sk = sitekeyDoSrc(await iframe.getAttribute('src'));
          if (sk) {
            sitekey = sk;
            break;
          }
        }
      } catch {
        /* ignore */
      }
    }
  }

  if (!sitekey) return null;

  const rqdata =
    normalizeRqdata(TWOCAPTCHA_RQDATA) ||
    normalizeRqdata(attrs.rqdata) ||
    (await tentarExtrairRqdataOpcional(page));

  if (rqdata) {
    logger.info(
      { rqdataLen: rqdata.length },
      'rqdata encontrado — será enviado em enterprisePayload'
    );
  } else {
    logger.info(
      'rqdata não encontrado — task 2captcha será criada sem enterprisePayload'
    );
  }

  return {
    sitekey,
    pageurl,
    ...(rqdata ? { rqdata } : {}),
    ...(attrs.action ? { action: attrs.action } : {}),
    ...(attrs.callbackName ? { callbackName: attrs.callbackName } : {}),
  };
}

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
export async function injetarTokenHCaptcha(
  page: Page,
  token: string,
  options?: { callbackName?: string }
): Promise<InjecaoTokenResultado> {
  const eventsDispatched = ['input', 'change', 'blur'];
  const fieldDetails: InjecaoTokenResultado['fieldDetails'] = [];
  let fieldsFound = 0;
  let fieldsFilled = 0;
  let callbackExecuted = false;
  let callbackName = options?.callbackName;

  // String passada ao Playwright (evita tipagem DOM no Backend e evita eval)
  const injectSource = `({ token, callbackName }) => {
    var nomes = ['h-captcha-response', 'g-recaptcha-response'];
    var filled = [];
    var found = 0;
    function fill(el) {
      found += 1;
      var beforeLen = (el.value || '').length;
      el.value = token;
      try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
      try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
      try { el.dispatchEvent(new Event('blur', { bubbles: true })); } catch (e) {}
      filled.push({
        name: el.getAttribute('name') || undefined,
        id: el.id || undefined,
        beforeLen: beforeLen,
        afterLen: (el.value || '').length
      });
    }
    for (var i = 0; i < nomes.length; i++) {
      var nome = nomes[i];
      var nodes = document.querySelectorAll(
        'textarea[name="' + nome + '"], input[name="' + nome + '"], textarea#' + nome + ', #' + nome
      );
      if (nodes.length === 0) {
        var campo = document.createElement('textarea');
        campo.name = nome;
        campo.id = nome;
        campo.style.display = 'none';
        (document.querySelector('form') || document.body).appendChild(campo);
        fill(campo);
      } else {
        for (var j = 0; j < nodes.length; j++) fill(nodes[j]);
      }
    }
    var extras = document.querySelectorAll(
      'textarea[name*="captcha-response"], textarea[id*="captcha-response"]'
    );
    for (var k = 0; k < extras.length; k++) {
      var el = extras[k];
      var already = filled.some(function (f) {
        return (f.name && f.name === el.getAttribute('name')) || (f.id && f.id === el.id);
      });
      if (!already) fill(el);
    }
    var cbName = callbackName || undefined;
    if (!cbName) {
      var siteEl = document.querySelector('[data-callback]');
      if (siteEl) cbName = siteEl.getAttribute('data-callback') || undefined;
    }
    var callbackExecutedLocal = false;
    if (cbName && typeof window[cbName] === 'function') {
      try { window[cbName](token); callbackExecutedLocal = true; } catch (e) {}
    }
    return {
      found: found,
      filled: filled.length,
      details: filled,
      callbackExecuted: callbackExecutedLocal,
      callbackName: cbName
    };
  }`;

  for (const frame of page.frames()) {
    try {
      const result = (await frame.evaluate(injectSource, {
        token,
        callbackName: callbackName || null,
      })) as {
        found: number;
        filled: number;
        details: Array<{
          name?: string;
          id?: string;
          beforeLen: number;
          afterLen: number;
        }>;
        callbackExecuted: boolean;
        callbackName?: string;
      };
      fieldsFound += result.found;
      fieldsFilled += result.filled;
      if (result.callbackExecuted) {
        callbackExecuted = true;
        callbackName = result.callbackName || callbackName;
      } else if (result.callbackName && !callbackName) {
        callbackName = result.callbackName;
      }
      for (const d of result.details) {
        fieldDetails.push({ ...d, frameUrl: frame.url().slice(0, 120) });
      }
    } catch {
      /* frame destacado */
    }
  }

  if (isCaptchaDebug()) {
    logger.info(
      {
        evento: 'token_injection_detail',
        fieldsFound,
        fieldsFilled,
        callbackExecuted,
        callbackName,
        eventsDispatched,
        fieldCount: fieldDetails.length,
      },
      'Detalhe da injeção de token hCaptcha'
    );
  }

  return {
    fieldsFound,
    fieldsFilled,
    eventsDispatched,
    callbackExecuted,
    callbackName,
    fieldDetails,
  };
}

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
export async function observarResultadoPortalAposSubmit(
  page: Page,
  submitAction: () => Promise<void>,
  observeMs = 8000
): Promise<PortalObservacao> {
  const relevantUrls: string[] = [];
  let requestSent = false;
  let responseStatus: number | undefined;
  let message: string | undefined;
  let rejectedHint = false;
  let newChallengeHint = false;

  const onRequest = (req: Request) => {
    const url = req.url();
    if (
      /hcaptcha|captcha|nfse|download|validar|confirm/i.test(url) &&
      !/\.(png|jpg|css|woff2?)(\?|$)/i.test(url)
    ) {
      requestSent = true;
      relevantUrls.push(url.split('?')[0].slice(0, 160));
    }
  };

  const onResponse = async (res: Response) => {
    const url = res.url();
    if (!/hcaptcha|captcha|nfse|download|validar|confirm/i.test(url)) return;
    responseStatus = res.status();
    try {
      const ct = res.headers()['content-type'] || '';
      if (ct.includes('json') || ct.includes('text')) {
        const body = (await res.text().catch(() => '')).slice(0, 500).toLowerCase();
        if (/invalid|erro|fail|reject|expir|incorret/.test(body)) {
          rejectedHint = true;
          message = body.slice(0, 200);
        }
        if (/new.?challenge|sitekey|hcaptcha/.test(body) && /error|fail/.test(body)) {
          newChallengeHint = true;
        }
      }
    } catch {
      /* ignore body read */
    }
  };

  page.on('request', onRequest);
  page.on('response', onResponse);

  try {
    await submitAction();
  } finally {
    await page.waitForTimeout(observeMs).catch(() => undefined);
    page.off('request', onRequest);
    page.off('response', onResponse);
  }

  const modalVisibleAfter = await page
    .locator(CAPTCHA_SUBMIT_SELECTOR)
    .isVisible()
    .catch(() => false);

  let result: PortalCaptchaResult = 'UNKNOWN';
  if (rejectedHint) result = 'REJECTED';
  else if (newChallengeHint) result = 'NEW_CHALLENGE_CREATED';
  else if (!modalVisibleAfter && requestSent) result = 'ACCEPTED';
  else if (!modalVisibleAfter && !requestSent) result = 'ACCEPTED'; // download pode ter sido local
  else if (modalVisibleAfter && !requestSent) result = 'NO_REQUEST_SENT';
  else if (modalVisibleAfter && requestSent) result = 'MODAL_REMAINED_OPEN';

  return {
    result,
    requestSent,
    responseStatus,
    message,
    modalVisibleAfter,
    relevantUrls: [...new Set(relevantUrls)].slice(0, 20),
  };
}

/**
 * Injeta o token, dispara callback/eventos e clica em Confirmar do modal NFSe.
 * Quando CAPTCHA_DEBUG, observa a resposta do portal.
 */
export async function aplicarTokenCaptchaNaPagina(
  page: Page,
  token: string,
  options?: { callbackName?: string; observePortal?: boolean }
): Promise<{
  injection: InjecaoTokenResultado;
  portal?: PortalObservacao;
}> {
  const injection = await injetarTokenHCaptcha(page, token, {
    callbackName: options?.callbackName,
  });

  const observe = options?.observePortal ?? isCaptchaDebug();
  if (!observe) {
    const botaoConfirmar = page.locator(CAPTCHA_SUBMIT_SELECTOR);
    await botaoConfirmar.click({ timeout: 15000 });
    return { injection };
  }

  const portal = await observarResultadoPortalAposSubmit(page, async () => {
    const botaoConfirmar = page.locator(CAPTCHA_SUBMIT_SELECTOR);
    await botaoConfirmar.click({ timeout: 15000 });
  });

  return { injection, portal };
}
