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

export class UnsafeCertificatePathError extends Error {
  constructor() {
    super('Caminho de certificado inválido');
    this.name = 'UnsafeCertificatePathError';
  }
}

export class CertificateFileNotFoundError extends Error {
  constructor() {
    super('Arquivo de certificado não encontrado');
    this.name = 'CertificateFileNotFoundError';
  }
}

export class CertificateStorageError extends Error {
  constructor(message = 'Falha no armazenamento de certificado') {
    super(message);
    this.name = 'CertificateStorageError';
  }
}

/** Mascara path relativo para logs (nunca o path físico). */
export function maskRelativePath(relativePath: string): string {
  const p = relativePath?.trim() ?? '';
  if (p.length <= 12) return '***';
  return `${p.slice(0, 8)}...${p.slice(-8)}`;
}
