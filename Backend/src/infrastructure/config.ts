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
  process.env.PLAYWRIGHT_TIMEOUT || '60000',
  10
);
export const PLAYWRIGHT_HEADLESS =
  process.env.PLAYWRIGHT_HEADLESS?.toLowerCase() === 'true';

// ============================================================================
// 2captcha — resolução automática de hCaptcha
// ============================================================================

/** Chave da API do 2captcha. */
export const TWOCAPTCHA_API_KEY = process.env.TWOCAPTCHA_API_KEY || '';

/** 'v2' (createTask/getTaskResult) ou 'v1' (in.php/res.php). Padrão: v2. */
export const TWOCAPTCHA_API_VERSION = (
  process.env.TWOCAPTCHA_API_VERSION || 'v2'
).toLowerCase();

/** Tempo máximo (ms) aguardando a solução automática. Padrão: 7 min. */
export const CAPTCHA_SOLVE_TIMEOUT_MS = parseInt(
  process.env.CAPTCHA_SOLVE_TIMEOUT_MS || '420000',
  10
);

/** isInvisible na task v2. false = widget "Sou humano" (padrão do portal NFSe). */
export const CAPTCHA_IS_INVISIBLE =
  process.env.CAPTCHA_IS_INVISIBLE?.toLowerCase() === 'true';

/**
 * Override opcional de rqdata (hCaptcha Enterprise).
 * Se vazio, a automação tenta capturar na página; se não houver valor real,
 * o campo é omitido do payload (nunca envia "" ou null).
 * Nunca use c.req como substituto.
 */
export const TWOCAPTCHA_RQDATA = process.env.TWOCAPTCHA_RQDATA || '';

/**
 * Modo de resolução:
 *  - auto        : só 2captcha
 *  - manual      : usuário resolve no navegador
 *  - auto_manual : tenta 2captcha; se falhar, aguarda resolução manual
 */
export const CAPTCHA_MODE = (
  process.env.CAPTCHA_MODE || 'auto_manual'
).toLowerCase();

/** Timeout (ms) da resolução manual no navegador. Padrão: 7 min. */
export const CAPTCHA_MANUAL_TIMEOUT_MS = parseInt(
  process.env.CAPTCHA_MANUAL_TIMEOUT_MS || '420000',
  10
);

/** Proxy opcional para HCaptchaTask (API v2 com proxy). */
export const TWOCAPTCHA_PROXY_TYPE = process.env.TWOCAPTCHA_PROXY_TYPE || '';
export const TWOCAPTCHA_PROXY_ADDRESS = process.env.TWOCAPTCHA_PROXY_ADDRESS || '';
export const TWOCAPTCHA_PROXY_PORT = process.env.TWOCAPTCHA_PROXY_PORT || '';
export const TWOCAPTCHA_PROXY_LOGIN = process.env.TWOCAPTCHA_PROXY_LOGIN || '';
export const TWOCAPTCHA_PROXY_PASSWORD = process.env.TWOCAPTCHA_PROXY_PASSWORD || '';

// ============================================================================
// Retry de operação de download (novo CAPTCHA por tentativa)
// ============================================================================

/** Tentativas automáticas por operação (XML/PDF), incluindo a primeira. Padrão: 2. */
export const CAPTCHA_OPERATION_MAX_ATTEMPTS = Math.max(
  1,
  parseInt(process.env.CAPTCHA_OPERATION_MAX_ATTEMPTS || '2', 10)
);

/** Delay (ms) entre fechar o modal antigo e reclicar no download. */
export const CAPTCHA_OPERATION_RETRY_DELAY_MS = parseInt(
  process.env.CAPTCHA_OPERATION_RETRY_DELAY_MS || '4000',
  10
);

/** Timeout (ms) para fechar o modal via #btnLimpar. */
export const CAPTCHA_MODAL_CLOSE_TIMEOUT_MS = parseInt(
  process.env.CAPTCHA_MODAL_CLOSE_TIMEOUT_MS || '10000',
  10
);

/** Timeout (ms) aguardando um novo desafio hCaptcha após o reclique. */
export const CAPTCHA_NEW_CHALLENGE_TIMEOUT_MS = parseInt(
  process.env.CAPTCHA_NEW_CHALLENGE_TIMEOUT_MS || '20000',
  10
);

/** Timeout (ms) para relocalizar a nota na tabela. */
export const CAPTCHA_NOTE_RELOCATION_TIMEOUT_MS = parseInt(
  process.env.CAPTCHA_NOTE_RELOCATION_TIMEOUT_MS || '60000',
  10
);

/** Após esgotar tentativas automáticas, usar fallback manual da operação. */
export const CAPTCHA_OPERATION_FALLBACK_MANUAL =
  (process.env.CAPTCHA_OPERATION_FALLBACK_MANUAL || 'true').toLowerCase() !==
  'false';

/**
 * Falhas consecutivas do 2Captcha na mesma execução antes de ir direto ao manual
 * nas próximas operações (não global entre empresas).
 */
export const CAPTCHA_CONSECUTIVE_FAILURE_LIMIT = Math.max(
  1,
  parseInt(process.env.CAPTCHA_CONSECUTIVE_FAILURE_LIMIT || '3', 10)
);

/** Códigos 2Captcha que autorizam regenerar CAPTCHA (retry de operação). */
export const CAPTCHA_RETRYABLE_ERROR_CODES: string[] = (
  process.env.CAPTCHA_RETRYABLE_ERROR_CODES || 'ERROR_CAPTCHA_UNSOLVABLE'
)
  .split(',')
  .map((c) => c.trim())
  .filter(Boolean);

// ============================================================================
// Fila de execução
// ============================================================================

export const QUEUE_TIMEOUT = parseInt(
  process.env.QUEUE_TIMEOUT || '60',
  10
);

/** Cap máximo de concorrência em batch. User pode configurar 60+; este limita para evitar sobrecarga. */
export const MAX_CONCURRENCY_CAP = parseInt(
  process.env.MAX_CONCURRENCY_CAP || '8',
  10
);

// ============================================================================
// Servidor
// ============================================================================

export const PORT = parseInt(process.env.PORT || '4321', 10);
