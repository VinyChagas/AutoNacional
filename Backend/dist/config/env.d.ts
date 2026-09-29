export type CertificateStorageDriver = 'local' | 'sftp';
export type EnvConfig = {
    CRYPTO_KEY: string;
    CERT_STORAGE_DRIVER: CertificateStorageDriver;
    CERT_STORAGE_PATH: string;
    CERT_STORAGE_SFTP_HOST: string;
    CERT_STORAGE_SFTP_PORT: number;
    CERT_STORAGE_SFTP_USER: string;
    CERT_STORAGE_SFTP_PRIVATE_KEY: string;
    CERT_STORAGE_SFTP_BASE_PATH: string;
    DATABASE_URL: string;
    FERNET_KEY: string;
    APP_CRED_KEY: string;
    CORS_ORIGINS: string;
    PORT: number;
    NODE_ENV: string;
};
export declare const env: EnvConfig;
export declare function isCertificateStorageConfigured(): boolean;
export declare function describeCertificateStorageTarget(): string;
/**
 * Extrai host e database de DATABASE_URL sem expor senha ou connection string.
 */
export declare function describeDatabaseTarget(databaseUrl?: string): {
    host: string;
    database: string;
};
//# sourceMappingURL=env.d.ts.map