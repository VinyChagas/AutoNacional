/**
 * Validação de variáveis de ambiente.
 * O servidor não inicia se variáveis obrigatórias estiverem faltando.
 */
import * as dotenv from 'dotenv';
import * as path from 'path';

const backendDir = path.resolve(__dirname, '../..');
const envPath = path.join(backendDir, '.env');
dotenv.config({ path: envPath });
dotenv.config();

const REQUIRED = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'CRYPTO_KEY',
  'CERT_STORAGE_BUCKET',
] as const;

export type EnvConfig = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  CRYPTO_KEY: string;
  CERT_STORAGE_BUCKET: string;
  DATABASE_URL: string;
  FERNET_KEY: string;
  APP_CRED_KEY: string;
  CORS_ORIGINS: string;
  PORT: number;
  NODE_ENV: string;
};

/**
 * Valida variáveis obrigatórias. Só valida quando USE_SUPABASE=true
 * (para não quebrar setups que ainda usam apenas Prisma).
 */
function validateEnv(): EnvConfig {
  const useSupabase = process.env.USE_SUPABASE === 'true';

  if (useSupabase) {
    const missing: string[] = [];
    for (const key of REQUIRED) {
      const val = process.env[key];
      if (!val || String(val).trim() === '') {
        missing.push(key);
      }
    }
    if (missing.length > 0) {
      throw new Error(
        `Variáveis de ambiente obrigatórias não definidas: ${missing.join(', ')}. ` +
          `Configure no .env (veja .env.example). Ou remova USE_SUPABASE=true para rodar sem Supabase.`
      );
    }
  }

  return {
    SUPABASE_URL: process.env.SUPABASE_URL || '',
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    CRYPTO_KEY: process.env.CRYPTO_KEY || process.env.APP_CRED_KEY || '',
    CERT_STORAGE_BUCKET: process.env.CERT_STORAGE_BUCKET || 'certificados',
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
