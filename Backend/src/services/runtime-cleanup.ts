/**
 * Limpeza de arquivos temporários e de log.
 * Downloads de XML/PDF não entram aqui: são persistentes.
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import { getLogger } from '../infrastructure/logger';
import { resolveStoragePath } from '../utils/path-resolve';

const logger = getLogger('runtime-cleanup');

async function listarArquivos(dir: string): Promise<string[]> {
  const encontrados: string[] = [];
  let entradas;
  try {
    entradas = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return encontrados;
  }
  for (const entrada of entradas) {
    const completo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) {
      encontrados.push(...(await listarArquivos(completo)));
    } else if (entrada.isFile()) {
      encontrados.push(completo);
    }
  }
  return encontrados;
}

export async function garantirDiretorio(dir: string): Promise<void> {
  const resolvido = resolveStoragePath(dir);
  if (!resolvido) return;
  await fs.mkdir(resolvido, { recursive: true });
}

/**
 * Remove arquivos mais antigos que maxAgeDays. Diretórios vazios são ignorados.
 */
export async function limparDiretorioPorIdade(
  dir: string,
  maxAgeDays: number
): Promise<number> {
  if (!dir || maxAgeDays < 1) return 0;
  const resolvido = resolveStoragePath(dir);
  const limite = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const arquivos = await listarArquivos(resolvido);
  let removidos = 0;

  for (const arquivo of arquivos) {
    try {
      const stat = await fs.stat(arquivo);
      if (stat.mtimeMs < limite) {
        await fs.unlink(arquivo);
        removidos += 1;
      }
    } catch (err) {
      logger.warn({ err, arquivo }, 'Não foi possível remover arquivo antigo');
    }
  }

  if (removidos > 0) {
    logger.info({ dir: resolvido, removidos, maxAgeDays }, 'Arquivos antigos removidos');
  }
  return removidos;
}
