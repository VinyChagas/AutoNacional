"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.removerArquivosCertificado = removerArquivosCertificado;
/**
 * Limpeza de arquivos de certificado no filesystem local.
 */
const storage_1 = require("../storage");
const logger_1 = require("../infrastructure/logger");
const logger = (0, logger_1.getLogger)('certificado-storage');
/**
 * Remove paths relativos do armazenamento local de certificados.
 * Não lança: falhas vão em `failed` para o caller decidir.
 */
async function removerArquivosCertificado(paths) {
    const attempted = [
        ...new Set(paths
            .map((p) => (typeof p === 'string' ? p.trim() : ''))
            .filter((p) => p.length > 0)),
    ];
    const removed = [];
    const failed = [];
    if (attempted.length === 0) {
        return { attempted, removed, failed: [] };
    }
    const storage = (0, storage_1.getCertificateStorage)();
    for (const relativePath of attempted) {
        try {
            await storage.delete(relativePath);
            removed.push(relativePath);
        }
        catch (err) {
            const msg = err instanceof storage_1.UnsafeCertificatePathError
                ? err.message
                : 'Falha ao excluir certificado';
            logger.error({ pathsCount: 1, pathMasked: (0, storage_1.maskRelativePath)(relativePath) }, 'Falha ao remover arquivo de certificado do storage local');
            failed.push({ path: relativePath, error: msg });
        }
    }
    if (removed.length > 0) {
        logger.info({ removedCount: removed.length, pathsMasked: attempted.map(storage_1.maskRelativePath) }, 'Arquivos de certificado removidos do storage local');
    }
    return { attempted, removed, failed };
}
//# sourceMappingURL=certificado-storage.service.js.map