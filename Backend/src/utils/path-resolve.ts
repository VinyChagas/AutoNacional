/**
 * Resolve paths de armazenamento.
 * Pastas comuns do usuário (Desktop, Documents, Downloads) quando sozinhas
 * são resolvidas para o diretório home, evitando Backend/Desktop.
 */
import * as path from 'path';
import * as os from 'os';

const HOME_SUBFOLDERS = new Set([
  'desktop', 'documentos', 'documents', 'downloads',
  'imagens', 'pictures', 'images', 'videos', 'musicas', 'music',
  'áreadetrabalho', // Área de Trabalho (pt-BR, sem espaços)
]);

export function resolveStoragePath(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  if (path.isAbsolute(trimmed)) return trimmed;
  const single = trimmed.replace(/[/\\]/g, '').replace(/\s/g, '').toLowerCase();
  if (HOME_SUBFOLDERS.has(single)) {
    return path.join(os.homedir(), trimmed.split(/[/\\]/)[0]);
  }
  return path.resolve(trimmed);
}
