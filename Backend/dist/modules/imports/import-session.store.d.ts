import type { PreviewCertAction } from './import-certificados-classify';
export interface StoredCertFile {
    buffer: Buffer;
    originalName: string;
}
export interface SessionPreviewMetaItem {
    indice: number;
    action: PreviewCertAction;
    can_confirm: boolean;
    cnpj: string;
    existing_cert_id: number | null;
    existing_arquivo: string | null;
    incoming_thumbprint: string | null;
    incoming_serial: string | null;
    incoming_valid_until: string | null;
    existing_valid_until: string | null;
    days_delta: number | null;
    message: string;
}
interface SessionMeta {
    preview: SessionPreviewMetaItem[];
    processed: number[];
}
export declare function createSession(files: Express.Multer.File[]): string;
export declare function getSessionFiles(sessionId: string): StoredCertFile[];
export declare function saveSessionMeta(sessionId: string, meta: SessionMeta): void;
export declare function loadSessionMeta(sessionId: string): SessionMeta;
export declare function markIndicesProcessed(sessionId: string, indices: number[]): void;
export declare function destroySession(sessionId: string): void;
/**
 * Remove sessões expiradas.
 */
export declare function cleanupExpired(): void;
export {};
//# sourceMappingURL=import-session.store.d.ts.map