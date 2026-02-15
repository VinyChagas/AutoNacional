export interface CadastroCertificadoInput {
    buffer: Buffer;
    senha: string;
    contabilidade_id?: number | null;
}
export interface CadastroCertificadoResult {
    empresa: {
        id: number;
        cnpj: string;
        razao_social: string;
        regime: string | null;
        contabilidade_id: number | null;
    };
    has_cert: boolean;
    has_cred: boolean;
    cert_validade: string | null;
    cred_status: string | null;
}
export declare function cadastrarPorCertificado(input: CadastroCertificadoInput): Promise<CadastroCertificadoResult>;
//# sourceMappingURL=cadastro-certificado.service.d.ts.map