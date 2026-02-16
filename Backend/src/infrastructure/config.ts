import * as dotenv from 'dotenv';
import * as path from 'path';

// Carrega .env a partir do diretório do Backend ou pai
const backendDir = path.resolve(__dirname, '../..');
const envPath = path.join(backendDir, '.env');
dotenv.config({ path: envPath });
dotenv.config(); // Também tenta do diretório atual

// ============================================================================
// Caminhos
// ============================================================================

export const BACKEND_DIR = backendDir;
export const CERTIFICATES_DIR = path.join(backendDir, 'certificados_armazenados');

// ============================================================================
// Configurações de certificado e criptografia
// ============================================================================

export const FERNET_KEY = process.env.FERNET_KEY || '';
export const CRYPTO_KEY =
  process.env.CRYPTO_KEY || process.env.APP_CRED_KEY || '';
export const CERT_STORAGE_BUCKET =
  process.env.CERT_STORAGE_BUCKET || 'certificados';

// ============================================================================
// Configurações de banco de dados
// ============================================================================

export const DATABASE_URL = process.env.DATABASE_URL || '';
export const APP_CRED_KEY = process.env.APP_CRED_KEY || '';

// ============================================================================
// Configurações de segurança
// ============================================================================

export const SUPABASE_URL = process.env.SUPABASE_URL || '';
export const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || '';
export const SUPABASE_JWKS_URL = process.env.SUPABASE_JWKS_URL || '';
export const SUPABASE_AUDIENCE = process.env.SUPABASE_AUDIENCE || 'authenticated';
export const SUPABASE_ISSUER = process.env.SUPABASE_ISSUER || '';
export const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

// ============================================================================
// CORS
// ============================================================================

const corsOriginsEnv = process.env.CORS_ORIGINS ||
  'http://localhost:4200,http://127.0.0.1:4200,http://localhost:1234,http://127.0.0.1:1234';

export const CORS_ORIGINS: string[] = corsOriginsEnv
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// ============================================================================
// Configurações de execução (Playwright)
// ============================================================================

export const PLAYWRIGHT_TIMEOUT = parseInt(
  process.env.PLAYWRIGHT_TIMEOUT || '30000',
  10
);
export const PLAYWRIGHT_HEADLESS =
  process.env.PLAYWRIGHT_HEADLESS?.toLowerCase() === 'true';

// ============================================================================
// Fila de execução
// ============================================================================

export const QUEUE_TIMEOUT = parseInt(
  process.env.QUEUE_TIMEOUT || '60',
  10
);

// ============================================================================
// Servidor
// ============================================================================

export const PORT = parseInt(process.env.PORT || '4321', 10);
