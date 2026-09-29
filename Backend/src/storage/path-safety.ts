import * as path from 'path';
import { UnsafeCertificatePathError } from './certificate-storage';

function resolveSafeCertificatePathWith(
  pathApi: typeof path.posix,
  baseDir: string,
  relativePath: string
): string {
  if (typeof relativePath !== 'string' || !relativePath.trim()) {
    throw new UnsafeCertificatePathError();
  }

  const trimmed = relativePath.trim();
  if (trimmed.includes('\0')) {
    throw new UnsafeCertificatePathError();
  }

  const posix = trimmed.replace(/\\/g, '/');

  if (
    pathApi.isAbsolute(trimmed) ||
    pathApi.isAbsolute(posix) ||
    posix.startsWith('/') ||
    posix.startsWith('//') ||
    /^[a-zA-Z]:/.test(posix) ||
    trimmed.startsWith('\\')
  ) {
    throw new UnsafeCertificatePathError();
  }

  const segments = posix.split('/');
  if (segments.some((seg) => seg === '..')) {
    throw new UnsafeCertificatePathError();
  }

  const meaningful = segments.filter((seg) => seg !== '' && seg !== '.');
  if (meaningful.length === 0) {
    throw new UnsafeCertificatePathError();
  }

  const baseResolved = pathApi.resolve(baseDir);
  const candidate = pathApi.resolve(baseResolved, meaningful.join('/'));

  if (candidate === baseResolved) {
    throw new UnsafeCertificatePathError();
  }

  const relative = pathApi.relative(baseResolved, candidate);
  if (
    relative.startsWith('..') ||
    pathApi.isAbsolute(relative) ||
    relative.split('/').includes('..')
  ) {
    throw new UnsafeCertificatePathError();
  }

  const prefix = baseResolved.endsWith('/')
    ? baseResolved
    : baseResolved + '/';
  if (!candidate.startsWith(prefix)) {
    throw new UnsafeCertificatePathError();
  }

  return candidate;
}

/**
 * Normaliza e valida um path relativo de certificado (filesystem local).
 * Rejeita absoluto, `..`, null bytes e escape da pasta base.
 * Retorna o path absoluto resolvido — uso interno apenas; não logar/devolver.
 */
export function resolveSafeCertificatePath(
  baseDir: string,
  relativePath: string
): string {
  return resolveSafeCertificatePathWith(path, baseDir, relativePath);
}

/**
 * Variante POSIX para paths remotos (SFTP/Linux).
 */
export function resolveSafeCertificatePathPosix(
  baseDir: string,
  relativePath: string
): string {
  return resolveSafeCertificatePathWith(path.posix, baseDir, relativePath);
}

export async function assertResolvedInsideBase(
  baseDir: string,
  candidate: string
): Promise<string> {
  const fs = await import('fs/promises');
  const baseResolved = path.resolve(baseDir);

  let realBase: string;
  try {
    realBase = await fs.realpath(baseResolved);
  } catch {
    throw new UnsafeCertificatePathError();
  }

  const relativeFromBase = path.relative(baseResolved, path.resolve(candidate));
  if (
    relativeFromBase.startsWith('..') ||
    path.isAbsolute(relativeFromBase) ||
    relativeFromBase.split(path.sep).includes('..')
  ) {
    throw new UnsafeCertificatePathError();
  }

  const candidateOnReal = path.resolve(realBase, relativeFromBase);
  const prefix = realBase.endsWith(path.sep) ? realBase : realBase + path.sep;

  if (candidateOnReal !== realBase && !candidateOnReal.startsWith(prefix)) {
    throw new UnsafeCertificatePathError();
  }

  try {
    const realCandidate = await fs.realpath(candidateOnReal);
    if (realCandidate !== realBase && !realCandidate.startsWith(prefix)) {
      throw new UnsafeCertificatePathError();
    }
    return realCandidate;
  } catch (err) {
    if (err instanceof UnsafeCertificatePathError) throw err;
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return candidateOnReal;
    }
    throw new UnsafeCertificatePathError();
  }
}

/**
 * Valida que o path remoto resolvido permanece dentro da base POSIX (SFTP).
 */
export function assertResolvedInsidePosixBase(
  baseDir: string,
  candidate: string
): string {
  const baseResolved = path.posix.resolve(baseDir);
  const candidateResolved = path.posix.resolve(candidate);
  const relativeFromBase = path.posix.relative(baseResolved, candidateResolved);

  if (
    relativeFromBase.startsWith('..') ||
    path.posix.isAbsolute(relativeFromBase) ||
    relativeFromBase.split('/').includes('..')
  ) {
    throw new UnsafeCertificatePathError();
  }

  const prefix = baseResolved.endsWith('/')
    ? baseResolved
    : baseResolved + '/';

  if (
    candidateResolved !== baseResolved &&
    !candidateResolved.startsWith(prefix)
  ) {
    throw new UnsafeCertificatePathError();
  }

  return candidateResolved;
}
