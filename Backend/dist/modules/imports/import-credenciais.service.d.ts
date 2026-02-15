export type AcaoPreview = 'CRIAR_EMPRESA' | 'CRIAR_CREDENCIAL' | 'ATUALIZAR_CREDENCIAL' | 'ERRO';
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
}
export declare function previewCredenciais(buffer: Buffer): Promise<PreviewCredenciaisResult>;
export interface ConfirmarCredenciaisInput {
    session_id: string;
    linhas_aprovadas: number[];
}
export interface ConfirmarCredenciaisResult {
    success: true;
    criadas: number;
    atualizadas: number;
    erros: number;
}
export declare function confirmarCredenciais(input: ConfirmarCredenciaisInput): Promise<ConfirmarCredenciaisResult>;
//# sourceMappingURL=import-credenciais.service.d.ts.map