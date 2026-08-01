"use strict";
/**
 * Provider MANUAL (legado token). O fluxo atual da Central usa remote_click
 * via resolverCaptchaPorCliquesRemotos — este provider permanece para testes.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.manualCaptchaProvider = exports.ManualCaptchaProvider = void 0;
const manual_captcha_service_1 = require("../../services/manual-captcha.service");
const captcha_diagnostic_1 = require("../captcha-diagnostic");
class ManualCaptchaProvider {
    mode = 'MANUAL';
    async solve(request) {
        if (!request.batchId) {
            return {
                status: 'CANCELLED',
                reason: 'batchId obrigatório para resolução manual',
            };
        }
        const result = await (0, manual_captcha_service_1.requestCaptcha)(request);
        if (result.status === 'RESOLVED') {
            if (result.token) {
                const fp = (0, captcha_diagnostic_1.fingerprintToken)(result.token);
                (0, captcha_diagnostic_1.recordTokenHash)(result.attemptId, 'provider', result.token);
                (0, captcha_diagnostic_1.appendEvidence)(result.attemptId, `provider_received tokenLength=${fp.tokenLength} tokenHash=${fp.tokenHash}`);
            }
            return {
                status: 'RESOLVED',
                captchaId: result.captchaId,
                attemptId: result.attemptId,
                token: result.token,
                resolvedAt: result.resolvedAt,
            };
        }
        return {
            status: result.status,
            captchaId: result.captchaId,
            attemptId: result.attemptId,
            reason: result.status === 'CANCELLED' ? result.reason : undefined,
        };
    }
}
exports.ManualCaptchaProvider = ManualCaptchaProvider;
exports.manualCaptchaProvider = new ManualCaptchaProvider();
//# sourceMappingURL=manual-captcha.provider.js.map