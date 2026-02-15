export interface StoredCertFile {
    buffer: Buffer;
    originalName: string;
}
export declare function createSession(files: Express.Multer.File[]): string;
export declare function getSessionFiles(sessionId: string): StoredCertFile[];
export declare function destroySession(sessionId: string): void;
/**
 * Remove sessões expiradas.
 */
export declare function cleanupExpired(): void;
//# sourceMappingURL=import-session.store.d.ts.map