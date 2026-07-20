/**
 * Segmentos operacionais dos cards de resumo da tela de Empresas.
 * Fonte única para parse, validação e matching — alinhado ao summary.
 */
export declare const EMPRESA_SEGMENTS: readonly ["ALL", "CERT_EXPIRED", "CREDENTIAL_REVALIDATION_REQUIRED", "OPERATIONAL", "NOT_ELIGIBLE"];
export type EmpresaSegment = (typeof EMPRESA_SEGMENTS)[number];
export interface EmpresaSegmentInput {
    has_certificado: boolean;
    cert_validade: string | null;
    has_credenciais: boolean;
    cred_status: string | null;
    cred_ultimo_teste_em: Date | string | null;
    status_geral: 'OPERACIONAL' | 'PARCIAL' | 'INOPERANTE';
}
export declare function isEmpresaSegment(value: string): value is EmpresaSegment;
export declare function parseEmpresaSegment(raw: string | undefined): EmpresaSegment;
export declare function isCertValido(hasCert: boolean, certValidade: string | null): boolean;
/**
 * Mesma regra do KPI "Credenciais para Validar" em obterSummary.
 */
export declare function needsCredentialRevalidation(input: {
    has_credenciais: boolean;
    cred_status: string | null;
    cred_ultimo_teste_em: Date | string | null;
}): boolean;
/**
 * Segmento ativo dos cards. Deve produzir o mesmo universo contado no summary.
 */
export declare function matchesEmpresaSegment(item: EmpresaSegmentInput, segment: EmpresaSegment): boolean;
//# sourceMappingURL=empresas-segment.d.ts.map