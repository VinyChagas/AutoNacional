/**
 * Classificação de itens do preview de importação de certificados.
 * Funções puras — testáveis sem banco/Storage.
 */
export type PreviewCertAction = 'NEW' | 'UPDATE_AVAILABLE' | 'EXACT_DUPLICATE' | 'OLDER_CERTIFICATE' | 'EXPIRED_CERTIFICATE' | 'INVALID_FILE' | 'DOCUMENT_MISMATCH' | 'ERROR';
export type ConfirmCertAction = 'CREATE' | 'REPLACE_EXISTING' | 'SKIP';
export interface CertIdentity {
    valid_until: string | null;
    thumbprint: string | null;
    serial: string | null;
}
export declare function parseDataValidade(val: string | null | undefined): Date | null;
export declare function isCertificadoVencido(validUntil: string | null, now?: Date): boolean;
/** Diferença em dias: incoming - existing (positivo = incoming vence depois). */
export declare function diffDiasValidade(incomingValidUntil: string | null, existingValidUntil: string | null): number | null;
export declare function isExactDuplicate(incoming: CertIdentity, existing: CertIdentity): boolean;
export interface ClassifyInput {
    incoming: CertIdentity;
    existing: CertIdentity | null;
    documentMismatch?: boolean;
    now?: Date;
}
export interface ClassifyResult {
    action: PreviewCertAction;
    can_confirm: boolean;
    message: string;
    days_delta: number | null;
}
/**
 * Classifica o certificado enviado em relação ao existente (se houver).
 */
export declare function classifyIncomingCertificate(input: ClassifyInput): ClassifyResult;
/** Mapeia ação de preview para ação de confirmação padrão. */
export declare function defaultConfirmAction(previewAction: PreviewCertAction): ConfirmCertAction;
/** Ações legadas mantidas no campo `acao` para compatibilidade. */
export declare function toLegacyAcao(action: PreviewCertAction): 'IMPORTAR' | 'ERRO' | 'DUPLICADO' | 'UPDATE_AVAILABLE' | 'OLDER_CERTIFICATE' | 'EXPIRED_CERTIFICATE';
//# sourceMappingURL=import-certificados-classify.d.ts.map