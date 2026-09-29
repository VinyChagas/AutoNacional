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
exports.resolveSafeCertificatePathPosix = exports.resolveSafeCertificatePath = exports.SftpCertificateStorage = exports.LocalCertificateStorage = exports.maskRelativePath = exports.UnsafeCertificatePathError = exports.CertificateStorageError = exports.CertificateFileNotFoundError = void 0;
exports.getCertificateStorage = getCertificateStorage;
exports.setCertificateStorageForTests = setCertificateStorageForTests;
exports.closeCertificateStorage = closeCertificateStorage;
exports.assertCertificateStorageReady = assertCertificateStorageReady;
exports.isCertificateStorageReady = isCertificateStorageReady;
exports.getCertificateStorageDriverLabel = getCertificateStorageDriverLabel;
exports.getCertificateStorageArchitectureLabel = getCertificateStorageArchitectureLabel;
const fs = __importStar(require("fs/promises"));
const fs_1 = require("fs");
const path = __importStar(require("path"));
const env_1 = require("../config/env");
const certificate_storage_1 = require("./certificate-storage");
const local_certificate_storage_1 = require("./local-certificate-storage");
const sftp_certificate_storage_1 = require("./sftp-certificate-storage");
const sftp_auth_1 = require("./sftp-auth");
var certificate_storage_2 = require("./certificate-storage");
Object.defineProperty(exports, "CertificateFileNotFoundError", { enumerable: true, get: function () { return certificate_storage_2.CertificateFileNotFoundError; } });
Object.defineProperty(exports, "CertificateStorageError", { enumerable: true, get: function () { return certificate_storage_2.CertificateStorageError; } });
Object.defineProperty(exports, "UnsafeCertificatePathError", { enumerable: true, get: function () { return certificate_storage_2.UnsafeCertificatePathError; } });
Object.defineProperty(exports, "maskRelativePath", { enumerable: true, get: function () { return certificate_storage_2.maskRelativePath; } });
var local_certificate_storage_2 = require("./local-certificate-storage");
Object.defineProperty(exports, "LocalCertificateStorage", { enumerable: true, get: function () { return local_certificate_storage_2.LocalCertificateStorage; } });
var sftp_certificate_storage_2 = require("./sftp-certificate-storage");
Object.defineProperty(exports, "SftpCertificateStorage", { enumerable: true, get: function () { return sftp_certificate_storage_2.SftpCertificateStorage; } });
var path_safety_1 = require("./path-safety");
Object.defineProperty(exports, "resolveSafeCertificatePath", { enumerable: true, get: function () { return path_safety_1.resolveSafeCertificatePath; } });
Object.defineProperty(exports, "resolveSafeCertificatePathPosix", { enumerable: true, get: function () { return path_safety_1.resolveSafeCertificatePathPosix; } });
let instance = null;
let closable = null;
function createCertificateStorage() {
    if (env_1.env.CERT_STORAGE_DRIVER === 'sftp') {
        const host = env_1.env.CERT_STORAGE_SFTP_HOST;
        const user = env_1.env.CERT_STORAGE_SFTP_USER;
        const privateKeyPath = env_1.env.CERT_STORAGE_SFTP_PRIVATE_KEY;
        const basePath = env_1.env.CERT_STORAGE_SFTP_BASE_PATH;
        if (!host) {
            throw new certificate_storage_1.CertificateStorageError('CERT_STORAGE_SFTP_HOST não configurado');
        }
        if (!user) {
            throw new certificate_storage_1.CertificateStorageError('CERT_STORAGE_SFTP_USER não configurado');
        }
        if (!(0, sftp_auth_1.isSftpAuthConfigured)({
            sshAuthSock: process.env.SSH_AUTH_SOCK,
            privateKeyPath,
        })) {
            throw new certificate_storage_1.CertificateStorageError('SFTP requer SSH_AUTH_SOCK (ssh-agent) ou CERT_STORAGE_SFTP_PRIVATE_KEY configurado');
        }
        if (!basePath) {
            throw new certificate_storage_1.CertificateStorageError('CERT_STORAGE_SFTP_BASE_PATH não configurado');
        }
        const storage = new sftp_certificate_storage_1.SftpCertificateStorage(basePath, {
            host,
            port: env_1.env.CERT_STORAGE_SFTP_PORT,
            username: user,
            ...(privateKeyPath ? { privateKeyPath } : {}),
        });
        closable = storage;
        return storage;
    }
    closable = null;
    return new local_certificate_storage_1.LocalCertificateStorage(env_1.env.CERT_STORAGE_PATH);
}
function getCertificateStorage() {
    if (!instance) {
        instance = createCertificateStorage();
    }
    return instance;
}
/** Uso em testes: injeta implementação (ex.: LocalCertificateStorage em tmpdir). */
function setCertificateStorageForTests(storage) {
    instance = storage;
    closable = storage;
}
async function closeCertificateStorage() {
    if (closable?.close) {
        await closable.close();
    }
    instance = null;
    closable = null;
}
async function assertCertificateStorageReady() {
    if (env_1.env.CERT_STORAGE_DRIVER === 'sftp') {
        const storage = getCertificateStorage();
        if (storage instanceof sftp_certificate_storage_1.SftpCertificateStorage) {
            await storage.verifyReady();
        }
        return;
    }
    const base = env_1.env.CERT_STORAGE_PATH?.trim();
    if (!base) {
        throw new certificate_storage_1.CertificateStorageError('CERT_STORAGE_PATH não configurado');
    }
    const resolved = path.resolve(base);
    try {
        const stat = await fs.stat(resolved);
        if (!stat.isDirectory()) {
            throw new certificate_storage_1.CertificateStorageError('CERT_STORAGE_PATH não é um diretório acessível');
        }
        await fs.access(resolved, fs_1.constants.R_OK);
    }
    catch (err) {
        if (err instanceof certificate_storage_1.CertificateStorageError)
            throw err;
        throw new certificate_storage_1.CertificateStorageError('CERT_STORAGE_PATH não existe ou não é acessível');
    }
}
async function isCertificateStorageReady() {
    try {
        await assertCertificateStorageReady();
        return true;
    }
    catch {
        return false;
    }
}
function getCertificateStorageDriverLabel() {
    return env_1.env.CERT_STORAGE_DRIVER === 'sftp'
        ? 'SFTP conectado'
        : 'Local filesystem conectado';
}
function getCertificateStorageArchitectureLabel() {
    if (env_1.env.CERT_STORAGE_DRIVER === 'sftp') {
        return 'Prisma→PostgreSQL VPS | SFTP→certificados PFX na VPS';
    }
    return 'Prisma→PostgreSQL VPS | Filesystem local→certificados PFX';
}
//# sourceMappingURL=index.js.map