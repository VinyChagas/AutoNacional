"use strict";
/**
 * Tipos e classificação de erros para retry de download por operação (XML/PDF).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotaNaoEncontradaParaRetryError = exports.CaptchaModalCloseError = void 0;
exports.maskNfseKey = maskNfseKey;
exports.extractErrorCode = extractErrorCode;
exports.classificarErroDaOperacao = classificarErroDaOperacao;
const config_1 = require("../infrastructure/config");
const captcha_solver_1 = require("./captcha-solver");
class CaptchaModalCloseError extends Error {
    constructor(message) {
        super(message);
        this.name = 'CaptchaModalCloseError';
    }
}
exports.CaptchaModalCloseError = CaptchaModalCloseError;
class NotaNaoEncontradaParaRetryError extends Error {
    constructor(message) {
        super(message);
        this.name = 'NotaNaoEncontradaParaRetryError';
    }
}
exports.NotaNaoEncontradaParaRetryError = NotaNaoEncontradaParaRetryError;
const CONFIG_ERROR_CODES = new Set([
    'ERROR_KEY_DOES_NOT_EXIST',
    'ERROR_ZERO_BALANCE',
    'ERROR_IP_NOT_ALLOWED',
    'ERROR_ACCOUNT_SUSPENDED',
    'ERROR_BAD_PARAMETERS',
    'ERROR_WRONG_USER_KEY',
    'ERROR_KEY_DOES_NOT_EXIST',
]);
const NETWORK_RETRY_PATTERNS = [
    /ECONNRESET/i,
    /ETIMEDOUT/i,
    /ECONNREFUSED/i,
    /fetch failed/i,
    /network/i,
    /\b429\b/,
    /\b502\b/,
    /\b503\b/,
    /\b504\b/,
];
function maskNfseKey(chave) {
    if (!chave || chave.length < 10)
        return '***';
    return `${chave.slice(0, 6)}...${chave.slice(-4)}`;
}
function extractErrorCode(error) {
    if (error instanceof captcha_solver_1.CaptchaError && error.code) {
        return error.code;
    }
    const msg = error instanceof Error ? error.message : String(error);
    const m = /ERROR_[A-Z0-9_]+/.exec(msg);
    if (m)
        return m[0];
    if (/TWOCAPTCHA_API_KEY|não configurada|sitekey/i.test(msg)) {
        return 'ERROR_CONFIGURATION';
    }
    if (error instanceof CaptchaModalCloseError)
        return 'ERROR_MODAL_CLOSE';
    if (error instanceof NotaNaoEncontradaParaRetryError)
        return 'ERROR_NOTE_NOT_FOUND';
    if (/TimeoutError|timeout/i.test(msg))
        return 'ERROR_TIMEOUT';
    return 'ERROR_UNKNOWN';
}
/**
 * Classifica o erro da operação de download para decidir retry / fallback / falha.
 */
function classificarErroDaOperacao(error) {
    const code = extractErrorCode(error);
    const reason = error instanceof Error ? error.message : String(error);
    if (CONFIG_ERROR_CODES.has(code) || code === 'ERROR_CONFIGURATION') {
        return {
            retryable: false,
            action: 'FAIL_CONFIGURATION',
            code,
            reason,
        };
    }
    if (code === 'ERROR_NOTE_NOT_FOUND') {
        return {
            retryable: false,
            action: 'FAIL_PERMANENT',
            code,
            reason,
        };
    }
    const retryableCodes = new Set(config_1.CAPTCHA_RETRYABLE_ERROR_CODES);
    if (retryableCodes.has(code) || code === 'ERROR_CAPTCHA_UNSOLVABLE') {
        return {
            retryable: true,
            action: 'RETRY_NEW_CAPTCHA',
            code,
            reason,
        };
    }
    if (code === 'ERROR_TIMEOUT' ||
        code === 'ERROR_MODAL_CLOSE' ||
        NETWORK_RETRY_PATTERNS.some((p) => p.test(reason))) {
        return {
            retryable: true,
            action: 'RETRY_NEW_CAPTCHA',
            code,
            reason,
        };
    }
    if (/arquivo inválido|invalid file|HTML de erro|%PDF/i.test(reason)) {
        return {
            retryable: true,
            action: 'RETRY_SAME_OPERATION',
            code: 'ERROR_INVALID_FILE',
            reason,
        };
    }
    return {
        retryable: false,
        action: 'FALLBACK_MANUAL',
        code,
        reason,
    };
}
//# sourceMappingURL=download-operation-types.js.map