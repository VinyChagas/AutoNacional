/**
 * Diretório/socket/segredo do canal admin — permissões POSIX restritivas.
 *
 * Remoção de socket órfão: apenas ECONNREFUSED + mesmo uid.
 * Timeout / erro incerto → falha conservadora (não remove).
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { HomologacaoNfseError } from '../types';
import { ADMIN_SOCKET_FILENAME } from './admin-config';

const MODE_DIR = 0o700;
const MODE_SOCK = 0o600;

/** Entropia mínima do segredo (caracteres). */
export const ADMIN_SECRET_MIN_LENGTH = 32;

export async function prepararDiretorioAdminSocket(dirBruto: string): Promise<string> {
  const bruto = dirBruto?.trim() ?? '';
  if (!bruto) {
    throw new HomologacaoNfseError('DIRETORIO_INSEGURO', 'Diretório do socket admin ausente.');
  }
  if (bruto.includes('\0') || bruto.replace(/\\/g, '/').split('/').some((s) => s === '..')) {
    throw new HomologacaoNfseError('DIRETORIO_INSEGURO', 'Diretório do socket admin inseguro.');
  }
  if (!path.isAbsolute(bruto)) {
    throw new HomologacaoNfseError(
      'DIRETORIO_INSEGURO',
      'Diretório do socket admin deve ser absoluto.'
    );
  }

  const absoluto = path.resolve(bruto);
  await fs.mkdir(absoluto, { recursive: true, mode: MODE_DIR });

  const lst = await fs.lstat(absoluto);
  if (lst.isSymbolicLink()) {
    throw new HomologacaoNfseError(
      'DIRETORIO_INSEGURO',
      'Diretório do socket admin não pode ser symlink.'
    );
  }
  if (!lst.isDirectory()) {
    throw new HomologacaoNfseError('DIRETORIO_INSEGURO', 'Caminho do socket admin não é diretório.');
  }

  await fs.chmod(absoluto, MODE_DIR);
  const apos = await fs.stat(absoluto);
  if ((apos.mode & 0o077) !== 0) {
    throw new HomologacaoNfseError(
      'DIRETORIO_INSEGURO',
      `Permissões do diretório admin inadequadas (esperado 0700).`
    );
  }

  if (typeof process.getuid === 'function' && apos.uid !== process.getuid()) {
    throw new HomologacaoNfseError(
      'DIRETORIO_INSEGURO',
      'Diretório admin não pertence ao usuário do processo Backend.'
    );
  }

  return await fs.realpath(absoluto);
}

export function caminhoSocketAdmin(dirSeguro: string): string {
  return path.join(dirSeguro, ADMIN_SOCKET_FILENAME);
}

/**
 * Remove socket preexistente somente se órfão comprovado (ECONNREFUSED)
 * e mesmo uid. Socket vivo ou estado incerto → recusa (não remove).
 */
export async function removerSocketOrfaoSeguro(socketPath: string): Promise<void> {
  let lst;
  try {
    lst = await fs.lstat(socketPath);
  } catch {
    return;
  }
  if (lst.isSymbolicLink()) {
    throw new HomologacaoNfseError(
      'DIRETORIO_INSEGURO',
      'Socket admin não pode ser symlink; remoção recusada.'
    );
  }
  if (typeof process.getuid === 'function' && lst.uid !== process.getuid()) {
    throw new HomologacaoNfseError(
      'DIRETORIO_INSEGURO',
      'Socket preexistente pertence a outro usuário; remoção recusada.'
    );
  }

  const estado = await classificarSocketExistente(socketPath);
  if (estado === 'vivo') {
    throw new HomologacaoNfseError(
      'CONTEXTO_INVALIDO',
      'Socket admin já em uso por outro processo; bind recusado.'
    );
  }
  if (estado === 'incerto') {
    throw new HomologacaoNfseError(
      'CONTEXTO_INVALIDO',
      'Socket preexistente em estado incerto; remoção conservadora recusada.'
    );
  }

  // estado === 'orfao'
  await fs.unlink(socketPath);
}

export type EstadoSocketExistente = 'vivo' | 'orfao' | 'incerto';

export async function classificarSocketExistente(
  socketPath: string
): Promise<EstadoSocketExistente> {
  const net = await import('node:net');
  return new Promise((resolve) => {
    const socket = net.createConnection(socketPath);
    const timer = setTimeout(() => {
      socket.destroy();
      // Timeout ≠ prova de órfão (servidor lento / PID reutilizado ambíguo).
      resolve('incerto');
    }, 400);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.end();
      resolve('vivo');
    });
    socket.once('error', (erro: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (erro.code === 'ECONNREFUSED') {
        resolve('orfao');
        return;
      }
      resolve('incerto');
    });
  });
}

export async function aplicarPermissoesSocket(socketPath: string): Promise<void> {
  await fs.chmod(socketPath, MODE_SOCK);
  const st = await fs.stat(socketPath);
  if ((st.mode & 0o077) !== 0) {
    throw new HomologacaoNfseError(
      'DIRETORIO_INSEGURO',
      'Permissões do socket admin inadequadas (esperado 0600).'
    );
  }
}

/**
 * Carrega segredo admin.
 * Produção: somente arquivo 0600 (nunca inline/env solto).
 * Teste/dev: inline permitido se ≥ ADMIN_SECRET_MIN_LENGTH.
 * Independente de INTERNAL_API_KEY.
 */
export async function carregarSegredoAdmin(entrada: {
  secretFile: string | null;
  secretInline: string | null;
  nodeEnv?: string;
}): Promise<string> {
  const nodeEnv = entrada.nodeEnv ?? process.env.NODE_ENV ?? 'development';
  const producao = nodeEnv === 'production';

  if (entrada.secretFile) {
    return lerSegredoArquivo(entrada.secretFile);
  }

  if (producao) {
    throw new HomologacaoNfseError(
      'CONTEXTO_INVALIDO',
      'Em produção o segredo admin deve vir de AUTONACIONAL_HOMOLOGACAO_ADMIN_SECRET_FILE (0600).'
    );
  }

  if (entrada.secretInline && entrada.secretInline.length >= ADMIN_SECRET_MIN_LENGTH) {
    return entrada.secretInline;
  }

  throw new HomologacaoNfseError(
    'CONTEXTO_INVALIDO',
    `Segredo admin ausente ou fraco (mín. ${ADMIN_SECRET_MIN_LENGTH} chars). Use SECRET_FILE 0600.`
  );
}

async function lerSegredoArquivo(caminhoBruto: string): Promise<string> {
  if (!path.isAbsolute(caminhoBruto)) {
    throw new HomologacaoNfseError('DIRETORIO_INSEGURO', 'Arquivo de segredo admin deve ser absoluto.');
  }
  let lst;
  try {
    lst = await fs.lstat(caminhoBruto);
  } catch {
    throw new HomologacaoNfseError(
      'CONTEXTO_INVALIDO',
      'Falha ao ler arquivo de segredo admin (ausente ou inacessível).'
    );
  }
  if (lst.isSymbolicLink()) {
    throw new HomologacaoNfseError('DIRETORIO_INSEGURO', 'Arquivo de segredo não pode ser symlink.');
  }
  if (!lst.isFile()) {
    throw new HomologacaoNfseError('DIRETORIO_INSEGURO', 'Segredo admin deve ser arquivo regular.');
  }
  if ((lst.mode & 0o077) !== 0) {
    throw new HomologacaoNfseError(
      'DIRETORIO_INSEGURO',
      'Arquivo de segredo admin deve ser 0600 (sem acesso group/other).'
    );
  }
  if (typeof process.getuid === 'function' && lst.uid !== process.getuid()) {
    throw new HomologacaoNfseError(
      'DIRETORIO_INSEGURO',
      'Arquivo de segredo não pertence ao usuário do processo.'
    );
  }
  let raw: string;
  try {
    raw = (await fs.readFile(caminhoBruto, 'utf8')).trim();
  } catch {
    throw new HomologacaoNfseError(
      'CONTEXTO_INVALIDO',
      'Falha ao ler conteúdo do segredo admin.'
    );
  }
  if (raw.length < ADMIN_SECRET_MIN_LENGTH) {
    throw new HomologacaoNfseError(
      'CONTEXTO_INVALIDO',
      `Segredo admin demasiado curto (mín. ${ADMIN_SECRET_MIN_LENGTH}).`
    );
  }
  return raw;
}

/** Comparação em tempo constante do token (via hash SHA-256). */
export function tokenAdminValido(apresentado: string, esperado: string): boolean {
  const a = createHash('sha256').update(apresentado ?? '', 'utf8').digest();
  const b = createHash('sha256').update(esperado ?? '', 'utf8').digest();
  return timingSafeEqual(a, b);
}

/** Unlink do socket próprio no shutdown — verifica uid antes. */
export async function removerSocketProprioNoShutdown(socketPath: string): Promise<void> {
  try {
    const lst = await fs.lstat(socketPath);
    if (lst.isSymbolicLink()) return;
    if (typeof process.getuid === 'function' && lst.uid !== process.getuid()) {
      return; // não remove alheio
    }
    await fs.unlink(socketPath);
  } catch {
    // já ausente
  }
}
