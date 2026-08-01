/**
 * Provider MANUAL (legado token). O fluxo atual da Central usa remote_click
 * via resolverCaptchaPorCliquesRemotos — este provider permanece para testes.
 */
import type { CaptchaProvider, CaptchaRequest, CaptchaSolution } from './types';
export declare class ManualCaptchaProvider implements CaptchaProvider {
    readonly mode: "MANUAL";
    solve(request: CaptchaRequest): Promise<CaptchaSolution>;
}
export declare const manualCaptchaProvider: ManualCaptchaProvider;
//# sourceMappingURL=manual-captcha.provider.d.ts.map