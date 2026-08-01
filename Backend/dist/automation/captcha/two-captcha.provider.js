"use strict";
/**
 * Provider que reutiliza a integração existente com 2Captcha.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.twoCaptchaProvider = exports.TwoCaptchaProvider = void 0;
const captcha_solver_1 = require("../captcha-solver");
class TwoCaptchaProvider {
    mode = 'TWO_CAPTCHA';
    async solve(request) {
        const token = await (0, captcha_solver_1.resolverHCaptcha)(request.siteKey, request.pageUrl, {
            userAgent: request.userAgent,
            ...(request.rqdata ? { rqdata: request.rqdata } : {}),
        });
        return {
            status: 'RESOLVED',
            token,
            resolvedAt: new Date().toISOString(),
        };
    }
}
exports.TwoCaptchaProvider = TwoCaptchaProvider;
exports.twoCaptchaProvider = new TwoCaptchaProvider();
//# sourceMappingURL=two-captcha.provider.js.map