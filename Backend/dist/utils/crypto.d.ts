/**
 * Criptografa string com AES-256-GCM.
 * Formato armazenado: iv_base64:authTag_base64:ciphertext_base64
 */
export declare function encrypt(plain: string): string;
/**
 * Descriptografa string criptografada com encrypt().
 * Compatível com formato iv:authTag:data (base64).
 */
export declare function decrypt(encrypted: string): string;
//# sourceMappingURL=crypto.d.ts.map