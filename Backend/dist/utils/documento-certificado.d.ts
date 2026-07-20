/**
 * Utilitários de matching de CNPJ/CPF para certificados.
 * Evita falso negativo/positivo por formatação ou padding de CPF.
 */
export declare function limparDocumento(valor: string): string;
/**
 * Variantes possíveis de um documento no banco (limpo, CPF sem pad, CPF com pad).
 */
export declare function variantesDocumento(cnpjOuCpf: string): string[];
/**
 * True se dois documentos referem o mesmo CNPJ/CPF (ignora formatação e pad).
 */
export declare function documentosEquivalentes(a: string, b: string): boolean;
//# sourceMappingURL=documento-certificado.d.ts.map