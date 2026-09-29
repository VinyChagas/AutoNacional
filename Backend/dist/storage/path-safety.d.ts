/**
 * Normaliza e valida um path relativo de certificado (filesystem local).
 * Rejeita absoluto, `..`, null bytes e escape da pasta base.
 * Retorna o path absoluto resolvido — uso interno apenas; não logar/devolver.
 */
export declare function resolveSafeCertificatePath(baseDir: string, relativePath: string): string;
/**
 * Variante POSIX para paths remotos (SFTP/Linux).
 */
export declare function resolveSafeCertificatePathPosix(baseDir: string, relativePath: string): string;
export declare function assertResolvedInsideBase(baseDir: string, candidate: string): Promise<string>;
/**
 * Valida que o path remoto resolvido permanece dentro da base POSIX (SFTP).
 */
export declare function assertResolvedInsidePosixBase(baseDir: string, candidate: string): string;
//# sourceMappingURL=path-safety.d.ts.map