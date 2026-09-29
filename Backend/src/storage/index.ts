import * as fs from 'fs/promises';
import { constants as fsConstants } from 'fs';
import * as path from 'path';
import { env } from '../config/env';
import {
  CertificateStorageError,
  type CertificateStorage,
} from './certificate-storage';
import { LocalCertificateStorage } from './local-certificate-storage';
import { SftpCertificateStorage } from './sftp-certificate-storage';
import { isSftpAuthConfigured } from './sftp-auth';

export type { CertificateStorage } from './certificate-storage';
export {
  CertificateFileNotFoundError,
  CertificateStorageError,
  UnsafeCertificatePathError,
  maskRelativePath,
} from './certificate-storage';
export { LocalCertificateStorage } from './local-certificate-storage';
export { SftpCertificateStorage } from './sftp-certificate-storage';
export {
  resolveSafeCertificatePath,
  resolveSafeCertificatePathPosix,
} from './path-safety';

let instance: CertificateStorage | null = null;
let closable: { close?: () => Promise<void> } | null = null;

function createCertificateStorage(): CertificateStorage {
  if (env.CERT_STORAGE_DRIVER === 'sftp') {
    const host = env.CERT_STORAGE_SFTP_HOST;
    const user = env.CERT_STORAGE_SFTP_USER;
    const privateKeyPath = env.CERT_STORAGE_SFTP_PRIVATE_KEY;
    const basePath = env.CERT_STORAGE_SFTP_BASE_PATH;

    if (!host) {
      throw new CertificateStorageError('CERT_STORAGE_SFTP_HOST não configurado');
    }
    if (!user) {
      throw new CertificateStorageError('CERT_STORAGE_SFTP_USER não configurado');
    }
    if (
      !isSftpAuthConfigured({
        sshAuthSock: process.env.SSH_AUTH_SOCK,
        privateKeyPath,
      })
    ) {
      throw new CertificateStorageError(
        'SFTP requer SSH_AUTH_SOCK (ssh-agent) ou CERT_STORAGE_SFTP_PRIVATE_KEY configurado'
      );
    }
    if (!basePath) {
      throw new CertificateStorageError(
        'CERT_STORAGE_SFTP_BASE_PATH não configurado'
      );
    }

    const storage = new SftpCertificateStorage(basePath, {
      host,
      port: env.CERT_STORAGE_SFTP_PORT,
      username: user,
      ...(privateKeyPath ? { privateKeyPath } : {}),
    });
    closable = storage;
    return storage;
  }

  closable = null;
  return new LocalCertificateStorage(env.CERT_STORAGE_PATH);
}

export function getCertificateStorage(): CertificateStorage {
  if (!instance) {
    instance = createCertificateStorage();
  }
  return instance;
}

/** Uso em testes: injeta implementação (ex.: LocalCertificateStorage em tmpdir). */
export function setCertificateStorageForTests(
  storage: CertificateStorage | null
): void {
  instance = storage;
  closable = storage as { close?: () => Promise<void> } | null;
}

export async function closeCertificateStorage(): Promise<void> {
  if (closable?.close) {
    await closable.close();
  }
  instance = null;
  closable = null;
}

export async function assertCertificateStorageReady(): Promise<void> {
  if (env.CERT_STORAGE_DRIVER === 'sftp') {
    const storage = getCertificateStorage();
    if (storage instanceof SftpCertificateStorage) {
      await storage.verifyReady();
    }
    return;
  }

  const base = env.CERT_STORAGE_PATH?.trim();
  if (!base) {
    throw new CertificateStorageError('CERT_STORAGE_PATH não configurado');
  }

  const resolved = path.resolve(base);
  try {
    const stat = await fs.stat(resolved);
    if (!stat.isDirectory()) {
      throw new CertificateStorageError(
        'CERT_STORAGE_PATH não é um diretório acessível'
      );
    }
    await fs.access(resolved, fsConstants.R_OK);
  } catch (err) {
    if (err instanceof CertificateStorageError) throw err;
    throw new CertificateStorageError(
      'CERT_STORAGE_PATH não existe ou não é acessível'
    );
  }
}

export async function isCertificateStorageReady(): Promise<boolean> {
  try {
    await assertCertificateStorageReady();
    return true;
  } catch {
    return false;
  }
}

export function getCertificateStorageDriverLabel(): string {
  return env.CERT_STORAGE_DRIVER === 'sftp'
    ? 'SFTP conectado'
    : 'Local filesystem conectado';
}

export function getCertificateStorageArchitectureLabel(): string {
  if (env.CERT_STORAGE_DRIVER === 'sftp') {
    return 'Prisma→PostgreSQL VPS | SFTP→certificados PFX na VPS';
  }
  return 'Prisma→PostgreSQL VPS | Filesystem local→certificados PFX';
}
