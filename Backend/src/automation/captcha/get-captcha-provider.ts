import type { CaptchaMode, CaptchaProvider } from './types';
import { twoCaptchaProvider } from './two-captcha.provider';
import { manualCaptchaProvider } from './manual-captcha.provider';

/**
 * Retorna o provider conforme o modo do lote.
 * Não usa estado global mutável — o modo deve ser passado explicitamente.
 */
export function getCaptchaProvider(mode: CaptchaMode): CaptchaProvider {
  if (mode === 'MANUAL') {
    return manualCaptchaProvider;
  }
  return twoCaptchaProvider;
}
