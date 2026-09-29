import { type CertificateStorage } from './certificate-storage';
export declare class LocalCertificateStorage implements CertificateStorage {
    private readonly basePath;
    private realBase;
    constructor(basePath: string);
    private getRealBase;
    private resolveInside;
    save(relativePath: string, buffer: Buffer): Promise<void>;
    read(relativePath: string): Promise<Buffer>;
    delete(relativePath: string): Promise<void>;
    exists(relativePath: string): Promise<boolean>;
}
//# sourceMappingURL=local-certificate-storage.d.ts.map