import { type CertificateStorage } from './certificate-storage';
export type { CertificateStorage } from './certificate-storage';
export { CertificateFileNotFoundError, CertificateStorageError, UnsafeCertificatePathError, maskRelativePath, } from './certificate-storage';
export { LocalCertificateStorage } from './local-certificate-storage';
export { SftpCertificateStorage } from './sftp-certificate-storage';
export { resolveSafeCertificatePath, resolveSafeCertificatePathPosix, } from './path-safety';
export declare function getCertificateStorage(): CertificateStorage;
/** Uso em testes: injeta implementação (ex.: LocalCertificateStorage em tmpdir). */
export declare function setCertificateStorageForTests(storage: CertificateStorage | null): void;
export declare function closeCertificateStorage(): Promise<void>;
export declare function assertCertificateStorageReady(): Promise<void>;
export declare function isCertificateStorageReady(): Promise<boolean>;
export declare function getCertificateStorageDriverLabel(): string;
export declare function getCertificateStorageArchitectureLabel(): string;
//# sourceMappingURL=index.d.ts.map