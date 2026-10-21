/**
 * Feature flag A1 → ADN no botão Iniciar.
 * Ausente ou false: desativada (fluxo Playwright preservado).
 * true: habilitada — ainda exige autorização por empresa (allowlist ou explícita).
 * Qualquer outro valor: falha segura (desativada).
 * Não carrega certificado, não abre navegador e não chama ADN.
 */

export const NOME_FLAG_ADN_INICIAR = 'NFSE_ADN_INICIAR_ENABLED';
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

export function flagAdnIniciarAtiva(env: NodeJS.ProcessEnv = process.env): boolean {
  return lerFlagAdnIniciar(env).ativa;
}

/** CNPJs autorizados individualmente (apenas dígitos). Vazio = ninguém na allowlist. */
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

export function cnpjNaAllowlistAdnIniciar(
  cnpj: string,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const digitos = String(cnpj ?? '').replace(/\D/g, '');
  if (!digitos) return false;
  return lerAllowlistAdnIniciar(env).has(digitos);
}
