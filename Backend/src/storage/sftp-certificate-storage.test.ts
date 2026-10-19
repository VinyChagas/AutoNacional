import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SFTPWrapper } from 'ssh2';
import { SftpCertificateStorage } from './sftp-certificate-storage';
import { SftpConnectionManager } from './sftp-connection-manager';
import {
  CertificateFileNotFoundError,
  CertificateStorageError,
  UnsafeCertificatePathError,
} from './certificate-storage';

const SAMPLE = Buffer.from('pfx-test-bytes-not-a-real-certificate');
const BASE = '/srv/data/autonacional/certificados';

type FakeNode = {
  type: 'file' | 'dir';
  content?: Buffer;
};

class FakeSftpFs {
  private nodes = new Map<string, FakeNode>();

  constructor() {
    this.nodes.set(BASE, { type: 'dir' });
  }

  stat(remotePath: string, cb: (err: Error | null, stats?: { isDirectory: () => boolean; isFile: () => boolean }) => void) {
    const node = this.nodes.get(remotePath);
    if (!node) {
      const err = new Error('No such file') as Error & { code: number };
      err.code = 2;
      cb(err);
      return;
    }
    cb(null, {
      isDirectory: () => node.type === 'dir',
      isFile: () => node.type === 'file',
    });
  }

  readFile(remotePath: string, cb: (err: Error | null, data?: Buffer) => void) {
    const node = this.nodes.get(remotePath);
    if (!node || node.type !== 'file') {
      const err = new Error('No such file') as Error & { code: number };
      err.code = 2;
      cb(err);
      return;
    }
    cb(null, node.content);
  }

  writeFile(remotePath: string, data: Buffer, cb: (err: Error | null) => void) {
    this.nodes.set(remotePath, { type: 'file', content: Buffer.from(data) });
    cb(null);
  }

  unlink(remotePath: string, cb: (err: Error | null) => void) {
    if (!this.nodes.has(remotePath)) {
      const err = new Error('No such file') as Error & { code: number };
      err.code = 2;
      cb(err);
      return;
    }
    this.nodes.delete(remotePath);
    cb(null);
  }

  mkdir(remotePath: string, cb: (err: Error | null) => void) {
    this.nodes.set(remotePath, { type: 'dir' });
    cb(null);
  }

  asWrapper(): SFTPWrapper {
    return {
      stat: (p, cb) => this.stat(p, cb),
      readFile: (p, cb) => this.readFile(p, cb),
      writeFile: (p, data, cb) => this.writeFile(p, data, cb),
      unlink: (p, cb) => this.unlink(p, cb),
      mkdir: (p, _mode, cb) => this.mkdir(p, cb),
    } as unknown as SFTPWrapper;
  }
}

class FakeConnectionManager extends SftpConnectionManager {
  private readonly fs = new FakeSftpFs();
  private failNext = false;
  private disconnected = false;

  constructor() {
    super({
      host: 'fake',
      port: 22,
      username: 'fake',
      privateKeyPath: '/dev/null',
    });
  }

  failNextOperation(): void {
    this.failNext = true;
  }

  simulateDisconnect(): void {
    this.disconnected = true;
  }

  override async withSftp<T>(
    operation: (sftp: SFTPWrapper) => Promise<T>
  ): Promise<T> {
    const run = async (): Promise<T> => {
      if (this.disconnected) {
        this.disconnected = false;
        throw Object.assign(new Error('connection lost'), { code: 'ECONNRESET' });
      }
      if (this.failNext) {
        this.failNext = false;
        throw Object.assign(new Error('connection lost'), { code: 'ECONNRESET' });
      }
      return operation(this.fs.asWrapper());
    };

    try {
      return await run();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ECONNRESET') {
        return run();
      }
      throw err;
    }
  }

  override async verifyConnection(): Promise<void> {
    await this.withSftp(async (sftp) => {
      await new Promise<void>((resolve, reject) => {
        sftp.stat(BASE, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    });
  }

  override async close(): Promise<void> {
    return;
  }
}

describe('SftpCertificateStorage', () => {
  let storage: SftpCertificateStorage;
  let connection: FakeConnectionManager;

  beforeEach(() => {
    connection = new FakeConnectionManager();
    storage = new SftpCertificateStorage(
      BASE,
      {
        host: 'fake',
        port: 22,
        username: 'fake',
        privateKeyPath: '/dev/null',
      },
      connection
    );
  });

  it('escreve e lê arquivo existente', async () => {
    const relative = 'contabilidade/1/empresa/12345678000199/certs/arquivo.pfx';
    await storage.save(relative, SAMPLE);
    const read = await storage.read(relative);
    expect(Buffer.compare(read, SAMPLE)).toBe(0);
  });

  it('exists() retorna true após escrita e false para arquivo inexistente', async () => {
    const relative = 'empresa/12345678000199/certs/novo.pfx';
    expect(await storage.exists(relative)).toBe(false);
    await storage.save(relative, SAMPLE);
    expect(await storage.exists(relative)).toBe(true);
  });

  it('exclui arquivo existente', async () => {
    const relative = 'empresa/12345678000199/certs/apagar.pfx';
    await storage.save(relative, SAMPLE);
    await storage.delete(relative);
    expect(await storage.exists(relative)).toBe(false);
  });

  it('delete de arquivo inexistente não lança', async () => {
    await expect(
      storage.delete('empresa/00000000000000/certs/ausente.pfx')
    ).resolves.toBeUndefined();
  });

  it('read de arquivo inexistente lança CertificateFileNotFoundError', async () => {
    await expect(
      storage.read('empresa/00000000000000/certs/ausente.pfx')
    ).rejects.toBeInstanceOf(CertificateFileNotFoundError);
  });

  it('verifyReady valida diretório base', async () => {
    await expect(storage.verifyReady()).resolves.toBeUndefined();
  });

  it('reconecta após falha temporária de conexão', async () => {
    const relative = 'empresa/12345678000199/certs/retry.pfx';
    connection.failNextOperation();
    await storage.save(relative, SAMPLE);
    expect(await storage.exists(relative)).toBe(true);
  });
});

describe('SftpCertificateStorage path traversal bloqueado', () => {
  let storage: SftpCertificateStorage;

  beforeEach(() => {
    const connection = new FakeConnectionManager();
    storage = new SftpCertificateStorage(
      BASE,
      {
        host: 'fake',
        port: 22,
        username: 'fake',
        privateKeyPath: '/dev/null',
      },
      connection
    );
  });

  const attacks = [
    '../secret.pfx',
    '../../etc/passwd',
    '/etc/passwd',
    'contabilidade/1/../../../etc/passwd',
    'foo/../../outside.pfx',
    '..\\secret.pfx',
    '/srv/data/autonacional/certificados/../etc/passwd',
    '//etc/passwd',
    'contabilidade/1/empresa/../../../../secret.pfx',
  ];

  it.each(attacks)('rejeita %s em save/read/delete/exists', async (attack) => {
    await expect(storage.save(attack, SAMPLE)).rejects.toBeInstanceOf(
      UnsafeCertificatePathError
    );
    await expect(storage.read(attack)).rejects.toBeInstanceOf(
      UnsafeCertificatePathError
    );
    await expect(storage.delete(attack)).rejects.toBeInstanceOf(
      UnsafeCertificatePathError
    );
    await expect(storage.exists(attack)).rejects.toBeInstanceOf(
      UnsafeCertificatePathError
    );
  });

  it('mensagens de erro não incluem path físico remoto', async () => {
    try {
      await storage.read('../secret.pfx');
      throw new Error('deveria ter lançado');
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).not.toContain(BASE);
      expect(msg.toLowerCase()).not.toContain('secret.pfx');
    }
  });
});

describe('storage driver factory', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it('rejeita driver inválido na inicialização do env', async () => {
    vi.resetModules();
    process.env = {
      ...originalEnv,
      CERT_STORAGE_DRIVER: 'supabase',
    };
    await expect(import('../config/env')).rejects.toThrow(
      'CERT_STORAGE_DRIVER inválido'
    );
  });

  it('seleciona LocalCertificateStorage quando driver=local', async () => {
    vi.resetModules();
    process.env = {
      ...originalEnv,
      CERT_STORAGE_DRIVER: 'local',
      CERT_STORAGE_PATH: '/tmp/cert-storage-local-test',
    };
    const { getCertificateStorage, LocalCertificateStorage: Local } = await import('./index');
    const storage = getCertificateStorage();
    expect(storage).toBeInstanceOf(Local);
  });

  it('seleciona SftpCertificateStorage quando driver=sftp com private key', async () => {
    vi.resetModules();
    process.env = {
      ...originalEnv,
      CERT_STORAGE_DRIVER: 'sftp',
      CERT_STORAGE_SFTP_HOST: 'example.com',
      CERT_STORAGE_SFTP_USER: 'user',
      CERT_STORAGE_SFTP_PRIVATE_KEY: '/tmp/fake-key',
      CERT_STORAGE_SFTP_BASE_PATH: '/srv/data/autonacional/certificados',
    };
    const { getCertificateStorage, SftpCertificateStorage: Sftp } = await import('./index');
    const storage = getCertificateStorage();
    expect(storage).toBeInstanceOf(Sftp);
  });

  it('seleciona SftpCertificateStorage quando driver=sftp com ssh-agent', async () => {
    vi.resetModules();
    process.env = {
      ...originalEnv,
      CERT_STORAGE_DRIVER: 'sftp',
      CERT_STORAGE_SFTP_HOST: 'example.com',
      CERT_STORAGE_SFTP_USER: 'user',
      CERT_STORAGE_SFTP_PRIVATE_KEY: '',
      CERT_STORAGE_SFTP_BASE_PATH: '/srv/data/autonacional/certificados',
      SSH_AUTH_SOCK: '/tmp/ssh-agent-test.sock',
    };
    const { getCertificateStorage, SftpCertificateStorage: Sftp } = await import('./index');
    const storage = getCertificateStorage();
    expect(storage).toBeInstanceOf(Sftp);
  });

  it('falha quando driver=sftp sem ssh-agent nem private key', async () => {
    vi.resetModules();
    process.env = {
      ...originalEnv,
      CERT_STORAGE_DRIVER: 'sftp',
      CERT_STORAGE_SFTP_HOST: 'example.com',
      CERT_STORAGE_SFTP_USER: 'user',
      CERT_STORAGE_SFTP_PRIVATE_KEY: '',
      CERT_STORAGE_SFTP_BASE_PATH: '/srv/data/autonacional/certificados',
      SSH_AUTH_SOCK: '',
    };
    const { getCertificateStorage } = await import('./index');
    expect(() => getCertificateStorage()).toThrow(
      /SFTP requer SSH_AUTH_SOCK/
    );
  });
});
