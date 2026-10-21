/**
 * Store de tickets de homologação — permissões restritivas (POSIX).
 *
 * Existência do diretório NÃO autoriza Discovery-Only.
 * Somente monta/valida o filesystem do canal.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { HomologacaoNfseError } from './types';

/** Env privilegiada de processo (não settings de usuário). Só path do store. */
export const ENV_HOMOLOGACAO_STORE = 'AUTONACIONAL_HOMOLOGACAO_STORE';

const MODE_DIR = 0o700;
const MODE_FILE = 0o600;

export function lerCaminhoStorePrivilegiado(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const bruto = env[ENV_HOMOLOGACAO_STORE]?.trim() ?? '';
  if (!bruto) return null;
  return bruto;
}

/**
 * Prepara e valida o store: absoluto, sem symlink, 0700 no diretório.
 * Recusa operações se condições mínimas não forem atendidas.
 */
export async function prepararStoreHomologacaoSeguro(
  caminhoBruto: string
): Promise<string> {
  const bruto = caminhoBruto?.trim() ?? '';
  if (!bruto) {
    throw new HomologacaoNfseError('DIRETORIO_INSEGURO', 'Caminho do store ausente.');
  }
  if (bruto.includes('\0')) {
    throw new HomologacaoNfseError('DIRETORIO_INSEGURO', 'Store contém byte nulo.');
  }
  if (bruto.replace(/\\/g, '/').split('/').some((s) => s === '..')) {
    throw new HomologacaoNfseError('DIRETORIO_INSEGURO', 'Path traversal no store.');
  }

  if (!path.isAbsolute(bruto)) {
    throw new HomologacaoNfseError(
      'DIRETORIO_INSEGURO',
      'Store deve ser caminho absoluto (não relativo).'
    );
  }
  const absoluto = path.resolve(bruto);

  await fs.mkdir(absoluto, { recursive: true, mode: MODE_DIR });

  const lst = await fs.lstat(absoluto);
  if (lst.isSymbolicLink()) {
    throw new HomologacaoNfseError(
      'DIRETORIO_INSEGURO',
      'Store de homologação não pode ser symlink.'
    );
  }
  if (!lst.isDirectory()) {
    throw new HomologacaoNfseError('DIRETORIO_INSEGURO', 'Store deve ser um diretório.');
  }

  await fs.chmod(absoluto, MODE_DIR);
  const apos = await fs.stat(absoluto);
  const mode = apos.mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new HomologacaoNfseError(
      'DIRETORIO_INSEGURO',
      `Permissões do store inadequadas (esperado 0700, obtido ${mode.toString(8)}).`
    );
  }

  return await fs.realpath(absoluto);
}

/** Escreve arquivo com modo 0600 e verifica permissões efetivas. */
export async function escreverArquivoStoreSeguro(
  arquivo: string,
  conteudo: string,
  flag: 'wx' | 'w' = 'w'
): Promise<void> {
  await fs.writeFile(arquivo, conteudo, { encoding: 'utf8', flag, mode: MODE_FILE });
  await fs.chmod(arquivo, MODE_FILE);
  const st = await fs.stat(arquivo);
  if ((st.mode & 0o077) !== 0) {
    throw new HomologacaoNfseError(
      'DIRETORIO_INSEGURO',
      `Permissões de arquivo inadequadas: ${path.basename(arquivo)}`
    );
  }
}

export function modoArquivoEsperado(): number {
  return MODE_FILE;
}

export function modoDiretorioEsperado(): number {
  return MODE_DIR;
}
