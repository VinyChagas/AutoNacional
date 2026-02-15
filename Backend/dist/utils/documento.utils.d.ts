/**
 * Utilitários para normalização e validação de documentos (CNPJ/CPF).
 */
/**
 * Remove máscara de documento (pontos, traços, barras, espaços).
 */
export declare function normalizarDocumento(valor: string): string;
/**
 * Valida se string contém apenas 14 dígitos (CNPJ).
 */
export declare function validarCNPJ(valor: string): boolean;
/**
 * Valida se string contém apenas 11 dígitos (CPF).
 */
export declare function validarCPF(valor: string): boolean;
/**
 * Retorna CNPJ para armazenamento em empresas.
 * CPF (11 dígitos) é convertido para "000" + CPF = 14 dígitos.
 */
export declare function cnpjParaEmpresa(documento: string, tipo: 'CNPJ' | 'CPF'): string;
//# sourceMappingURL=documento.utils.d.ts.map