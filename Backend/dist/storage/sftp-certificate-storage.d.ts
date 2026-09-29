import { type CertificateStorage } from './certificate-storage';
import { SftpConnectionManager, type SftpConnectionConfig } from './sftp-connection-manager';
export declare class SftpCertificateStorage implements CertificateStorage {
    private readonly connection;
    private readonly basePath;
    constructor(basePath: string, connectionConfig: SftpConnectionConfig, connectionManager?: SftpConnectionManager);
    getConnectionManager(): SftpConnectionManager;
    private resolveInside;
    verifyReady(): Promise<void>;
    close(): Promise<void>;
    save(relativePath: string, buffer: Buffer): Promise<void>;
    read(relativePath: string): Promise<Buffer>;
    delete(relativePath: string): Promise<void>;
    exists(relativePath: string): Promise<boolean>;
}
//# sourceMappingURL=sftp-certificate-storage.d.ts.map