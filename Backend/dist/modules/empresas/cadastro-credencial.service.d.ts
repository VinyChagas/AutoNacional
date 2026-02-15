export type TipoCredencial = 'CNPJ_SENHA' | 'CPF_SENHA';
export interface CadastroCredencialInput {
    cnpj: string;
    razao_social?: string;
    senha: string;
    tipo?: TipoCredencial;
    usuario?: string;
    contabilidade_id?: number | null;
}
export interface CadastroCredencialResult {
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
export declare function cadastrarPorCredencial(input: CadastroCredencialInput): Promise<CadastroCredencialResult>;
//# sourceMappingURL=cadastro-credencial.service.d.ts.map