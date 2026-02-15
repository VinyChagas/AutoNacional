/**
 * Exemplo: upload de certificado para Storage Supabase.
 */
export declare function uploadCertificadoToStorage(cnpj: string, buffer: Buffer): Promise<{
    path: string;
} | {
    error: string;
}>;
/**
 * Exemplo: obter URL pública (se bucket for público) ou signed.
 */
export declare function getCertificadoUrl(cnpj: string, expiresIn?: number): Promise<string | null>;
/**
 * Exemplo: inserir na tabela via Supabase (alternativa ao Prisma).
 */
export declare function insertCertificadoViaSupabase(payload: {
    cnpj: string;
    arquivo: string;
    data_validade?: string;
    empresa_id?: number;
    contabilidade_id?: number;
}): Promise<any>;
//# sourceMappingURL=supabase-example.d.ts.map