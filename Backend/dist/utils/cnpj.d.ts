/**
 * Utilitários para CNPJ: normalização e validação de formato.
 */
/**
 * Remove pontuação e espaços do CNPJ (apenas dígitos).
 */
export declare function normalizeCnpj(cnpj: string): string;
/**
 * Validação simples: 14 dígitos numéricos.
 * Não valida dígitos verificadores.
 */
export declare function isValidCnpjFormat(cnpj: string): boolean;
//# sourceMappingURL=cnpj.d.ts.map