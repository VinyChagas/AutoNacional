/**
 * Limpeza de arquivos de certificado no filesystem local.
 */
import {
  getCertificateStorage,
  maskRelativePath,
  UnsafeCertificatePathError,
} from '../storage';
import { getLogger } from '../infrastructure/logger';

const logger = getLogger('certificado-storage');

export interface StorageCleanupResult {
  attempted: string[];
  removed: string[];
  failed: Array<{ path: string; error: string }>;
}

/**
 * Remove paths relativos do armazenamento local de certificados.
 * Não lança: falhas vão em `failed` para o caller decidir.
 */
export async function removerArquivosCertificado(
  paths: Array<string | null | undefined>
): Promise<StorageCleanupResult> {
  const attempted = [
    ...new Set(
      paths
        .map((p) => (typeof p === 'string' ? p.trim() : ''))
        .filter((p) => p.length > 0)
    ),
  ];
  const removed: string[] = [];
  const failed: Array<{ path: string; error: string }> = [];

  if (attempted.length === 0) {
    return { attempted, removed, failed: [] };
  }

  const storage = getCertificateStorage();

  for (const relativePath of attempted) {
    try {
      await storage.delete(relativePath);
      removed.push(relativePath);
    } catch (err) {
      const msg =
        err instanceof UnsafeCertificatePathError
          ? err.message
          : 'Falha ao excluir certificado';
      logger.error(
        { pathsCount: 1, pathMasked: maskRelativePath(relativePath) },
        'Falha ao remover arquivo de certificado do storage local'
      );
      failed.push({ path: relativePath, error: msg });
    }
  }

  if (removed.length > 0) {
    logger.info(
      { removedCount: removed.length, pathsMasked: attempted.map(maskRelativePath) },
      'Arquivos de certificado removidos do storage local'
    );
  }

  return { attempted, removed, failed };
}
