export interface StorageCleanupResult {
    attempted: string[];
    removed: string[];
    failed: Array<{
        path: string;
        error: string;
    }>;
}
/**
 * Remove paths do bucket de certificados.
 * Não lança: falhas vão em `failed` para o caller decidir.
 */
export declare function removerArquivosCertificado(paths: Array<string | null | undefined>): Promise<StorageCleanupResult>;
//# sourceMappingURL=certificado-storage.service.d.ts.map