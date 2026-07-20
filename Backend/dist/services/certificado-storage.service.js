"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.removerArquivosCertificado = removerArquivosCertificado;
/**
 * Limpeza de arquivos de certificado no Supabase Storage.
 */
const supabase_1 = require("../config/supabase");
const env_1 = require("../config/env");
const logger_1 = require("../infrastructure/logger");
const logger = (0, logger_1.getLogger)('certificado-storage');
/**
 * Remove paths do bucket de certificados.
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
        return { attempted, removed, failed };
    }
    try {
        const supabase = (0, supabase_1.getSupabaseClient)();
        const bucket = env_1.env.CERT_STORAGE_BUCKET || 'certificados';
        const { data, error } = await supabase.storage.from(bucket).remove(attempted);
        if (error) {
            logger.error({
                err: error,
                pathsCount: attempted.length,
                bucket,
            }, 'Falha ao remover arquivos de certificado do Storage');
            for (const path of attempted) {
                failed.push({ path, error: error.message });
            }
            return { attempted, removed, failed };
        }
        const removedSet = new Set((data ?? []).map((d) => d.name || d).filter(Boolean));
        // API do storage às vezes não devolve lista completa; se não há error, consideramos ok
        if (removedSet.size === 0) {
            removed.push(...attempted);
        }
        else {
            for (const path of attempted) {
                const base = path.split('/').pop() ?? path;
                if (removedSet.has(path) ||
                    [...removedSet].some((n) => String(n) === path || String(n).endsWith(base))) {
                    removed.push(path);
                }
                else {
                    // Sem erro global: assume removido
                    removed.push(path);
                }
            }
        }
        logger.info({ removedCount: removed.length, pathsMasked: attempted.map(maskPath) }, 'Arquivos de certificado removidos do Storage');
    }
    catch (err) {
        const msg = err.message;
        logger.error({ err, pathsCount: attempted.length }, 'Exceção ao limpar Storage');
        for (const path of attempted) {
            failed.push({ path, error: msg });
        }
    }
    return { attempted, removed, failed };
}
function maskPath(path) {
    if (path.length <= 12)
        return '***';
    return `${path.slice(0, 8)}...${path.slice(-8)}`;
}
//# sourceMappingURL=certificado-storage.service.js.map