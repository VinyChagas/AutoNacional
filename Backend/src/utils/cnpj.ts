/**
 * Utilitários para CNPJ: normalização e validação de formato.
 */

/**
 * Remove pontuação e espaços do CNPJ (apenas dígitos).
 */
export function normalizeCnpj(cnpj: string): string {
  return String(cnpj ?? '').replace(/[.\/\-\s]/g, '').trim();
}

/**
 * Validação simples: 14 dígitos numéricos.
 * Não valida dígitos verificadores.
 */
export function isValidCnpjFormat(cnpj: string): boolean {
  const n = normalizeCnpj(cnpj);
  return n.length === 14 && /^\d{14}$/.test(n);
}
