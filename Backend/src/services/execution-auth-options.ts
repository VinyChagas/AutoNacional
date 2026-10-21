/**
 * UI-01c — Resolução de headless/captchaMode por empresa (lotes mistos).
 * Não altera login, PQueue, Browser Manager nem Central de CAPTCHA.
 */
import type { CaptchaMode } from '../automation/captcha/types';

export type TipoAutenticacaoExecucao = 'certificado' | 'credenciais';

export interface OpcoesAuthPorEmpresa {
  headless: boolean;
  captchaMode: CaptchaMode;
}

/**
 * A1 (certificado): respeita preferência headless do operador;
 *   CAPTCHA do lote (padrão TWO_CAPTCHA) — sem forçar manual.
 * Credenciais: navegador sempre visível + CAPTCHA manual.
 */
export function resolverOpcoesAuthPorEmpresa(
  tipoAuth: TipoAutenticacaoExecucao,
  preferenciaHeadless: boolean,
  captchaModeLote: CaptchaMode = 'TWO_CAPTCHA'
): OpcoesAuthPorEmpresa {
  if (tipoAuth === 'credenciais') {
    return { headless: false, captchaMode: 'MANUAL' };
  }
  return {
    headless: preferenciaHeadless,
    captchaMode: captchaModeLote,
  };
}

/** Defaults operacionais da UI-01c no payload do lote (FE → multiplas). */
export const UI01C_TIPO_NOTAS = 'ambas' as const;
export const UI01C_BAIXAR_PDF = false;
