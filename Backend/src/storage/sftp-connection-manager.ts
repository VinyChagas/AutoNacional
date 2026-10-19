import { readFile } from 'fs/promises';
import { Client, type ConnectConfig, type SFTPWrapper } from 'ssh2';
import { CertificateStorageError } from './certificate-storage';
import { resolveSftpAuthMode } from './sftp-auth';

export type SftpConnectionConfig = {
  host: string;
  port: number;
  username: string;
  privateKeyPath?: string;
  connectTimeoutMs?: number;
  keepaliveIntervalMs?: number;
  keepaliveCountMax?: number;
};

const DEFAULT_CONNECT_TIMEOUT_MS = 30_000;
const DEFAULT_KEEPALIVE_INTERVAL_MS = 10_000;
const DEFAULT_KEEPALIVE_COUNT_MAX = 3;

function isConnectionError(err: unknown): boolean {
  const message = (err as Error)?.message?.toLowerCase() ?? '';
  const code = (err as NodeJS.ErrnoException)?.code;
  return (
    code === 'ECONNRESET' ||
    code === 'EPIPE' ||
    code === 'ETIMEDOUT' ||
    code === 'ENOTCONN' ||
    message.includes('not connected') ||
    message.includes('connection lost') ||
    message.includes('connection closed')
  );
}

function sanitizeAuthError(err: unknown): CertificateStorageError {
  const message = (err as Error)?.message?.toLowerCase() ?? '';
  if (
    message.includes('passphrase') ||
    message.includes('encrypted') ||
    message.includes('authentication')
  ) {
    return new CertificateStorageError(
      'Falha de autenticação SFTP. Se a chave SSH tiver passphrase, adicione-a ao ssh-agent com `ssh-add` antes de iniciar o Backend (não grave passphrase no .env).'
    );
  }
  return new CertificateStorageError('Falha ao conectar via SFTP');
}

export class SftpConnectionManager {
  private client: Client | null = null;
  private sftp: SFTPWrapper | null = null;
  private connecting: Promise<SFTPWrapper> | null = null;
  private closed = false;
  private operationChain: Promise<unknown> = Promise.resolve();

  constructor(private readonly config: SftpConnectionConfig) {}

  async withSftp<T>(operation: (sftp: SFTPWrapper) => Promise<T>): Promise<T> {
    if (this.closed) {
      throw new CertificateStorageError('Conexão SFTP encerrada');
    }

    const run = async (): Promise<T> => {
      try {
        const sftp = await this.getSftp();
        return await operation(sftp);
      } catch (err) {
        if (isConnectionError(err)) {
          await this.disconnect();
          const sftp = await this.getSftp();
          return await operation(sftp);
        }
        throw err;
      }
    };

    const result = this.operationChain.then(run, run);
    this.operationChain = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  async verifyConnection(): Promise<void> {
    await this.withSftp(async (sftp) => {
      await sftpStat(sftp, '.');
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.disconnect();
  }

  private async getSftp(): Promise<SFTPWrapper> {
    if (this.closed) {
      throw new CertificateStorageError('Conexão SFTP encerrada');
    }
    if (this.sftp) {
      return this.sftp;
    }
    if (this.connecting) {
      return this.connecting;
    }
    this.connecting = this.connect();
    try {
      return await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  private async connect(): Promise<SFTPWrapper> {
    const connectOptions = await buildSftpConnectOptions(this.config);
    const client = new Client();
    const sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
      const timeoutMs =
        this.config.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
      const timer = setTimeout(() => {
        client.end();
        reject(new CertificateStorageError('Timeout ao conectar via SFTP'));
      }, timeoutMs);

      client
        .on('ready', () => {
          client.sftp((err, sftpSession) => {
            clearTimeout(timer);
            if (err) {
              client.end();
              reject(sanitizeAuthError(err));
              return;
            }
            resolve(sftpSession);
          });
        })
        .on('error', (err) => {
          clearTimeout(timer);
          reject(sanitizeAuthError(err));
        })
        .connect(connectOptions);
    });

    client.on('close', () => {
      this.sftp = null;
      this.client = null;
    });
    client.on('error', () => {
      this.sftp = null;
      this.client = null;
    });

    this.client = client;
    this.sftp = sftp;
    return sftp;
  }

  private async disconnect(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.sftp = null;
    if (!client) return;

    await new Promise<void>((resolve) => {
      client.once('close', () => resolve());
      client.end();
      setTimeout(resolve, 2_000);
    });
  }
}

function sftpStat(
  sftp: SFTPWrapper,
  remotePath: string
): Promise<import('ssh2').Stats | undefined> {
  return new Promise((resolve, reject) => {
    sftp.stat(remotePath, (err, stats) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(stats);
    });
  });
}

export async function buildSftpConnectOptions(
  config: SftpConnectionConfig
): Promise<ConnectConfig> {
  const authMode = resolveSftpAuthMode({
    sshAuthSock: process.env.SSH_AUTH_SOCK,
    privateKeyPath: config.privateKeyPath,
  });

  const connectOptions: ConnectConfig = {
    host: config.host,
    port: config.port,
    username: config.username,
    keepaliveInterval:
      config.keepaliveIntervalMs ?? DEFAULT_KEEPALIVE_INTERVAL_MS,
    keepaliveCountMax: config.keepaliveCountMax ?? DEFAULT_KEEPALIVE_COUNT_MAX,
    readyTimeout: config.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
  };

  if (authMode === 'ssh-agent') {
    connectOptions.agent = process.env.SSH_AUTH_SOCK;
    return connectOptions;
  }

  const privateKeyPath = config.privateKeyPath?.trim();
  if (!privateKeyPath) {
    throw new CertificateStorageError(
      'SFTP requer SSH_AUTH_SOCK (ssh-agent) ou CERT_STORAGE_SFTP_PRIVATE_KEY configurado'
    );
  }
  connectOptions.privateKey = await readFile(privateKeyPath, 'utf8');
  return connectOptions;
}
