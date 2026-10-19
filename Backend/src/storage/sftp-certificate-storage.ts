import * as path from 'path';
import type { SFTPWrapper } from 'ssh2';
import {
  CertificateFileNotFoundError,
  CertificateStorageError,
  UnsafeCertificatePathError,
  type CertificateStorage,
} from './certificate-storage';
import {
  assertResolvedInsidePosixBase,
  resolveSafeCertificatePathPosix,
} from './path-safety';
import {
  SftpConnectionManager,
  type SftpConnectionConfig,
} from './sftp-connection-manager';

const SSH_FX_NO_SUCH_FILE = 2;

function sftpErrCode(err: unknown): number | undefined {
  return (err as { code?: number })?.code;
}

function isNotFound(err: unknown): boolean {
  return sftpErrCode(err) === SSH_FX_NO_SUCH_FILE;
}

function promisify<T>(
  fn: (cb: (err: Error | null | undefined, result: T) => void) => void
): Promise<T> {
  return new Promise((resolve, reject) => {
    fn((err, result) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(result);
    });
  });
}

async function sftpReadFile(sftp: SFTPWrapper, remotePath: string): Promise<Buffer> {
  return promisify<Buffer>((cb) => sftp.readFile(remotePath, cb));
}

async function sftpWriteFile(
  sftp: SFTPWrapper,
  remotePath: string,
  data: Buffer
): Promise<void> {
  await promisify<void>((cb) => sftp.writeFile(remotePath, data, cb));
}

async function sftpUnlink(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  await promisify<void>((cb) => sftp.unlink(remotePath, cb));
}

async function sftpStat(
  sftp: SFTPWrapper,
  remotePath: string
): Promise<import('ssh2').Stats> {
  return promisify<import('ssh2').Stats>((cb) => sftp.stat(remotePath, cb));
}

async function sftpMkdir(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  await promisify<void>((cb) => sftp.mkdir(remotePath, cb));
}

async function ensureRemoteDir(sftp: SFTPWrapper, remoteDir: string): Promise<void> {
  const normalized = path.posix.normalize(remoteDir);
  if (normalized === '/' || normalized === '.') {
    return;
  }

  try {
    const stats = await sftpStat(sftp, normalized);
    if (stats.isDirectory()) {
      return;
    }
    throw new CertificateStorageError('Falha ao salvar certificado');
  } catch (err) {
    if (!(err instanceof CertificateStorageError) && !isNotFound(err)) {
      throw new CertificateStorageError('Falha ao salvar certificado');
    }
    if (err instanceof CertificateStorageError) {
      throw err;
    }
  }

  const parent = path.posix.dirname(normalized);
  if (parent && parent !== '.' && parent !== normalized) {
    await ensureRemoteDir(sftp, parent);
  }

  try {
    await sftpMkdir(sftp, normalized);
  } catch {
    try {
      const stats = await sftpStat(sftp, normalized);
      if (!stats.isDirectory()) {
        throw new CertificateStorageError('Falha ao salvar certificado');
      }
    } catch (innerErr) {
      if (innerErr instanceof CertificateStorageError) throw innerErr;
      throw new CertificateStorageError('Falha ao salvar certificado');
    }
  }
}

export class SftpCertificateStorage implements CertificateStorage {
  private readonly connection: SftpConnectionManager;
  private readonly basePath: string;

  constructor(
    basePath: string,
    connectionConfig: SftpConnectionConfig,
    connectionManager?: SftpConnectionManager
  ) {
    const trimmedBase = basePath?.trim();
    if (!trimmedBase) {
      throw new CertificateStorageError(
        'CERT_STORAGE_SFTP_BASE_PATH não configurado'
      );
    }
    this.basePath = path.posix.resolve(trimmedBase.replace(/\\/g, '/'));
    this.connection =
      connectionManager ?? new SftpConnectionManager(connectionConfig);
  }

  getConnectionManager(): SftpConnectionManager {
    return this.connection;
  }

  private resolveInside(relativePath: string): string {
    const candidate = resolveSafeCertificatePathPosix(
      this.basePath,
      relativePath
    );
    return assertResolvedInsidePosixBase(this.basePath, candidate);
  }

  async verifyReady(): Promise<void> {
    await this.connection.withSftp(async (sftp) => {
      const stats = await sftpStat(sftp, this.basePath);
      if (!stats.isDirectory()) {
        throw new CertificateStorageError(
          'CERT_STORAGE_SFTP_BASE_PATH não é um diretório acessível'
        );
      }
    });
  }

  async close(): Promise<void> {
    await this.connection.close();
  }

  async save(relativePath: string, buffer: Buffer): Promise<void> {
    const remotePath = this.resolveInside(relativePath);
    const remoteDir = path.posix.dirname(remotePath);
    try {
      await this.connection.withSftp(async (sftp) => {
        await ensureRemoteDir(sftp, remoteDir);
        await sftpWriteFile(sftp, remotePath, buffer);
      });
    } catch (err) {
      if (err instanceof UnsafeCertificatePathError) throw err;
      throw new CertificateStorageError('Falha ao salvar certificado');
    }
  }

  async read(relativePath: string): Promise<Buffer> {
    const remotePath = this.resolveInside(relativePath);
    try {
      return await this.connection.withSftp(async (sftp) =>
        sftpReadFile(sftp, remotePath)
      );
    } catch (err) {
      if (err instanceof UnsafeCertificatePathError) throw err;
      if (isNotFound(err)) {
        throw new CertificateFileNotFoundError();
      }
      throw new CertificateStorageError('Falha ao ler certificado');
    }
  }

  async delete(relativePath: string): Promise<void> {
    const remotePath = this.resolveInside(relativePath);
    try {
      await this.connection.withSftp(async (sftp) => {
        await sftpUnlink(sftp, remotePath);
      });
    } catch (err) {
      if (err instanceof UnsafeCertificatePathError) throw err;
      if (isNotFound(err)) {
        return;
      }
      throw new CertificateStorageError('Falha ao excluir certificado');
    }
  }

  async exists(relativePath: string): Promise<boolean> {
    const remotePath = this.resolveInside(relativePath);
    try {
      await this.connection.withSftp(async (sftp) => {
        await sftpStat(sftp, remotePath);
      });
      return true;
    } catch (err) {
      if (err instanceof UnsafeCertificatePathError) throw err;
      if (isNotFound(err)) {
        return false;
      }
      throw new CertificateStorageError('Falha ao verificar certificado');
    }
  }
}
