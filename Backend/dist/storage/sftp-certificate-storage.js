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
exports.SftpCertificateStorage = void 0;
const path = __importStar(require("path"));
const certificate_storage_1 = require("./certificate-storage");
const path_safety_1 = require("./path-safety");
const sftp_connection_manager_1 = require("./sftp-connection-manager");
const SSH_FX_NO_SUCH_FILE = 2;
function sftpErrCode(err) {
    return err?.code;
}
function isNotFound(err) {
    return sftpErrCode(err) === SSH_FX_NO_SUCH_FILE;
}
function promisify(fn) {
    return new Promise((resolve, reject) => {
        fn((err, result) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(result);
        });
    });
}
async function sftpReadFile(sftp, remotePath) {
    return promisify((cb) => sftp.readFile(remotePath, cb));
}
async function sftpWriteFile(sftp, remotePath, data) {
    await promisify((cb) => sftp.writeFile(remotePath, data, cb));
}
async function sftpUnlink(sftp, remotePath) {
    await promisify((cb) => sftp.unlink(remotePath, cb));
}
async function sftpStat(sftp, remotePath) {
    return promisify((cb) => sftp.stat(remotePath, cb));
}
async function sftpMkdir(sftp, remotePath) {
    await promisify((cb) => sftp.mkdir(remotePath, cb));
}
async function ensureRemoteDir(sftp, remoteDir) {
    const normalized = path.posix.normalize(remoteDir);
    if (normalized === '/' || normalized === '.') {
        return;
    }
    try {
        const stats = await sftpStat(sftp, normalized);
        if (stats.isDirectory()) {
            return;
        }
        throw new certificate_storage_1.CertificateStorageError('Falha ao salvar certificado');
    }
    catch (err) {
        if (!(err instanceof certificate_storage_1.CertificateStorageError) && !isNotFound(err)) {
            throw new certificate_storage_1.CertificateStorageError('Falha ao salvar certificado');
        }
        if (err instanceof certificate_storage_1.CertificateStorageError) {
            throw err;
        }
    }
    const parent = path.posix.dirname(normalized);
    if (parent && parent !== '.' && parent !== normalized) {
        await ensureRemoteDir(sftp, parent);
    }
    try {
        await sftpMkdir(sftp, normalized);
    }
    catch {
        try {
            const stats = await sftpStat(sftp, normalized);
            if (!stats.isDirectory()) {
                throw new certificate_storage_1.CertificateStorageError('Falha ao salvar certificado');
            }
        }
        catch (innerErr) {
            if (innerErr instanceof certificate_storage_1.CertificateStorageError)
                throw innerErr;
            throw new certificate_storage_1.CertificateStorageError('Falha ao salvar certificado');
        }
    }
}
class SftpCertificateStorage {
    connection;
    basePath;
    constructor(basePath, connectionConfig, connectionManager) {
        const trimmedBase = basePath?.trim();
        if (!trimmedBase) {
            throw new certificate_storage_1.CertificateStorageError('CERT_STORAGE_SFTP_BASE_PATH não configurado');
        }
        this.basePath = path.posix.resolve(trimmedBase.replace(/\\/g, '/'));
        this.connection =
            connectionManager ?? new sftp_connection_manager_1.SftpConnectionManager(connectionConfig);
    }
    getConnectionManager() {
        return this.connection;
    }
    resolveInside(relativePath) {
        const candidate = (0, path_safety_1.resolveSafeCertificatePathPosix)(this.basePath, relativePath);
        return (0, path_safety_1.assertResolvedInsidePosixBase)(this.basePath, candidate);
    }
    async verifyReady() {
        await this.connection.withSftp(async (sftp) => {
            const stats = await sftpStat(sftp, this.basePath);
            if (!stats.isDirectory()) {
                throw new certificate_storage_1.CertificateStorageError('CERT_STORAGE_SFTP_BASE_PATH não é um diretório acessível');
            }
        });
    }
    async close() {
        await this.connection.close();
    }
    async save(relativePath, buffer) {
        const remotePath = this.resolveInside(relativePath);
        const remoteDir = path.posix.dirname(remotePath);
        try {
            await this.connection.withSftp(async (sftp) => {
                await ensureRemoteDir(sftp, remoteDir);
                await sftpWriteFile(sftp, remotePath, buffer);
            });
        }
        catch (err) {
            if (err instanceof certificate_storage_1.UnsafeCertificatePathError)
                throw err;
            throw new certificate_storage_1.CertificateStorageError('Falha ao salvar certificado');
        }
    }
    async read(relativePath) {
        const remotePath = this.resolveInside(relativePath);
        try {
            return await this.connection.withSftp(async (sftp) => sftpReadFile(sftp, remotePath));
        }
        catch (err) {
            if (err instanceof certificate_storage_1.UnsafeCertificatePathError)
                throw err;
            if (isNotFound(err)) {
                throw new certificate_storage_1.CertificateFileNotFoundError();
            }
            throw new certificate_storage_1.CertificateStorageError('Falha ao ler certificado');
        }
    }
    async delete(relativePath) {
        const remotePath = this.resolveInside(relativePath);
        try {
            await this.connection.withSftp(async (sftp) => {
                await sftpUnlink(sftp, remotePath);
            });
        }
        catch (err) {
            if (err instanceof certificate_storage_1.UnsafeCertificatePathError)
                throw err;
            if (isNotFound(err)) {
                return;
            }
            throw new certificate_storage_1.CertificateStorageError('Falha ao excluir certificado');
        }
    }
    async exists(relativePath) {
        const remotePath = this.resolveInside(relativePath);
        try {
            await this.connection.withSftp(async (sftp) => {
                await sftpStat(sftp, remotePath);
            });
            return true;
        }
        catch (err) {
            if (err instanceof certificate_storage_1.UnsafeCertificatePathError)
                throw err;
            if (isNotFound(err)) {
                return false;
            }
            throw new certificate_storage_1.CertificateStorageError('Falha ao verificar certificado');
        }
    }
}
exports.SftpCertificateStorage = SftpCertificateStorage;
//# sourceMappingURL=sftp-certificate-storage.js.map