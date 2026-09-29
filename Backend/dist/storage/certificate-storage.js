"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CertificateStorageError = exports.CertificateFileNotFoundError = exports.UnsafeCertificatePathError = void 0;
exports.maskRelativePath = maskRelativePath;
class UnsafeCertificatePathError extends Error {
    constructor() {
        super('Caminho de certificado inválido');
        this.name = 'UnsafeCertificatePathError';
    }
}
exports.UnsafeCertificatePathError = UnsafeCertificatePathError;
class CertificateFileNotFoundError extends Error {
    constructor() {
        super('Arquivo de certificado não encontrado');
        this.name = 'CertificateFileNotFoundError';
    }
}
exports.CertificateFileNotFoundError = CertificateFileNotFoundError;
class CertificateStorageError extends Error {
    constructor(message = 'Falha no armazenamento de certificado') {
        super(message);
        this.name = 'CertificateStorageError';
    }
}
exports.CertificateStorageError = CertificateStorageError;
/** Mascara path relativo para logs (nunca o path físico). */
function maskRelativePath(relativePath) {
    const p = relativePath?.trim() ?? '';
    if (p.length <= 12)
        return '***';
    return `${p.slice(0, 8)}...${p.slice(-8)}`;
}
//# sourceMappingURL=certificate-storage.js.map