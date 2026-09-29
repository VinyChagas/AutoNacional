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
exports.LocalCertificateStorage = void 0;
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const certificate_storage_1 = require("./certificate-storage");
const path_safety_1 = require("./path-safety");
function fsCode(err) {
    return err?.code;
}
class LocalCertificateStorage {
    basePath;
    realBase = null;
    constructor(basePath) {
        this.basePath = basePath;
        if (!basePath?.trim()) {
            throw new certificate_storage_1.CertificateStorageError('CERT_STORAGE_PATH não configurado');
        }
    }
    async getRealBase() {
        if (this.realBase)
            return this.realBase;
        try {
            this.realBase = await fs.realpath(path.resolve(this.basePath));
        }
        catch {
            throw new certificate_storage_1.CertificateStorageError('CERT_STORAGE_PATH não existe ou não é acessível');
        }
        return this.realBase;
    }
    async resolveInside(relativePath) {
        const base = await this.getRealBase();
        const candidate = (0, path_safety_1.resolveSafeCertificatePath)(base, relativePath);
        return (0, path_safety_1.assertResolvedInsideBase)(base, candidate);
    }
    async save(relativePath, buffer) {
        const fullPath = await this.resolveInside(relativePath);
        try {
            await fs.mkdir(path.dirname(fullPath), { recursive: true });
            await fs.writeFile(fullPath, buffer);
        }
        catch (err) {
            if (err instanceof certificate_storage_1.UnsafeCertificatePathError)
                throw err;
            throw new certificate_storage_1.CertificateStorageError('Falha ao salvar certificado');
        }
    }
    async read(relativePath) {
        const fullPath = await this.resolveInside(relativePath);
        try {
            return await fs.readFile(fullPath);
        }
        catch (err) {
            if (err instanceof certificate_storage_1.UnsafeCertificatePathError)
                throw err;
            if (fsCode(err) === 'ENOENT') {
                throw new certificate_storage_1.CertificateFileNotFoundError();
            }
            throw new certificate_storage_1.CertificateStorageError('Falha ao ler certificado');
        }
    }
    async delete(relativePath) {
        const fullPath = await this.resolveInside(relativePath);
        try {
            await fs.unlink(fullPath);
        }
        catch (err) {
            if (err instanceof certificate_storage_1.UnsafeCertificatePathError)
                throw err;
            if (fsCode(err) === 'ENOENT') {
                return;
            }
            throw new certificate_storage_1.CertificateStorageError('Falha ao excluir certificado');
        }
    }
    async exists(relativePath) {
        const fullPath = await this.resolveInside(relativePath);
        try {
            await fs.access(fullPath);
            return true;
        }
        catch (err) {
            if (err instanceof certificate_storage_1.UnsafeCertificatePathError)
                throw err;
            if (fsCode(err) === 'ENOENT') {
                return false;
            }
            throw new certificate_storage_1.CertificateStorageError('Falha ao verificar certificado');
        }
    }
}
exports.LocalCertificateStorage = LocalCertificateStorage;
//# sourceMappingURL=local-certificate-storage.js.map