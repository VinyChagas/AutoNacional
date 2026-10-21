/**
 * Escrita atômica em filesystem (tmp + rename).
 * Usado por checkpoint, índice e XML ADN.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ErroAdn } from './errors';

export function escreverArquivoAtomico(
  filePath: string,
  content: string | Buffer,
  mode = 0o600
): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
  );
  try {
    fs.writeFileSync(tmp, content, { mode });
    fs.renameSync(tmp, filePath);
  } catch (erro) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw erro;
  }
}

/**
 * Escreve somente se o destino ainda não existir.
 * Sob lock de CNPJ, evita sobrescrita acidental.
 */
export function escreverArquivoAtomicoNovo(
  filePath: string,
  content: string | Buffer,
  mode = 0o600
): void {
  if (fs.existsSync(filePath)) {
    throw new ErroAdn(
      'ARQUIVO_JA_EXISTE',
      'PERMANENTE',
      `Destino ADN já existe e não pode ser sobrescrito: ${path.basename(filePath)}`
    );
  }
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
  );
  try {
    fs.writeFileSync(tmp, content, { mode });
    // Revalida antes do rename (proteção extra sob lock).
    if (fs.existsSync(filePath)) {
      throw new ErroAdn(
        'ARQUIVO_JA_EXISTE',
        'PERMANENTE',
        `Destino ADN surgiu antes do rename: ${path.basename(filePath)}`
      );
    }
    fs.renameSync(tmp, filePath);
  } catch (erro) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw erro;
  }
}
