/**
 * Provider que reutiliza a integração existente com 2Captcha.
 */
import type { CaptchaProvider, CaptchaRequest, CaptchaSolution } from './types';
export declare class TwoCaptchaProvider implements CaptchaProvider {
    readonly mode: "TWO_CAPTCHA";
    solve(request: CaptchaRequest): Promise<CaptchaSolution>;
}
export declare const twoCaptchaProvider: TwoCaptchaProvider;
//# sourceMappingURL=two-captcha.provider.d.ts.map