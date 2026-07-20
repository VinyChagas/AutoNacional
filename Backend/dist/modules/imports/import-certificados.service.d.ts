import { type ConfirmCertAction, type PreviewCertAction } from './import-certificados-classify';
export interface PreviewItemCert {
    indice: number;
    cnpj: string;
    razao_social: string;
    data_validade: string | null;
    existe_empresa: boolean;
    existe_certificado: boolean;
    /** Classificação nova (preferir). */
    action: PreviewCertAction;
    can_confirm: boolean;
    default_confirm_action: ConfirmCertAction;
    message: string;
    days_delta: number | null;
    existing_cert_id: number | null;
    existing_valid_until: string | null;
    thumbprint: string | null;
    serial: string | null;
    /** Legado — compatibilidade com FE antigo. */
    acao: 'IMPORTAR' | 'ERRO' | 'DUPLICADO' | 'UPDATE_AVAILABLE' | 'OLDER_CERTIFICATE' | 'EXPIRED_CERTIFICATE';
    erro?: string;
}
export interface PreviewCertificadosResult {
    session_id: string;
    items: PreviewItemCert[];
}
export declare function previewCertificados(files: Express.Multer.File[], senha: string): Promise<PreviewCertificadosResult>;
export interface ConfirmarItemCert {
    indice: number;
    /** Ação explícita: CREATE | REPLACE_EXISTING | SKIP. Obrigatória. */
    action: ConfirmCertAction;
}
export interface ConfirmarCertificadosInput {
    session_id: string;
    senha: string;
    itens: ConfirmarItemCert[];
    contabilidade_id?: number | null;
}
export interface ConfirmarCertificadosResult {
    importados: number;
    atualizados: number;
    ignorados: number;
    erros: {
        indice: number;
        mensagem: string;
    }[];
}
export declare function confirmarCertificados(input: ConfirmarCertificadosInput): Promise<ConfirmarCertificadosResult>;
/** Expõe parse de ação para o controller (com fallback legado). */
export declare function resolveConfirmAction(raw: unknown, hasExplicitAction: boolean): ConfirmCertAction;
//# sourceMappingURL=import-certificados.service.d.ts.map