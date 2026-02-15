export interface LinhaCredencial {
    razao_social: string;
    tipo_login: 'CNPJ' | 'CPF';
    cnpj_ou_cpf: string;
    senha: string;
    regime?: string;
    linha: number;
    indice: number;
}
/**
 * Parse de buffer (xlsx ou csv) para linhas de credencial.
 * Linha 1 = opcional, Linha 2 = cabeçalhos obrigatórios, Linha 3+ = dados.
 */
export declare function parsePlanilhaCredenciais(buffer: Buffer): LinhaCredencial[];
//# sourceMappingURL=planilha.parser.d.ts.map