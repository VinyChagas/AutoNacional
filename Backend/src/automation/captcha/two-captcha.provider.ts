/**
 * Provider que reutiliza a integração existente com 2Captcha.
 */

import { resolverHCaptcha } from '../captcha-solver';
import type { CaptchaProvider, CaptchaRequest, CaptchaSolution } from './types';

export class TwoCaptchaProvider implements CaptchaProvider {
  readonly mode = 'TWO_CAPTCHA' as const;

  async solve(request: CaptchaRequest): Promise<CaptchaSolution> {
    const token = await resolverHCaptcha(request.siteKey, request.pageUrl, {
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

export const twoCaptchaProvider = new TwoCaptchaProvider();
