/**
 * Instrumentação e evidências da Central Manual de Captchas.
 * Ativa somente com CAPTCHA_DEBUG=true.
 */

import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { Page } from 'playwright';
import { CAPTCHA_DEBUG } from '../infrastructure/config';
import { getLogger } from '../infrastructure/logger';
import { resolveStoragePath } from '../utils/path-resolve';

const logger = getLogger('captcha-diag');

export type PortalCaptchaResult =
  | 'ACCEPTED'
  | 'REJECTED'
  | 'NO_REQUEST_SENT'
  | 'CALLBACK_NOT_EXECUTED'
  | 'MODAL_REMAINED_OPEN'
  | 'NEW_CHALLENGE_CREATED'
  | 'UNKNOWN';

export interface TokenFingerprint {
  tokenLength: number;
  tokenHash: string;
  tokenPreview: string;
}

export interface CaptchaOriginalPageSnapshot {
  batchId: string;
  executionId: string;
  captchaId?: string;
  attemptId: string;
  pageUrl: string;
  hostname: string;
  origin: string;
  userAgent: string;
  siteKey?: string;
  rqdata?: string;
  action?: string;
  callbackName?: string;
  iframeCount: number;
  iframeSrcSanitized: string[];
  responseFields: Array<{
    name?: string;
    id?: string;
    valueLength: number;
    frameUrl?: string;
  }>;
  modalVisible: boolean;
  capturedAt: string;
}

export interface CaptchaDiagnosticReport {
  identifiers: {
    batchId: string;
    executionId: string;
    empresaId: string;
    captchaId: string;
    attemptId: string;
  };
  originalPage: {
    pageUrl: string;
    hostname: string;
    siteKeyPresent: boolean;
    rqdataPresent: boolean;
    actionPresent: boolean;
    callbackDetected: boolean;
  };
  central: {
    payloadIntegrity: boolean;
    widgetRendered?: boolean;
    widgetId?: string;
    tokenGenerated?: boolean;
  };
  tokenFlow: {
    frontendHash?: string;
    socketHash?: string;
    serviceHash?: string;
    providerHash?: string;
    playwrightHash?: string;
    allHashesMatch: boolean;
  };
  injection: {
    responseFieldsFound: number;
    fieldsFilled: number;
    callbackExecuted: boolean;
    eventsDispatched: string[];
  };
  portal: {
    requestSent: boolean;
    responseStatus?: number;
    result: PortalCaptchaResult;
    message?: string;
  };
  classification: string;
  probableCause: string;
  evidence: string[];
  timings?: {
    detectedAt?: string;
    publishedAt?: string;
    tokenReceivedAt?: string;
    injectedAt?: string;
    submittedAt?: string;
  };
}

interface AttemptState {
  report: CaptchaDiagnosticReport;
  hashes: Partial<Record<'frontend' | 'socket' | 'service' | 'provider' | 'playwright', string>>;
  dir?: string;
}

const attempts = new Map<string, AttemptState>();

export function isCaptchaDebug(): boolean {
  return CAPTCHA_DEBUG;
}

export function newAttemptId(): string {
  return randomUUID();
}

export function fingerprintToken(token: string): TokenFingerprint {
  const tokenLength = token?.length ?? 0;
  const tokenHash = createHash('sha256')
    .update(token || '')
    .digest('hex')
    .slice(0, 16);
  let tokenPreview = '***';
  if (tokenLength > 12) {
    tokenPreview = `${token.slice(0, 6)}...${token.slice(-3)}`;
  }
  return { tokenLength, tokenHash, tokenPreview };
}

export function payloadFingerprint(parts: {
  captchaId: string;
  attemptId: string;
  siteKey: string;
  pageUrl: string;
  rqdata?: string;
  action?: string;
}): string {
  const raw = [
    parts.captchaId,
    parts.attemptId,
    parts.siteKey,
    parts.pageUrl,
    parts.rqdata ?? '',
    parts.action ?? '',
  ].join('|');
  return createHash('sha256').update(raw).digest('hex').slice(0, 24);
}

export function sanitizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch {
    return url.slice(0, 120);
  }
}

function debugLog(evento: string, data: Record<string, unknown>): void {
  if (!CAPTCHA_DEBUG) return;
  logger.info({ evento, ...data }, `[CAPTCHA_DEBUG] ${evento}`);
}

export function initAttemptReport(input: {
  batchId: string;
  executionId: string;
  empresaId: string;
  captchaId: string;
  attemptId: string;
  snapshot?: CaptchaOriginalPageSnapshot;
}): CaptchaDiagnosticReport {
  const report: CaptchaDiagnosticReport = {
    identifiers: {
      batchId: input.batchId,
      executionId: input.executionId,
      empresaId: input.empresaId,
      captchaId: input.captchaId,
      attemptId: input.attemptId,
    },
    originalPage: {
      pageUrl: input.snapshot?.pageUrl || '',
      hostname: input.snapshot?.hostname || '',
      siteKeyPresent: Boolean(input.snapshot?.siteKey),
      rqdataPresent: Boolean(input.snapshot?.rqdata),
      actionPresent: Boolean(input.snapshot?.action),
      callbackDetected: Boolean(input.snapshot?.callbackName),
    },
    central: {
      payloadIntegrity: true,
    },
    tokenFlow: {
      allHashesMatch: true,
    },
    injection: {
      responseFieldsFound: 0,
      fieldsFilled: 0,
      callbackExecuted: false,
      eventsDispatched: [],
    },
    portal: {
      requestSent: false,
      result: 'UNKNOWN',
    },
    classification: 'PENDING',
    probableCause: '',
    evidence: [],
    timings: {
      detectedAt: input.snapshot?.capturedAt,
    },
  };

  attempts.set(input.attemptId, { report, hashes: {} });
  debugLog('attempt_initialized', {
    batchId: input.batchId,
    executionId: input.executionId,
    empresaId: input.empresaId,
    captchaId: input.captchaId,
    attemptId: input.attemptId,
    siteKeyPresent: report.originalPage.siteKeyPresent,
    rqdataPresent: report.originalPage.rqdataPresent,
  });
  return report;
}

function getState(attemptId: string): AttemptState | undefined {
  return attempts.get(attemptId);
}

export function recordTokenHash(
  attemptId: string,
  layer: 'frontend' | 'socket' | 'service' | 'provider' | 'playwright',
  token: string
): TokenFingerprint {
  const fp = fingerprintToken(token);
  const st = getState(attemptId);
  if (st) {
    st.hashes[layer] = fp.tokenHash;
    if (layer === 'frontend') st.report.tokenFlow.frontendHash = fp.tokenHash;
    if (layer === 'socket') st.report.tokenFlow.socketHash = fp.tokenHash;
    if (layer === 'service') st.report.tokenFlow.serviceHash = fp.tokenHash;
    if (layer === 'provider') st.report.tokenFlow.providerHash = fp.tokenHash;
    if (layer === 'playwright') st.report.tokenFlow.playwrightHash = fp.tokenHash;

    const values = Object.values(st.hashes).filter(Boolean) as string[];
    st.report.tokenFlow.allHashesMatch =
      values.length <= 1 || values.every((h) => h === values[0]);
  }
  debugLog('token_hash', { attemptId, layer, ...fp });
  return fp;
}

export function appendEvidence(attemptId: string, evidence: string): void {
  const st = getState(attemptId);
  if (st) st.report.evidence.push(evidence);
  debugLog('evidence', { attemptId, evidence });
}

export function patchReport(
  attemptId: string,
  patch: Partial<CaptchaDiagnosticReport>
): void {
  const st = getState(attemptId);
  if (!st) return;
  Object.assign(st.report, patch);
  if (patch.originalPage) Object.assign(st.report.originalPage, patch.originalPage);
  if (patch.central) Object.assign(st.report.central, patch.central);
  if (patch.tokenFlow) Object.assign(st.report.tokenFlow, patch.tokenFlow);
  if (patch.injection) Object.assign(st.report.injection, patch.injection);
  if (patch.portal) Object.assign(st.report.portal, patch.portal);
  if (patch.timings) Object.assign(st.report.timings || {}, patch.timings);
}

export function finalizeAttemptReport(
  attemptId: string,
  classification: string,
  probableCause: string
): CaptchaDiagnosticReport | null {
  const st = getState(attemptId);
  if (!st) return null;
  st.report.classification = classification;
  st.report.probableCause = probableCause;
  debugLog('attempt_finalized', {
    attemptId,
    classification,
    probableCause,
    allHashesMatch: st.report.tokenFlow.allHashesMatch,
    portalResult: st.report.portal.result,
  });
  return st.report;
}

export function getAttemptReport(attemptId: string): CaptchaDiagnosticReport | null {
  return getState(attemptId)?.report ?? null;
}

export async function ensureDebugDir(
  batchId: string,
  executionId: string,
  attemptId: string
): Promise<string | null> {
  if (!CAPTCHA_DEBUG) return null;
  const base = resolveStoragePath('./debug/captchas');
  const dir = path.join(base, batchId || 'no-batch', executionId || 'no-exec', attemptId);
  await fs.mkdir(dir, { recursive: true });
  const st = getState(attemptId);
  if (st) st.dir = dir;
  return dir;
}

export async function writeDiagnosticJson(attemptId: string): Promise<string | null> {
  if (!CAPTCHA_DEBUG) return null;
  const st = getState(attemptId);
  if (!st) return null;
  const dir =
    st.dir ||
    (await ensureDebugDir(
      st.report.identifiers.batchId,
      st.report.identifiers.executionId,
      attemptId
    ));
  if (!dir) return null;
  const file = path.join(dir, 'diagnostic.json');
  await fs.writeFile(file, JSON.stringify(st.report, null, 2), 'utf8');
  return file;
}

export async function captureDebugScreenshot(
  page: Page,
  attemptId: string,
  name: string
): Promise<void> {
  if (!CAPTCHA_DEBUG) return;
  try {
    const st = getState(attemptId);
    const dir =
      st?.dir ||
      (await ensureDebugDir(
        st?.report.identifiers.batchId || 'no-batch',
        st?.report.identifiers.executionId || 'no-exec',
        attemptId
      ));
    if (!dir) return;
    await page.screenshot({
      path: path.join(dir, `${name}.png`),
      fullPage: false,
    });
  } catch (err) {
    debugLog('screenshot_failed', { attemptId, name, erro: (err as Error).message });
  }
}

/**
 * Snapshot rico da página original no momento do hCaptcha.
 */
export async function captureOriginalPageSnapshot(
  page: Page,
  ids: {
    batchId: string;
    executionId: string;
    attemptId: string;
    captchaId?: string;
  }
): Promise<CaptchaOriginalPageSnapshot> {
  const pageUrl = page.url();
  let hostname = '';
  let origin = '';
  try {
    const u = new URL(pageUrl);
    hostname = u.hostname;
    origin = u.origin;
  } catch {
    /* ignore */
  }

  let userAgent = '';
  try {
    userAgent = String(await page.evaluate('navigator.userAgent'));
  } catch {
    /* ignore */
  }

  const domInfo = await page.evaluate(`(() => {
    function collectFields(doc) {
      var out = [];
      var nodes = doc.querySelectorAll(
        'textarea[name*="captcha"], textarea[id*="captcha"], input[name*="captcha"], textarea[name="h-captcha-response"], textarea[name="g-recaptcha-response"], #h-captcha-response'
      );
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        out.push({
          name: el.getAttribute('name') || undefined,
          id: el.id || undefined,
          valueLength: (el.value || '').length
        });
      }
      return out;
    }
    var siteEl = document.querySelector('[data-sitekey]');
    var iframes = Array.prototype.slice.call(document.querySelectorAll('iframe[src*="hcaptcha"]'));
    var modal = document.querySelector('#btnSubmitHCaptcha');
    return {
      siteKey: siteEl ? (siteEl.getAttribute('data-sitekey') || undefined) : undefined,
      rqdata: siteEl ? (siteEl.getAttribute('data-rqdata') || undefined) : undefined,
      action: siteEl ? (siteEl.getAttribute('data-action') || undefined) : undefined,
      callbackName: siteEl ? (siteEl.getAttribute('data-callback') || undefined) : undefined,
      iframeCount: iframes.length,
      iframeSrcSanitized: iframes.map(function (f) {
        try {
          var u = new URL(f.src);
          return u.origin + u.pathname;
        } catch (e) {
          return String(f.src || '').slice(0, 80);
        }
      }),
      responseFields: collectFields(document),
      modalVisible: !!(modal && modal.offsetParent !== null)
    };
  })()`) as {
    siteKey?: string;
    rqdata?: string;
    action?: string;
    callbackName?: string;
    iframeCount: number;
    iframeSrcSanitized: string[];
    responseFields: Array<{ name?: string; id?: string; valueLength: number }>;
    modalVisible: boolean;
  };

  // Enriquecer campos de frames
  const frameFields: CaptchaOriginalPageSnapshot['responseFields'] = [
    ...domInfo.responseFields.map((f) => ({ ...f, frameUrl: sanitizeUrl(pageUrl) })),
  ];
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    try {
      const extra = (await frame.evaluate(`(() => {
        var out = [];
        var nodes = document.querySelectorAll(
          'textarea[name*="captcha"], textarea[id*="captcha"], textarea[name="h-captcha-response"], textarea[name="g-recaptcha-response"]'
        );
        for (var i = 0; i < nodes.length; i++) {
          var el = nodes[i];
          out.push({
            name: el.getAttribute('name') || undefined,
            id: el.id || undefined,
            valueLength: (el.value || '').length
          });
        }
        return out;
      })()`)) as Array<{ name?: string; id?: string; valueLength: number }>;
      for (const f of extra) {
        frameFields.push({ ...f, frameUrl: sanitizeUrl(frame.url()) });
      }
    } catch {
      /* frame detached */
    }
  }

  const snapshot: CaptchaOriginalPageSnapshot = {
    batchId: ids.batchId,
    executionId: ids.executionId,
    captchaId: ids.captchaId,
    attemptId: ids.attemptId,
    pageUrl,
    hostname,
    origin,
    userAgent,
    siteKey: domInfo.siteKey,
    rqdata: domInfo.rqdata || undefined,
    action: domInfo.action || undefined,
    callbackName: domInfo.callbackName || undefined,
    iframeCount: domInfo.iframeCount,
    iframeSrcSanitized: domInfo.iframeSrcSanitized,
    responseFields: frameFields,
    modalVisible: domInfo.modalVisible,
    capturedAt: new Date().toISOString(),
  };

  debugLog('original_page_snapshot', {
    attemptId: ids.attemptId,
    pageUrl: sanitizeUrl(pageUrl),
    hostname,
    siteKeyPresent: Boolean(snapshot.siteKey),
    siteKeyPreview: snapshot.siteKey
      ? `${snapshot.siteKey.slice(0, 6)}...`
      : undefined,
    rqdataPresent: Boolean(snapshot.rqdata),
    rqdataLen: snapshot.rqdata?.length,
    actionPresent: Boolean(snapshot.action),
    callbackName: snapshot.callbackName,
    iframeCount: snapshot.iframeCount,
    responseFieldCount: snapshot.responseFields.length,
    modalVisible: snapshot.modalVisible,
  });

  return snapshot;
}

export function clearAttempt(attemptId: string): void {
  attempts.delete(attemptId);
}

export function clearAllAttemptsForTests(): void {
  attempts.clear();
}

export function classifyFromPortalResult(
  result: PortalCaptchaResult,
  hashesMatch: boolean
): { classification: string; probableCause: string } {
  if (!hashesMatch) {
    return {
      classification: 'B. Transporte incorreto',
      probableCause: 'Hashes do token divergiram entre camadas',
    };
  }
  switch (result) {
    case 'ACCEPTED':
      return {
        classification: 'OK',
        probableCause: 'Portal aceitou o token',
      };
    case 'REJECTED':
      return {
        classification: 'H. Token rejeitado pelo portal',
        probableCause: 'Portal respondeu rejeitando a solução após injeção',
      };
    case 'NO_REQUEST_SENT':
      return {
        classification: 'G. Callback ou submissão ausente',
        probableCause: 'Nenhuma requisição relevante após injeção/clique',
      };
    case 'CALLBACK_NOT_EXECUTED':
      return {
        classification: 'G. Callback ou submissão ausente',
        probableCause: 'Callback do widget original não foi executado',
      };
    case 'MODAL_REMAINED_OPEN':
      return {
        classification: 'F. Injeção incorreta / portal não avançou',
        probableCause: 'Modal permaneceu aberto após submissão',
      };
    case 'NEW_CHALLENGE_CREATED':
      return {
        classification: 'H. Token rejeitado / novo desafio',
        probableCause: 'Portal regenerou o desafio após a tentativa',
      };
    default:
      return {
        classification: 'J. Não foi possível concluir',
        probableCause: 'Resultado do portal indeterminado',
      };
  }
}
