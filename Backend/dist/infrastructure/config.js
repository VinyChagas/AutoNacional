"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.PORT = exports.MAX_CONCURRENCY_CAP = exports.QUEUE_TIMEOUT = exports.CAPTCHA_RETRYABLE_ERROR_CODES = exports.CAPTCHA_CONSECUTIVE_FAILURE_LIMIT = exports.CAPTCHA_OPERATION_FALLBACK_MANUAL = exports.CAPTCHA_NOTE_RELOCATION_TIMEOUT_MS = exports.CAPTCHA_NEW_CHALLENGE_TIMEOUT_MS = exports.CAPTCHA_MODAL_CLOSE_TIMEOUT_MS = exports.CAPTCHA_OPERATION_RETRY_DELAY_MS = exports.CAPTCHA_OPERATION_MAX_ATTEMPTS = exports.TWOCAPTCHA_PROXY_PASSWORD = exports.TWOCAPTCHA_PROXY_LOGIN = exports.TWOCAPTCHA_PROXY_PORT = exports.TWOCAPTCHA_PROXY_ADDRESS = exports.TWOCAPTCHA_PROXY_TYPE = exports.CAPTCHA_DEBUG = exports.CAPTCHA_WINDOW_LAYOUT_ENABLED = exports.CAPTCHA_MANUAL_USE_CENTRAL = exports.MANUAL_CAPTCHA_TIMEOUT_MS = exports.CAPTCHA_MANUAL_TIMEOUT_MS = exports.CAPTCHA_MODE = exports.TWOCAPTCHA_RQDATA = exports.CAPTCHA_IS_INVISIBLE = exports.CAPTCHA_SOLVE_TIMEOUT_MS = exports.TWOCAPTCHA_API_VERSION = exports.TWOCAPTCHA_API_KEY = exports.BROWSER_PAGE_ZOOM = exports.PLAYWRIGHT_HEADLESS = exports.PLAYWRIGHT_TIMEOUT = exports.CORS_ORIGINS = exports.INTERNAL_API_KEY = exports.SUPABASE_ISSUER = exports.SUPABASE_AUDIENCE = exports.SUPABASE_JWKS_URL = exports.SUPABASE_SERVICE_ROLE_KEY = exports.SUPABASE_URL = exports.APP_CRED_KEY = exports.DATABASE_URL = exports.CERT_STORAGE_BUCKET = exports.CRYPTO_KEY = exports.FERNET_KEY = exports.CERTIFICATES_DIR = exports.BACKEND_DIR = void 0;
const dotenv = __importStar(require("dotenv"));
const path = __importStar(require("path"));
// Carrega .env a partir do diretório do Backend ou pai
const backendDir = path.resolve(__dirname, '../..');
const envPath = path.join(backendDir, '.env');
dotenv.config({ path: envPath });
dotenv.config(); // Também tenta do diretório atual
// ============================================================================
// Caminhos
// ============================================================================
exports.BACKEND_DIR = backendDir;
exports.CERTIFICATES_DIR = path.join(backendDir, 'certificados_armazenados');
// ============================================================================
// Configurações de certificado e criptografia
// ============================================================================
exports.FERNET_KEY = process.env.FERNET_KEY || '';
exports.CRYPTO_KEY = process.env.CRYPTO_KEY || process.env.APP_CRED_KEY || '';
exports.CERT_STORAGE_BUCKET = process.env.CERT_STORAGE_BUCKET || 'certificados';
// ============================================================================
// Configurações de banco de dados
// ============================================================================
exports.DATABASE_URL = process.env.DATABASE_URL || '';
exports.APP_CRED_KEY = process.env.APP_CRED_KEY || '';
// ============================================================================
// Configurações de segurança
// ============================================================================
exports.SUPABASE_URL = process.env.SUPABASE_URL || '';
exports.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
exports.SUPABASE_JWKS_URL = process.env.SUPABASE_JWKS_URL || '';
exports.SUPABASE_AUDIENCE = process.env.SUPABASE_AUDIENCE || 'authenticated';
exports.SUPABASE_ISSUER = process.env.SUPABASE_ISSUER || '';
exports.INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';
// ============================================================================
// CORS
// ============================================================================
const corsOriginsEnv = process.env.CORS_ORIGINS ||
    'http://localhost:4200,http://127.0.0.1:4200,http://localhost:1234,http://127.0.0.1:1234';
exports.CORS_ORIGINS = corsOriginsEnv
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
// ============================================================================
// Configurações de execução (Playwright)
// ============================================================================
exports.PLAYWRIGHT_TIMEOUT = parseInt(process.env.PLAYWRIGHT_TIMEOUT || '60000', 10);
exports.PLAYWRIGHT_HEADLESS = process.env.PLAYWRIGHT_HEADLESS?.toLowerCase() === 'true';
/**
 * Zoom inicial das páginas do Chromium (ex.: 0.8 = 80%).
 * Ajuda a caber botões de login (Certificado) nas janelas compactas dos slots.
 * Use 1 para 100%. Override: BROWSER_PAGE_ZOOM=0.8
 */
exports.BROWSER_PAGE_ZOOM = (() => {
    const raw = parseFloat(process.env.BROWSER_PAGE_ZOOM || '1.0');
    if (!Number.isFinite(raw) || raw <= 0.25 || raw > 2)
        return 0.8;
    return raw;
})();
// ============================================================================
// 2captcha — resolução automática de hCaptcha
// ============================================================================
/** Chave da API do 2captcha. */
exports.TWOCAPTCHA_API_KEY = process.env.TWOCAPTCHA_API_KEY || '';
/** 'v2' (createTask/getTaskResult) ou 'v1' (in.php/res.php). Padrão: v2. */
exports.TWOCAPTCHA_API_VERSION = (process.env.TWOCAPTCHA_API_VERSION || 'v2').toLowerCase();
/** Tempo máximo (ms) aguardando a solução automática. Padrão: 7 min. */
exports.CAPTCHA_SOLVE_TIMEOUT_MS = parseInt(process.env.CAPTCHA_SOLVE_TIMEOUT_MS || '420000', 10);
/** isInvisible na task v2. false = widget "Sou humano" (padrão do portal NFSe). */
exports.CAPTCHA_IS_INVISIBLE = process.env.CAPTCHA_IS_INVISIBLE?.toLowerCase() === 'true';
/**
 * Override opcional de rqdata (hCaptcha Enterprise).
 * Se vazio, a automação tenta capturar na página; se não houver valor real,
 * o campo é omitido do payload (nunca envia "" ou null).
 * Nunca use c.req como substituto.
 */
exports.TWOCAPTCHA_RQDATA = process.env.TWOCAPTCHA_RQDATA || '';
/**
 * Modo de resolução:
 *  - auto        : só 2captcha
 *  - manual      : usuário resolve no navegador
 *  - auto_manual : tenta 2captcha; se falhar, aguarda resolução manual
 */
exports.CAPTCHA_MODE = (process.env.CAPTCHA_MODE || 'auto_manual').toLowerCase();
/** Timeout (ms) da resolução manual no navegador. Padrão: 7 min. */
exports.CAPTCHA_MANUAL_TIMEOUT_MS = parseInt(process.env.CAPTCHA_MANUAL_TIMEOUT_MS || '420000', 10);
/**
 * Timeout (ms) da Central Manual de Captchas (Socket.IO).
 * Padrão: 2 minutos (120000). Independente do timeout no navegador Playwright.
 */
exports.MANUAL_CAPTCHA_TIMEOUT_MS = parseInt(process.env.MANUAL_CAPTCHA_TIMEOUT_MS || '120000', 10);
/**
 * Quando true e captchaMode=MANUAL, usa a Central por cliques remotos (Socket.IO).
 * Padrão false: resolução MANUAL local no browser (Tab/Enter + token + Confirmar).
 */
exports.CAPTCHA_MANUAL_USE_CENTRAL = (process.env.CAPTCHA_MANUAL_USE_CENTRAL || 'false').toLowerCase() === 'true';
/**
 * Reserva slot visual e abre o Chromium já na posição/tamanho do slot
 * (headless=false). A janela permanece no slot até o fechamento.
 * Padrão: true.
 */
exports.CAPTCHA_WINDOW_LAYOUT_ENABLED = (process.env.CAPTCHA_WINDOW_LAYOUT_ENABLED || 'true').toLowerCase() !==
    'false';
/**
 * Instrumentação detalhada da Central Manual / injeção hCaptcha.
 * Quando false, evita logs verbosos e artefatos em disco.
 */
exports.CAPTCHA_DEBUG = (process.env.CAPTCHA_DEBUG || 'false').toLowerCase() === 'true';
/** Proxy opcional para HCaptchaTask (API v2 com proxy). */
exports.TWOCAPTCHA_PROXY_TYPE = process.env.TWOCAPTCHA_PROXY_TYPE || '';
exports.TWOCAPTCHA_PROXY_ADDRESS = process.env.TWOCAPTCHA_PROXY_ADDRESS || '';
exports.TWOCAPTCHA_PROXY_PORT = process.env.TWOCAPTCHA_PROXY_PORT || '';
exports.TWOCAPTCHA_PROXY_LOGIN = process.env.TWOCAPTCHA_PROXY_LOGIN || '';
exports.TWOCAPTCHA_PROXY_PASSWORD = process.env.TWOCAPTCHA_PROXY_PASSWORD || '';
// ============================================================================
// Retry de operação de download (novo CAPTCHA por tentativa)
// ============================================================================
/** Tentativas automáticas por operação (XML/PDF), incluindo a primeira. Padrão: 2. */
exports.CAPTCHA_OPERATION_MAX_ATTEMPTS = Math.max(1, parseInt(process.env.CAPTCHA_OPERATION_MAX_ATTEMPTS || '2', 10));
/** Delay (ms) entre fechar o modal antigo e reclicar no download. */
exports.CAPTCHA_OPERATION_RETRY_DELAY_MS = parseInt(process.env.CAPTCHA_OPERATION_RETRY_DELAY_MS || '4000', 10);
/** Timeout (ms) para fechar o modal via #btnLimpar. */
exports.CAPTCHA_MODAL_CLOSE_TIMEOUT_MS = parseInt(process.env.CAPTCHA_MODAL_CLOSE_TIMEOUT_MS || '10000', 10);
/** Timeout (ms) aguardando um novo desafio hCaptcha após o reclique. */
exports.CAPTCHA_NEW_CHALLENGE_TIMEOUT_MS = parseInt(process.env.CAPTCHA_NEW_CHALLENGE_TIMEOUT_MS || '20000', 10);
/** Timeout (ms) para relocalizar a nota na tabela. */
exports.CAPTCHA_NOTE_RELOCATION_TIMEOUT_MS = parseInt(process.env.CAPTCHA_NOTE_RELOCATION_TIMEOUT_MS || '60000', 10);
/** Após esgotar tentativas automáticas, usar fallback manual da operação. */
exports.CAPTCHA_OPERATION_FALLBACK_MANUAL = (process.env.CAPTCHA_OPERATION_FALLBACK_MANUAL || 'true').toLowerCase() !==
    'false';
/**
 * Falhas consecutivas do 2Captcha na mesma execução antes de ir direto ao manual
 * nas próximas operações (não global entre empresas).
 */
exports.CAPTCHA_CONSECUTIVE_FAILURE_LIMIT = Math.max(1, parseInt(process.env.CAPTCHA_CONSECUTIVE_FAILURE_LIMIT || '3', 10));
/** Códigos 2Captcha que autorizam regenerar CAPTCHA (retry de operação). */
exports.CAPTCHA_RETRYABLE_ERROR_CODES = (process.env.CAPTCHA_RETRYABLE_ERROR_CODES || 'ERROR_CAPTCHA_UNSOLVABLE')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
// ============================================================================
// Fila de execução
// ============================================================================
exports.QUEUE_TIMEOUT = parseInt(process.env.QUEUE_TIMEOUT || '60', 10);
/** Cap máximo de concorrência em batch. User pode configurar 60+; este limita para evitar sobrecarga. */
exports.MAX_CONCURRENCY_CAP = parseInt(process.env.MAX_CONCURRENCY_CAP || '8', 10);
// ============================================================================
// Servidor
// ============================================================================
exports.PORT = parseInt(process.env.PORT || '4321', 10);
//# sourceMappingURL=config.js.map