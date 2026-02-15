export interface CertificadoParseResult {
    cnpj: string;
    cnpj_formatado: string;
    razao_social: string;
    data_validade: string | null;
    serial: string | null;
    thumbprint: string | null;
}
/**
 * Extrai informações completas do certificado PFX/P12.
 * @throws Error se senha incorreta ou certificado inválido
 */
export declare function parseCertificado(conteudoPfx: Buffer, senha: string): CertificadoParseResult;
//# sourceMappingURL=certificado.parser.d.ts.map