/**
 * EmpresaStatusService — fonte única de verdade para status operacional.
 * Usado por listagem, summary, segmentos, execução e (futuro) exportação.
 */
export declare const DIAS_EXPIRING_SOON = 30;
export declare const DIAS_REVALIDAR_CRED = 7;
export type CertificateStatus = 'MISSING' | 'EXPIRED' | 'EXPIRING_SOON' | 'VALID' | 'ERROR';
export type CredentialStatus = 'MISSING' | 'NOT_TESTED' | 'VALID' | 'INVALID' | 'VALIDATION_ERROR' | 'INACTIVE' | 'TESTING';
export type AutomationEligibility = 'ELIGIBLE' | 'ELIGIBLE_WITH_WARNING' | 'NOT_ELIGIBLE';
/** Status de exibição legado (pills / execução). Derivado da elegibilidade. */
export type StatusGeralDisplay = 'OPERACIONAL' | 'ATENCAO' | 'PARCIAL' | 'INOPERANTE';
export type CredentialRevalidationReason = 'NOT_TESTED' | 'STALE_TEST' | 'INVALID_PASSWORD' | 'VALIDATION_ERROR' | 'INACTIVE' | null;
export type LoginMetodo = 'CERTIFICADO' | 'CREDENCIAL' | null;
export interface EmpresaStatusInput {
    has_certificado: boolean;
    cert_validade: string | null;
    has_credenciais: boolean;
    cred_status: string | null;
    cred_ultimo_teste_em: Date | string | null;
    cred_ultima_mensagem?: string | null;
    /** Data de referência (testes). Default: agora. */
    now?: Date;
}
export interface EmpresaOperationalSnapshot {
    certificate_status: CertificateStatus;
    credential_status: CredentialStatus;
    credential_requires_revalidation: boolean;
    credential_revalidation_reason: CredentialRevalidationReason;
    automation_eligibility: AutomationEligibility;
    issue_codes: string[];
    issue_messages: string[];
    recommended_action: string | null;
    certificate_days_delta: number | null;
    /** Compatibilidade com UI / execução. */
    status_geral: StatusGeralDisplay;
    status_geral_motivo: string;
    login_metodo: LoginMetodo;
}
export declare function computeCertificateStatus(hasCert: boolean, certValidade: string | null, now?: Date): {
    status: CertificateStatus;
    daysDelta: number | null;
};
export declare function normalizeCredentialStatus(hasCred: boolean, credStatus: string | null): CredentialStatus;
export declare function computeCredentialRevalidation(credentialStatus: CredentialStatus, ultimoTeste: Date | string | null, now?: Date): {
    requires: boolean;
    reason: CredentialRevalidationReason;
};
/**
 * Calcula o snapshot operacional completo (regra única).
 */
export declare function computeOperationalSnapshot(input: EmpresaStatusInput): EmpresaOperationalSnapshot;
/** Compat: certificado ainda não vencido (VALID ou EXPIRING_SOON). */
export declare function isCertValido(hasCert: boolean, certValidade: string | null): boolean;
export declare function needsCredentialRevalidation(input: {
    has_credenciais: boolean;
    cred_status: string | null;
    cred_ultimo_teste_em: Date | string | null;
    now?: Date;
}): boolean;
export declare function isAutomationEligible(eligibility: AutomationEligibility): boolean;
//# sourceMappingURL=empresa-status.d.ts.map