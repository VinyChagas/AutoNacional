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
exports.env = void 0;
/**
 * Validação de variáveis de ambiente.
 * O servidor não inicia se variáveis obrigatórias estiverem faltando.
 */
const dotenv = __importStar(require("dotenv"));
const path = __importStar(require("path"));
const backendDir = path.resolve(__dirname, '../..');
const envPath = path.join(backendDir, '.env');
dotenv.config({ path: envPath });
dotenv.config();
const REQUIRED = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'CRYPTO_KEY',
    'CERT_STORAGE_BUCKET',
];
/**
 * Valida variáveis obrigatórias. Só valida quando USE_SUPABASE=true
 * (para não quebrar setups que ainda usam apenas Prisma).
 */
function validateEnv() {
    const useSupabase = process.env.USE_SUPABASE === 'true';
    if (useSupabase) {
        const missing = [];
        for (const key of REQUIRED) {
            const val = process.env[key];
            if (!val || String(val).trim() === '') {
                missing.push(key);
            }
        }
        if (missing.length > 0) {
            throw new Error(`Variáveis de ambiente obrigatórias não definidas: ${missing.join(', ')}. ` +
                `Configure no .env (veja .env.example). Ou remova USE_SUPABASE=true para rodar sem Supabase.`);
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
        CORS_ORIGINS: process.env.CORS_ORIGINS ||
            'http://localhost:4200,http://127.0.0.1:4200',
        PORT: parseInt(process.env.PORT || '4321', 10),
        NODE_ENV: process.env.NODE_ENV || 'development',
    };
}
exports.env = validateEnv();
//# sourceMappingURL=env.js.map