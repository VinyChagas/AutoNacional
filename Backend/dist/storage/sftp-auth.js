"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveSftpAuthMode = resolveSftpAuthMode;
exports.isSftpAuthConfigured = isSftpAuthConfigured;
exports.describeSftpAuthMode = describeSftpAuthMode;
const certificate_storage_1 = require("./certificate-storage");
function resolveSftpAuthMode(input = {
    sshAuthSock: process.env.SSH_AUTH_SOCK,
    privateKeyPath: process.env.CERT_STORAGE_SFTP_PRIVATE_KEY,
}) {
    if (input.sshAuthSock?.trim()) {
        return 'ssh-agent';
    }
    if (input.privateKeyPath?.trim()) {
        return 'private-key';
    }
    throw new certificate_storage_1.CertificateStorageError('SFTP requer SSH_AUTH_SOCK (ssh-agent) ou CERT_STORAGE_SFTP_PRIVATE_KEY configurado');
}
function isSftpAuthConfigured(input = {
    sshAuthSock: process.env.SSH_AUTH_SOCK,
    privateKeyPath: process.env.CERT_STORAGE_SFTP_PRIVATE_KEY,
}) {
    return Boolean(input.sshAuthSock?.trim() || input.privateKeyPath?.trim());
}
function describeSftpAuthMode(mode) {
    return mode;
}
//# sourceMappingURL=sftp-auth.js.map