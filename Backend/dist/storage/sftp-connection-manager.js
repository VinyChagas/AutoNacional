"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SftpConnectionManager = void 0;
exports.buildSftpConnectOptions = buildSftpConnectOptions;
const promises_1 = require("fs/promises");
const ssh2_1 = require("ssh2");
const certificate_storage_1 = require("./certificate-storage");
const sftp_auth_1 = require("./sftp-auth");
const DEFAULT_CONNECT_TIMEOUT_MS = 30_000;
const DEFAULT_KEEPALIVE_INTERVAL_MS = 10_000;
const DEFAULT_KEEPALIVE_COUNT_MAX = 3;
function isConnectionError(err) {
    const message = err?.message?.toLowerCase() ?? '';
    const code = err?.code;
    return (code === 'ECONNRESET' ||
        code === 'EPIPE' ||
        code === 'ETIMEDOUT' ||
        code === 'ENOTCONN' ||
        message.includes('not connected') ||
        message.includes('connection lost') ||
        message.includes('connection closed'));
}
function sanitizeAuthError(err) {
    const message = err?.message?.toLowerCase() ?? '';
    if (message.includes('passphrase') ||
        message.includes('encrypted') ||
        message.includes('authentication')) {
        return new certificate_storage_1.CertificateStorageError('Falha de autenticação SFTP. Se a chave SSH tiver passphrase, adicione-a ao ssh-agent com `ssh-add` antes de iniciar o Backend (não grave passphrase no .env).');
    }
    return new certificate_storage_1.CertificateStorageError('Falha ao conectar via SFTP');
}
class SftpConnectionManager {
    config;
    client = null;
    sftp = null;
    connecting = null;
    closed = false;
    operationChain = Promise.resolve();
    constructor(config) {
        this.config = config;
    }
    async withSftp(operation) {
        if (this.closed) {
            throw new certificate_storage_1.CertificateStorageError('Conexão SFTP encerrada');
        }
        const run = async () => {
            try {
                const sftp = await this.getSftp();
                return await operation(sftp);
            }
            catch (err) {
                if (isConnectionError(err)) {
                    await this.disconnect();
                    const sftp = await this.getSftp();
                    return await operation(sftp);
                }
                throw err;
            }
        };
        const result = this.operationChain.then(run, run);
        this.operationChain = result.then(() => undefined, () => undefined);
        return result;
    }
    async verifyConnection() {
        await this.withSftp(async (sftp) => {
            await sftpStat(sftp, '.');
        });
    }
    async close() {
        this.closed = true;
        await this.disconnect();
    }
    async getSftp() {
        if (this.closed) {
            throw new certificate_storage_1.CertificateStorageError('Conexão SFTP encerrada');
        }
        if (this.sftp) {
            return this.sftp;
        }
        if (this.connecting) {
            return this.connecting;
        }
        this.connecting = this.connect();
        try {
            return await this.connecting;
        }
        finally {
            this.connecting = null;
        }
    }
    async connect() {
        const connectOptions = await buildSftpConnectOptions(this.config);
        const client = new ssh2_1.Client();
        const sftp = await new Promise((resolve, reject) => {
            const timeoutMs = this.config.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
            const timer = setTimeout(() => {
                client.end();
                reject(new certificate_storage_1.CertificateStorageError('Timeout ao conectar via SFTP'));
            }, timeoutMs);
            client
                .on('ready', () => {
                client.sftp((err, sftpSession) => {
                    clearTimeout(timer);
                    if (err) {
                        client.end();
                        reject(sanitizeAuthError(err));
                        return;
                    }
                    resolve(sftpSession);
                });
            })
                .on('error', (err) => {
                clearTimeout(timer);
                reject(sanitizeAuthError(err));
            })
                .connect(connectOptions);
        });
        client.on('close', () => {
            this.sftp = null;
            this.client = null;
        });
        client.on('error', () => {
            this.sftp = null;
            this.client = null;
        });
        this.client = client;
        this.sftp = sftp;
        return sftp;
    }
    async disconnect() {
        const client = this.client;
        this.client = null;
        this.sftp = null;
        if (!client)
            return;
        await new Promise((resolve) => {
            client.once('close', () => resolve());
            client.end();
            setTimeout(resolve, 2_000);
        });
    }
}
exports.SftpConnectionManager = SftpConnectionManager;
function sftpStat(sftp, remotePath) {
    return new Promise((resolve, reject) => {
        sftp.stat(remotePath, (err, stats) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(stats);
        });
    });
}
async function buildSftpConnectOptions(config) {
    const authMode = (0, sftp_auth_1.resolveSftpAuthMode)({
        sshAuthSock: process.env.SSH_AUTH_SOCK,
        privateKeyPath: config.privateKeyPath,
    });
    const connectOptions = {
        host: config.host,
        port: config.port,
        username: config.username,
        keepaliveInterval: config.keepaliveIntervalMs ?? DEFAULT_KEEPALIVE_INTERVAL_MS,
        keepaliveCountMax: config.keepaliveCountMax ?? DEFAULT_KEEPALIVE_COUNT_MAX,
        readyTimeout: config.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
    };
    if (authMode === 'ssh-agent') {
        connectOptions.agent = process.env.SSH_AUTH_SOCK;
        return connectOptions;
    }
    const privateKeyPath = config.privateKeyPath?.trim();
    if (!privateKeyPath) {
        throw new certificate_storage_1.CertificateStorageError('SFTP requer SSH_AUTH_SOCK (ssh-agent) ou CERT_STORAGE_SFTP_PRIVATE_KEY configurado');
    }
    connectOptions.privateKey = await (0, promises_1.readFile)(privateKeyPath, 'utf8');
    return connectOptions;
}
//# sourceMappingURL=sftp-connection-manager.js.map