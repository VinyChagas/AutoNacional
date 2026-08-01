"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCaptchaProvider = getCaptchaProvider;
const two_captcha_provider_1 = require("./two-captcha.provider");
const manual_captcha_provider_1 = require("./manual-captcha.provider");
/**
 * Retorna o provider conforme o modo do lote.
 * Não usa estado global mutável — o modo deve ser passado explicitamente.
 */
function getCaptchaProvider(mode) {
    if (mode === 'MANUAL') {
        return manual_captcha_provider_1.manualCaptchaProvider;
    }
    return two_captcha_provider_1.twoCaptchaProvider;
}
//# sourceMappingURL=get-captcha-provider.js.map