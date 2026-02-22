"use strict";
/**
 * Utilitários para CNPJ: normalização e validação de formato.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeCnpj = normalizeCnpj;
exports.isValidCnpjFormat = isValidCnpjFormat;
/**
 * Remove pontuação e espaços do CNPJ (apenas dígitos).
 */
function normalizeCnpj(cnpj) {
    return String(cnpj ?? '').replace(/[.\/\-\s]/g, '').trim();
}
/**
 * Validação simples: 14 dígitos numéricos.
 * Não valida dígitos verificadores.
 */
function isValidCnpjFormat(cnpj) {
    const n = normalizeCnpj(cnpj);
    return n.length === 14 && /^\d{14}$/.test(n);
}
//# sourceMappingURL=cnpj.js.map