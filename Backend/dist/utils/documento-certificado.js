"use strict";
/**
 * Utilitários de matching de CNPJ/CPF para certificados.
 * Evita falso negativo/positivo por formatação ou padding de CPF.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.limparDocumento = limparDocumento;
exports.variantesDocumento = variantesDocumento;
exports.documentosEquivalentes = documentosEquivalentes;
function limparDocumento(valor) {
    return (valor || '').replace(/[.\/\-\s]/g, '').trim();
}
/**
 * Variantes possíveis de um documento no banco (limpo, CPF sem pad, CPF com pad).
 */
function variantesDocumento(cnpjOuCpf) {
    const limpo = limparDocumento(cnpjOuCpf);
    if (!limpo)
        return [];
    const out = new Set([limpo]);
    if (limpo.length === 14 && limpo.startsWith('000')) {
        out.add(limpo.slice(3)); // CPF sem pad
    }
    if (limpo.length === 11) {
        out.add('000' + limpo); // CPF com pad
    }
    return [...out];
}
/**
 * True se dois documentos referem o mesmo CNPJ/CPF (ignora formatação e pad).
 */
function documentosEquivalentes(a, b) {
    const va = limparDocumento(a);
    const vb = limparDocumento(b);
    if (!va || !vb)
        return false;
    if (va === vb)
        return true;
    const last11 = (s) => (s.length >= 11 ? s.slice(-11) : s);
    if (va.length >= 11 && vb.length >= 11 && last11(va) === last11(vb)) {
        // Ambos CPF (com ou sem pad 000)
        if ((va.length === 11 || va.startsWith('000')) &&
            (vb.length === 11 || vb.startsWith('000'))) {
            return true;
        }
    }
    return false;
}
//# sourceMappingURL=documento-certificado.js.map