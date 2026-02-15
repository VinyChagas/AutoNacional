export interface CertificadoInfo {
    empresa: string | null;
    cnpj: string | null;
    cnpj_limpo: string | null;
    dataVencimento: string | null;
}
/**
 * Extrai CNPJ, nome da empresa e data de vencimento de um certificado PFX.
 */
export declare function extrairInformacoesCertificado(conteudoPfx: Buffer, senha: string): CertificadoInfo;
//# sourceMappingURL=certificado-utils.d.ts.map