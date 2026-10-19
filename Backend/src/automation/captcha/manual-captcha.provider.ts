/**
 * Provider MANUAL (legado token). O fluxo atual da Central usa remote_click
 * via resolverCaptchaPorCliquesRemotos — este provider permanece para testes.
 */

import { requestCaptcha } from '../../services/manual-captcha.service';
import {
  recordTokenHash,
  appendEvidence,
  fingerprintToken,
} from '../captcha-diagnostic';
import type { CaptchaProvider, CaptchaRequest, CaptchaSolution } from './types';

export class ManualCaptchaProvider implements CaptchaProvider {
  readonly mode = 'MANUAL' as const;

  async solve(request: CaptchaRequest): Promise<CaptchaSolution> {
    if (!request.batchId) {
      return {
        status: 'CANCELLED',
        reason: 'batchId obrigatório para resolução manual',
      };
    }

    const result = await requestCaptcha(request);

    if (result.status === 'RESOLVED') {
      if (result.token) {
        const fp = fingerprintToken(result.token);
        recordTokenHash(result.attemptId, 'provider', result.token);
        appendEvidence(
          result.attemptId,
          `provider_received tokenLength=${fp.tokenLength} tokenHash=${fp.tokenHash}`
        );
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

export const manualCaptchaProvider = new ManualCaptchaProvider();
