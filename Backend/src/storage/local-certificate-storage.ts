import * as fs from 'fs/promises';
import * as path from 'path';
import {
  CertificateFileNotFoundError,
  CertificateStorageError,
  UnsafeCertificatePathError,
  type CertificateStorage,
} from './certificate-storage';
import {
  assertResolvedInsideBase,
  resolveSafeCertificatePath,
} from './path-safety';

function fsCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException)?.code;
}

export class LocalCertificateStorage implements CertificateStorage {
  private realBase: string | null = null;

  constructor(private readonly basePath: string) {
    if (!basePath?.trim()) {
      throw new CertificateStorageError('CERT_STORAGE_PATH não configurado');
    }
  }

  private async getRealBase(): Promise<string> {
    if (this.realBase) return this.realBase;
    try {
      this.realBase = await fs.realpath(path.resolve(this.basePath));
    } catch {
      throw new CertificateStorageError(
        'CERT_STORAGE_PATH não existe ou não é acessível'
      );
    }
    return this.realBase;
  }

  private async resolveInside(relativePath: string): Promise<string> {
    const base = await this.getRealBase();
    const candidate = resolveSafeCertificatePath(base, relativePath);
    return assertResolvedInsideBase(base, candidate);
  }

  async save(relativePath: string, buffer: Buffer): Promise<void> {
    const fullPath = await this.resolveInside(relativePath);
    try {
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, buffer);
    } catch (err) {
      if (err instanceof UnsafeCertificatePathError) throw err;
      throw new CertificateStorageError('Falha ao salvar certificado');
    }
  }

  async read(relativePath: string): Promise<Buffer> {
    const fullPath = await this.resolveInside(relativePath);
    try {
      return await fs.readFile(fullPath);
    } catch (err) {
      if (err instanceof UnsafeCertificatePathError) throw err;
      if (fsCode(err) === 'ENOENT') {
        throw new CertificateFileNotFoundError();
      }
      throw new CertificateStorageError('Falha ao ler certificado');
    }
  }

  async delete(relativePath: string): Promise<void> {
    const fullPath = await this.resolveInside(relativePath);
    try {
      await fs.unlink(fullPath);
    } catch (err) {
      if (err instanceof UnsafeCertificatePathError) throw err;
      if (fsCode(err) === 'ENOENT') {
        return;
      }
      throw new CertificateStorageError('Falha ao excluir certificado');
    }
  }

  async exists(relativePath: string): Promise<boolean> {
    const fullPath = await this.resolveInside(relativePath);
    try {
      await fs.access(fullPath);
      return true;
    } catch (err) {
      if (err instanceof UnsafeCertificatePathError) throw err;
      if (fsCode(err) === 'ENOENT') {
        return false;
      }
      throw new CertificateStorageError('Falha ao verificar certificado');
    }
  }
}
