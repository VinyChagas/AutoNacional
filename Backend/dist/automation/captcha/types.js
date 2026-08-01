"use strict";
/**
 * Contratos de provedores de resolução de hCaptcha.
 * Modo do lote (UI) é independente do CAPTCHA_MODE de ambiente (auto/manual/auto_manual).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CAPTCHA_MODES = void 0;
exports.parseCaptchaMode = parseCaptchaMode;
exports.isCaptchaMode = isCaptchaMode;
exports.CAPTCHA_MODES = ['TWO_CAPTCHA', 'MANUAL'];
function parseCaptchaMode(value) {
    if (value === 'MANUAL' || value === 'manual')
        return 'MANUAL';
    if (value === 'TWO_CAPTCHA' || value === 'TWOCAPTCHA' || value === '2captcha') {
        return 'TWO_CAPTCHA';
    }
    return 'TWO_CAPTCHA';
}
function isCaptchaMode(value) {
    return value === 'TWO_CAPTCHA' || value === 'MANUAL';
}
//# sourceMappingURL=types.js.map