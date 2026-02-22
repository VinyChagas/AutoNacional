export type AcaoPreview = 'CRIAR_EMPRESA' | 'CRIAR_CREDENCIAL' | 'ATUALIZAR_CREDENCIAL' | 'ERRO';
export interface PreviewRowCred {
    rowIndex: number;
    linha: number;
    razao_social: string;
    tipo_login: 'CNPJ' | 'CPF';
    documento_raw: string;
    documento_digits: string;
    documento_formatado: string;
    regime: string | null;
    senha_masked: true;
    exists: boolean;
    valid: boolean;
    errors: string[];
    duplicado_na_planilha?: boolean;
}
export interface PreviewItemCred {
    linha: number;
    razao_social: string;
    documento: string;
    tipo: string;
    existe_empresa: boolean;
    existe_credencial: boolean;
    acao: AcaoPreview;
    erro?: string;
}
export interface PreviewCredenciaisResult {
    session_id: string;
    total: number;
    validos: number;
    erros: number;
    items: PreviewItemCred[];
    rows: PreviewRowCred[];
}
export declare function previewCredenciais(buffer: Buffer): Promise<PreviewCredenciaisResult>;
export interface CommitRowInput {
    rowIndex: number;
    contabilidade_id?: number;
}
export interface ConfirmarCredenciaisInput {
    session_id: string;
    linhas_aprovadas?: number[];
    contabilidade_id_default: number;
    updateExisting: boolean;
    rows?: CommitRowInput[];
}
export interface CommitResultItem {
    rowIndex: number;
    status: 'IMPORTED' | 'UPDATED' | 'SKIPPED_EXISTS' | 'ERROR';
    message?: string;
}
export interface ConfirmarCredenciaisResult {
    success: true;
    criadas: number;
    atualizadas: number;
    erros: number;
    skipped: number;
    results: CommitResultItem[];
}
export declare function confirmarCredenciais(input: ConfirmarCredenciaisInput): Promise<ConfirmarCredenciaisResult>;
//# sourceMappingURL=import-credenciais.service.d.ts.map