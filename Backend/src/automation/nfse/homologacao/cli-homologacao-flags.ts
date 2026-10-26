/**
 * Flags opcionais da CLI admin (preparar) — alinhadas ao protocolo UDS / CaptchaMode.
 * Não altera defaults do Backend; ausência = undefined (Backend aplica defaults existentes).
 */
import { isCaptchaMode, type CaptchaMode } from '../../captcha/types';
import { HomologacaoNfseError } from './types';

type Args = Record<string, string | boolean>;

/**
 * --headless true|false (explícito).
 * Ausente → undefined (não sobrescreve default do Backend).
 * Bare `--headless` (boolean true sem valor) → recusado (exige true|false).
 */
export function parseFlagHeadless(args: Args): boolean | undefined {
  if (!('headless' in args)) return undefined;
  const v = args.headless;
  if (v === true) {
    throw new HomologacaoNfseError(
      'CONTEXTO_INVALIDO',
      'Informe --headless true ou --headless false (valor explícito).'
    );
  }
  if (typeof v !== 'string') {
    throw new HomologacaoNfseError('CONTEXTO_INVALIDO', '--headless inválido.');
  }
  const n = v.trim().toLowerCase();
  if (n === 'true') return true;
  if (n === 'false') return false;
  throw new HomologacaoNfseError(
    'CONTEXTO_INVALIDO',
    '--headless deve ser true ou false.'
  );
}

/**
 * --captcha-mode MANUAL|TWO_CAPTCHA.
 * Ausente → undefined (Backend default TWO_CAPTCHA na preparação).
 */
export function parseFlagCaptchaMode(args: Args): CaptchaMode | undefined {
  if (!('captcha-mode' in args)) return undefined;
  const v = args['captcha-mode'];
  if (typeof v !== 'string' || !v.trim()) {
    throw new HomologacaoNfseError(
      'CONTEXTO_INVALIDO',
      'Informe --captcha-mode MANUAL ou TWO_CAPTCHA.'
    );
  }
  const modo = v.trim().toUpperCase().replace(/-/g, '_');
  const normalizado =
    modo === 'TWOCAPTCHA' || modo === '2CAPTCHA' ? 'TWO_CAPTCHA' : modo;
  if (!isCaptchaMode(normalizado)) {
    throw new HomologacaoNfseError(
      'CONTEXTO_INVALIDO',
      '--captcha-mode deve ser MANUAL ou TWO_CAPTCHA.'
    );
  }
  return normalizado;
}
