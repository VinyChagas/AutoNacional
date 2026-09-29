/**
 * Abstração de armazenamento de certificados PFX.
 * Paths persistidos no banco são sempre relativos
 * (ex.: contabilidade/1/empresa/12345678000199/certs/arquivo.pfx).
 * O path físico nunca deve ser gravado no banco nem exposto em API/logs.
 */
export interface CertificateStorage {
    save(relativePath: string, buffer: Buffer): Promise<void>;
    read(relativePath: string): Promise<Buffer>;
    delete(relativePath: string): Promise<void>;
    exists(relativePath: string): Promise<boolean>;
}
export declare class UnsafeCertificatePathError extends Error {
    constructor();
}
export declare class CertificateFileNotFoundError extends Error {
    constructor();
}
export declare class CertificateStorageError extends Error {
    constructor(message?: string);
}
/** Mascara path relativo para logs (nunca o path físico). */
export declare function maskRelativePath(relativePath: string): string;
//# sourceMappingURL=certificate-storage.d.ts.map