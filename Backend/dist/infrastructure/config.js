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
exports.PORT = exports.MAX_CONCURRENCY_CAP = exports.QUEUE_TIMEOUT = exports.PLAYWRIGHT_HEADLESS = exports.PLAYWRIGHT_TIMEOUT = exports.CORS_ORIGINS = exports.INTERNAL_API_KEY = exports.SUPABASE_ISSUER = exports.SUPABASE_AUDIENCE = exports.SUPABASE_JWKS_URL = exports.SUPABASE_SERVICE_ROLE_KEY = exports.SUPABASE_URL = exports.APP_CRED_KEY = exports.DATABASE_URL = exports.CERT_STORAGE_BUCKET = exports.CRYPTO_KEY = exports.FERNET_KEY = exports.CERTIFICATES_DIR = exports.BACKEND_DIR = void 0;
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