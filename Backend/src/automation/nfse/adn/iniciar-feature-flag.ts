/**
 * Kill-switch de emergência para ADN no Iniciar (env).
 *
 * Comportamento de produto (padrão A1→ADN) vive em iniciar-config.ts.
 * Este módulo NÃO habilita ADN sozinho:
 * - ausente → não interfere (produto manda)
 * - true → não força off (redundante com produto)
 * - false / inválida → força Playwright para todos
 *
 * NFSE_ADN_INICIAR_CNPJS (allowlist de piloto) está deprecada:
 * use playwrightExcecaoCnpjs na config persistente para forçar Playwright.
 */

export const NOME_FLAG_ADN_INICIAR = 'NFSE_ADN_INICIAR_ENABLED';
/** @deprecated Preferir config persistente playwrightExcecaoCnpjs. */
export const NOME_ALLOWLIST_ADN_INICIAR = 'NFSE_ADN_INICIAR_CNPJS';

export type LeituraFlagAdnIniciar =
  | { ativa: false; motivo: 'AUSENTE' | 'FALSE' | 'INVALIDA'; valorBruto: string | null }
  | { ativa: true; motivo: 'TRUE'; valorBruto: 'true' };

export function lerFlagAdnIniciar(
  env: NodeJS.ProcessEnv = process.env
): LeituraFlagAdnIniciar {
  const bruto = env[NOME_FLAG_ADN_INICIAR];
  if (bruto === undefined || bruto === null || String(bruto).trim() === '') {
    return { ativa: false, motivo: 'AUSENTE', valorBruto: bruto ?? null };
  }
  const valor = String(bruto).trim().toLowerCase();
  if (valor === 'false') {
    return { ativa: false, motivo: 'FALSE', valorBruto: String(bruto) };
  }
  if (valor === 'true') {
    return { ativa: true, motivo: 'TRUE', valorBruto: 'true' };
  }
  return { ativa: false, motivo: 'INVALIDA', valorBruto: String(bruto) };
}

/**
 * Kill-switch ativo? (false/inválida no env).
 * Ausente NÃO conta como desligado — o produto decide.
 */
export function killSwitchAdnIniciarAtivo(env: NodeJS.ProcessEnv = process.env): boolean {
  const l = lerFlagAdnIniciar(env);
  return l.motivo === 'FALSE' || l.motivo === 'INVALIDA';
}

/** @deprecated Preferir !killSwitch + config.adnPadraoA1. */
export function flagAdnIniciarAtiva(env: NodeJS.ProcessEnv = process.env): boolean {
  return !killSwitchAdnIniciarAtivo(env);
}

/** @deprecated Allowlist de piloto — mantida só para leitura legada em testes/ops. */
export function lerAllowlistAdnIniciar(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const bruto = env[NOME_ALLOWLIST_ADN_INICIAR];
  const out = new Set<string>();
  if (typeof bruto !== 'string' || !bruto.trim()) return out;
  for (const parte of bruto.split(/[,;\s]+/)) {
    const digitos = parte.replace(/\D/g, '');
    if (digitos.length >= 11) out.add(digitos);
  }
  return out;
}

/** @deprecated */
export function cnpjNaAllowlistAdnIniciar(
  cnpj: string,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const digitos = String(cnpj ?? '').replace(/\D/g, '');
  if (!digitos) return false;
  return lerAllowlistAdnIniciar(env).has(digitos);
}
