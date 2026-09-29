import { type ConnectConfig, type SFTPWrapper } from 'ssh2';
export type SftpConnectionConfig = {
    host: string;
    port: number;
    username: string;
    privateKeyPath?: string;
    connectTimeoutMs?: number;
    keepaliveIntervalMs?: number;
    keepaliveCountMax?: number;
};
export declare class SftpConnectionManager {
    private readonly config;
    private client;
    private sftp;
    private connecting;
    private closed;
    private operationChain;
    constructor(config: SftpConnectionConfig);
    withSftp<T>(operation: (sftp: SFTPWrapper) => Promise<T>): Promise<T>;
    verifyConnection(): Promise<void>;
    close(): Promise<void>;
    private getSftp;
    private connect;
    private disconnect;
}
export declare function buildSftpConnectOptions(config: SftpConnectionConfig): Promise<ConnectConfig>;
//# sourceMappingURL=sftp-connection-manager.d.ts.map