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
exports.isCertificateStorageConfigured = isCertificateStorageConfigured;
exports.describeCertificateStorageTarget = describeCertificateStorageTarget;
exports.describeDatabaseTarget = describeDatabaseTarget;
/**
 * Validação de variáveis de ambiente.
 *
 * Separação clara:
 * - DATABASE_URL → PostgreSQL (VPS / próprio) via Prisma
 * - CERT_STORAGE_DRIVER → local (filesystem) ou sftp (VPS remota)
 */
const dotenv = __importStar(require("dotenv"));
const path = __importStar(require("path"));
const sftp_auth_1 = require("../storage/sftp-auth");
const backendDir = path.resolve(__dirname, '../..');
const envPath = path.join(backendDir, '.env');
dotenv.config({ path: envPath });
dotenv.config();
const DEFAULT_CERT_STORAGE_PATH = '/srv/data/autonacional/certificados';
const DEFAULT_CERT_STORAGE_SFTP_BASE_PATH = '/srv/data/autonacional/certificados';
function parseStorageDriver(raw) {
    const value = (raw || 'local').trim().toLowerCase();
    if (value === 'local' || value === 'sftp') {
        return value;
    }
    throw new Error(`CERT_STORAGE_DRIVER inválido: "${raw}". Valores permitidos: local, sftp`);
}
function validateEnv() {
    return {
        CRYPTO_KEY: process.env.CRYPTO_KEY || process.env.APP_CRED_KEY || '',
        CERT_STORAGE_DRIVER: parseStorageDriver(process.env.CERT_STORAGE_DRIVER),
        CERT_STORAGE_PATH: (process.env.CERT_STORAGE_PATH || DEFAULT_CERT_STORAGE_PATH).trim(),
        CERT_STORAGE_SFTP_HOST: (process.env.CERT_STORAGE_SFTP_HOST || '').trim(),
        CERT_STORAGE_SFTP_PORT: parseInt(process.env.CERT_STORAGE_SFTP_PORT || '22', 10),
        CERT_STORAGE_SFTP_USER: (process.env.CERT_STORAGE_SFTP_USER || '').trim(),
        CERT_STORAGE_SFTP_PRIVATE_KEY: (process.env.CERT_STORAGE_SFTP_PRIVATE_KEY || '').trim(),
        CERT_STORAGE_SFTP_BASE_PATH: (process.env.CERT_STORAGE_SFTP_BASE_PATH ||
            DEFAULT_CERT_STORAGE_SFTP_BASE_PATH).trim(),
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
function isCertificateStorageConfigured() {
    if (exports.env.CERT_STORAGE_DRIVER === 'sftp') {
        return Boolean(exports.env.CERT_STORAGE_SFTP_HOST &&
            exports.env.CERT_STORAGE_SFTP_USER &&
            exports.env.CERT_STORAGE_SFTP_BASE_PATH &&
            (0, sftp_auth_1.isSftpAuthConfigured)({
                sshAuthSock: process.env.SSH_AUTH_SOCK,
                privateKeyPath: exports.env.CERT_STORAGE_SFTP_PRIVATE_KEY,
            }));
    }
    return Boolean(exports.env.CERT_STORAGE_PATH?.length);
}
function describeCertificateStorageTarget() {
    if (exports.env.CERT_STORAGE_DRIVER === 'sftp') {
        return `SFTP (${exports.env.CERT_STORAGE_SFTP_HOST}:${exports.env.CERT_STORAGE_SFTP_PORT})`;
    }
    return 'Local filesystem';
}
/**
 * Extrai host e database de DATABASE_URL sem expor senha ou connection string.
 */
function describeDatabaseTarget(databaseUrl = exports.env.DATABASE_URL) {
    if (!databaseUrl) {
        return { host: '(não configurado)', database: '(não configurado)' };
    }
    try {
        const normalized = databaseUrl
            .replace(/^postgresql:/i, 'http:')
            .replace(/^postgres:/i, 'http:');
        const u = new URL(normalized);
        const database = decodeURIComponent(u.pathname.replace(/^\//, '').split('?')[0] || '') ||
            '(desconhecido)';
        return {
            host: u.hostname || '(desconhecido)',
            database,
        };
    }
    catch {
        return { host: '(indisponível)', database: '(indisponível)' };
    }
}
//# sourceMappingURL=env.js.map