/**
 * Validação de variáveis de ambiente.
 *
 * Separação clara:
 * - DATABASE_URL → PostgreSQL (VPS / próprio) via Prisma
 * - CERT_STORAGE_DRIVER → local (filesystem) ou sftp (VPS remota)
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import { isSftpAuthConfigured } from '../storage/sftp-auth';

const backendDir = path.resolve(__dirname, '../..');
const envPath = path.join(backendDir, '.env');
dotenv.config({ path: envPath });
dotenv.config();

export type CertificateStorageDriver = 'local' | 'sftp';

export type EnvConfig = {
  CRYPTO_KEY: string;
  CERT_STORAGE_DRIVER: CertificateStorageDriver;
  CERT_STORAGE_PATH: string;
  CERT_STORAGE_SFTP_HOST: string;
  CERT_STORAGE_SFTP_PORT: number;
  CERT_STORAGE_SFTP_USER: string;
  CERT_STORAGE_SFTP_PRIVATE_KEY: string;
  CERT_STORAGE_SFTP_BASE_PATH: string;
  DATABASE_URL: string;
  FERNET_KEY: string;
  APP_CRED_KEY: string;
  CORS_ORIGINS: string;
  PORT: number;
  NODE_ENV: string;
};

const DEFAULT_CERT_STORAGE_PATH = '/srv/data/autonacional/certificados';
const DEFAULT_CERT_STORAGE_SFTP_BASE_PATH = '/srv/data/autonacional/certificados';

function parseStorageDriver(raw: string | undefined): CertificateStorageDriver {
  const value = (raw || 'local').trim().toLowerCase();
  if (value === 'local' || value === 'sftp') {
    return value;
  }
  throw new Error(
    `CERT_STORAGE_DRIVER inválido: "${raw}". Valores permitidos: local, sftp`
  );
}

function validateEnv(): EnvConfig {
  return {
    CRYPTO_KEY: process.env.CRYPTO_KEY || process.env.APP_CRED_KEY || '',
    CERT_STORAGE_DRIVER: parseStorageDriver(process.env.CERT_STORAGE_DRIVER),
    CERT_STORAGE_PATH: (
      process.env.CERT_STORAGE_PATH || DEFAULT_CERT_STORAGE_PATH
    ).trim(),
    CERT_STORAGE_SFTP_HOST: (process.env.CERT_STORAGE_SFTP_HOST || '').trim(),
    CERT_STORAGE_SFTP_PORT: parseInt(
      process.env.CERT_STORAGE_SFTP_PORT || '22',
      10
    ),
    CERT_STORAGE_SFTP_USER: (process.env.CERT_STORAGE_SFTP_USER || '').trim(),
    CERT_STORAGE_SFTP_PRIVATE_KEY: (
      process.env.CERT_STORAGE_SFTP_PRIVATE_KEY || ''
    ).trim(),
    CERT_STORAGE_SFTP_BASE_PATH: (
      process.env.CERT_STORAGE_SFTP_BASE_PATH ||
      DEFAULT_CERT_STORAGE_SFTP_BASE_PATH
    ).trim(),
    DATABASE_URL: process.env.DATABASE_URL || '',
    FERNET_KEY: process.env.FERNET_KEY || '',
    APP_CRED_KEY: process.env.APP_CRED_KEY || '',
    CORS_ORIGINS:
      process.env.CORS_ORIGINS ||
      'http://localhost:4200,http://127.0.0.1:4200',
    PORT: parseInt(process.env.PORT || '4321', 10),
    NODE_ENV: process.env.NODE_ENV || 'development',
  };
}

export const env = validateEnv();

export function isCertificateStorageConfigured(): boolean {
  if (env.CERT_STORAGE_DRIVER === 'sftp') {
    return Boolean(
      env.CERT_STORAGE_SFTP_HOST &&
        env.CERT_STORAGE_SFTP_USER &&
        env.CERT_STORAGE_SFTP_BASE_PATH &&
        isSftpAuthConfigured({
          sshAuthSock: process.env.SSH_AUTH_SOCK,
          privateKeyPath: env.CERT_STORAGE_SFTP_PRIVATE_KEY,
        })
    );
  }
  return Boolean(env.CERT_STORAGE_PATH?.length);
}

export function describeCertificateStorageTarget(): string {
  if (env.CERT_STORAGE_DRIVER === 'sftp') {
    return `SFTP (${env.CERT_STORAGE_SFTP_HOST}:${env.CERT_STORAGE_SFTP_PORT})`;
  }
  return 'Local filesystem';
}

/**
 * Extrai host e database de DATABASE_URL sem expor senha ou connection string.
 */
export function describeDatabaseTarget(databaseUrl: string = env.DATABASE_URL): {
  host: string;
  database: string;
} {
  if (!databaseUrl) {
    return { host: '(não configurado)', database: '(não configurado)' };
  }
  try {
    const normalized = databaseUrl
      .replace(/^postgresql:/i, 'http:')
      .replace(/^postgres:/i, 'http:');
    const u = new URL(normalized);
    const database =
      decodeURIComponent(u.pathname.replace(/^\//, '').split('?')[0] || '') ||
      '(desconhecido)';
    return {
      host: u.hostname || '(desconhecido)',
      database,
    };
  } catch {
    return { host: '(indisponível)', database: '(indisponível)' };
  }
}
