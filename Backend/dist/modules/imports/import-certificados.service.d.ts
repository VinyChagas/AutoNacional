export type AcaoCert = 'IMPORTAR' | 'ERRO' | 'DUPLICADO';
export interface PreviewItemCert {
    indice: number;
    cnpj: string;
    razao_social: string;
    data_validade: string | null;
    existe_empresa: boolean;
    existe_certificado: boolean;
    acao: AcaoCert;
    erro?: string;
}
export interface PreviewCertificadosResult {
    session_id: string;
    items: PreviewItemCert[];
}
export declare function previewCertificados(files: Express.Multer.File[], senha: string): Promise<PreviewCertificadosResult>;
export interface ConfirmarItemCert {
    indice: number;
}
export interface ConfirmarCertificadosInput {
    session_id: string;
    senha: string;
    itens: ConfirmarItemCert[];
    contabilidade_id?: number | null;
}
export interface ConfirmarCertificadosResult {
    importados: number;
    erros: {
        indice: number;
        mensagem: string;
    }[];
}
export declare function confirmarCertificados(input: ConfirmarCertificadosInput): Promise<ConfirmarCertificadosResult>;
//# sourceMappingURL=import-certificados.service.d.ts.map