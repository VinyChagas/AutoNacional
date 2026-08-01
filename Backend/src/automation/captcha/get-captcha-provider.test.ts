import { describe, it, expect } from 'vitest';
import { getCaptchaProvider } from './get-captcha-provider';
import { twoCaptchaProvider } from './two-captcha.provider';
import { manualCaptchaProvider } from './manual-captcha.provider';
import { parseCaptchaMode, isCaptchaMode } from './types';

describe('captcha providers', () => {
  it('retorna TwoCaptchaProvider para TWO_CAPTCHA', () => {
    expect(getCaptchaProvider('TWO_CAPTCHA')).toBe(twoCaptchaProvider);
    expect(getCaptchaProvider('TWO_CAPTCHA').mode).toBe('TWO_CAPTCHA');
  });

  it('retorna ManualCaptchaProvider para MANUAL', () => {
    expect(getCaptchaProvider('MANUAL')).toBe(manualCaptchaProvider);
    expect(getCaptchaProvider('MANUAL').mode).toBe('MANUAL');
  });

  it('parseCaptchaMode preserva padrão TWO_CAPTCHA', () => {
    expect(parseCaptchaMode(undefined)).toBe('TWO_CAPTCHA');
    expect(parseCaptchaMode('MANUAL')).toBe('MANUAL');
    expect(parseCaptchaMode('invalid')).toBe('TWO_CAPTCHA');
    expect(isCaptchaMode('TWO_CAPTCHA')).toBe(true);
    expect(isCaptchaMode('NOPE')).toBe(false);
  });
});
