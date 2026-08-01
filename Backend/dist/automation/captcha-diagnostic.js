"use strict";
/**
 * Instrumentação e evidências da Central Manual de Captchas.
 * Ativa somente com CAPTCHA_DEBUG=true.
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
exports.isCaptchaDebug = isCaptchaDebug;
exports.newAttemptId = newAttemptId;
exports.fingerprintToken = fingerprintToken;
exports.payloadFingerprint = payloadFingerprint;
exports.sanitizeUrl = sanitizeUrl;
exports.initAttemptReport = initAttemptReport;
exports.recordTokenHash = recordTokenHash;
exports.appendEvidence = appendEvidence;
exports.patchReport = patchReport;
exports.finalizeAttemptReport = finalizeAttemptReport;
exports.getAttemptReport = getAttemptReport;
exports.ensureDebugDir = ensureDebugDir;
exports.writeDiagnosticJson = writeDiagnosticJson;
exports.captureDebugScreenshot = captureDebugScreenshot;
exports.captureOriginalPageSnapshot = captureOriginalPageSnapshot;
exports.clearAttempt = clearAttempt;
exports.clearAllAttemptsForTests = clearAllAttemptsForTests;
exports.classifyFromPortalResult = classifyFromPortalResult;
const crypto_1 = require("crypto");
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const config_1 = require("../infrastructure/config");
const logger_1 = require("../infrastructure/logger");
const path_resolve_1 = require("../utils/path-resolve");
const logger = (0, logger_1.getLogger)('captcha-diag');
const attempts = new Map();
function isCaptchaDebug() {
    return config_1.CAPTCHA_DEBUG;
}
function newAttemptId() {
    return (0, crypto_1.randomUUID)();
}
function fingerprintToken(token) {
    const tokenLength = token?.length ?? 0;
    const tokenHash = (0, crypto_1.createHash)('sha256')
        .update(token || '')
        .digest('hex')
        .slice(0, 16);
    let tokenPreview = '***';
    if (tokenLength > 12) {
        tokenPreview = `${token.slice(0, 6)}...${token.slice(-3)}`;
    }
    return { tokenLength, tokenHash, tokenPreview };
}
function payloadFingerprint(parts) {
    const raw = [
        parts.captchaId,
        parts.attemptId,
        parts.siteKey,
        parts.pageUrl,
        parts.rqdata ?? '',
        parts.action ?? '',
    ].join('|');
    return (0, crypto_1.createHash)('sha256').update(raw).digest('hex').slice(0, 24);
}
function sanitizeUrl(url) {
    try {
        const u = new URL(url);
        u.search = '';
        u.hash = '';
        return u.toString();
    }
    catch {
        return url.slice(0, 120);
    }
}
function debugLog(evento, data) {
    if (!config_1.CAPTCHA_DEBUG)
        return;
    logger.info({ evento, ...data }, `[CAPTCHA_DEBUG] ${evento}`);
}
function initAttemptReport(input) {
    const report = {
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
function getState(attemptId) {
    return attempts.get(attemptId);
}
function recordTokenHash(attemptId, layer, token) {
    const fp = fingerprintToken(token);
    const st = getState(attemptId);
    if (st) {
        st.hashes[layer] = fp.tokenHash;
        if (layer === 'frontend')
            st.report.tokenFlow.frontendHash = fp.tokenHash;
        if (layer === 'socket')
            st.report.tokenFlow.socketHash = fp.tokenHash;
        if (layer === 'service')
            st.report.tokenFlow.serviceHash = fp.tokenHash;
        if (layer === 'provider')
            st.report.tokenFlow.providerHash = fp.tokenHash;
        if (layer === 'playwright')
            st.report.tokenFlow.playwrightHash = fp.tokenHash;
        const values = Object.values(st.hashes).filter(Boolean);
        st.report.tokenFlow.allHashesMatch =
            values.length <= 1 || values.every((h) => h === values[0]);
    }
    debugLog('token_hash', { attemptId, layer, ...fp });
    return fp;
}
function appendEvidence(attemptId, evidence) {
    const st = getState(attemptId);
    if (st)
        st.report.evidence.push(evidence);
    debugLog('evidence', { attemptId, evidence });
}
function patchReport(attemptId, patch) {
    const st = getState(attemptId);
    if (!st)
        return;
    Object.assign(st.report, patch);
    if (patch.originalPage)
        Object.assign(st.report.originalPage, patch.originalPage);
    if (patch.central)
        Object.assign(st.report.central, patch.central);
    if (patch.tokenFlow)
        Object.assign(st.report.tokenFlow, patch.tokenFlow);
    if (patch.injection)
        Object.assign(st.report.injection, patch.injection);
    if (patch.portal)
        Object.assign(st.report.portal, patch.portal);
    if (patch.timings)
        Object.assign(st.report.timings || {}, patch.timings);
}
function finalizeAttemptReport(attemptId, classification, probableCause) {
    const st = getState(attemptId);
    if (!st)
        return null;
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
function getAttemptReport(attemptId) {
    return getState(attemptId)?.report ?? null;
}
async function ensureDebugDir(batchId, executionId, attemptId) {
    if (!config_1.CAPTCHA_DEBUG)
        return null;
    const base = (0, path_resolve_1.resolveStoragePath)('./debug/captchas');
    const dir = path.join(base, batchId || 'no-batch', executionId || 'no-exec', attemptId);
    await fs.mkdir(dir, { recursive: true });
    const st = getState(attemptId);
    if (st)
        st.dir = dir;
    return dir;
}
async function writeDiagnosticJson(attemptId) {
    if (!config_1.CAPTCHA_DEBUG)
        return null;
    const st = getState(attemptId);
    if (!st)
        return null;
    const dir = st.dir ||
        (await ensureDebugDir(st.report.identifiers.batchId, st.report.identifiers.executionId, attemptId));
    if (!dir)
        return null;
    const file = path.join(dir, 'diagnostic.json');
    await fs.writeFile(file, JSON.stringify(st.report, null, 2), 'utf8');
    return file;
}
async function captureDebugScreenshot(page, attemptId, name) {
    if (!config_1.CAPTCHA_DEBUG)
        return;
    try {
        const st = getState(attemptId);
        const dir = st?.dir ||
            (await ensureDebugDir(st?.report.identifiers.batchId || 'no-batch', st?.report.identifiers.executionId || 'no-exec', attemptId));
        if (!dir)
            return;
        await page.screenshot({
            path: path.join(dir, `${name}.png`),
            fullPage: false,
        });
    }
    catch (err) {
        debugLog('screenshot_failed', { attemptId, name, erro: err.message });
    }
}
/**
 * Snapshot rico da página original no momento do hCaptcha.
 */
async function captureOriginalPageSnapshot(page, ids) {
    const pageUrl = page.url();
    let hostname = '';
    let origin = '';
    try {
        const u = new URL(pageUrl);
        hostname = u.hostname;
        origin = u.origin;
    }
    catch {
        /* ignore */
    }
    let userAgent = '';
    try {
        userAgent = String(await page.evaluate('navigator.userAgent'));
    }
    catch {
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
  })()`);
    // Enriquecer campos de frames
    const frameFields = [
        ...domInfo.responseFields.map((f) => ({ ...f, frameUrl: sanitizeUrl(pageUrl) })),
    ];
    for (const frame of page.frames()) {
        if (frame === page.mainFrame())
            continue;
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
      })()`));
            for (const f of extra) {
                frameFields.push({ ...f, frameUrl: sanitizeUrl(frame.url()) });
            }
        }
        catch {
            /* frame detached */
        }
    }
    const snapshot = {
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
function clearAttempt(attemptId) {
    attempts.delete(attemptId);
}
function clearAllAttemptsForTests() {
    attempts.clear();
}
function classifyFromPortalResult(result, hashesMatch) {
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
//# sourceMappingURL=captcha-diagnostic.js.map