import { CertificateStorageError } from './certificate-storage';

export type SftpAuthMode = 'ssh-agent' | 'private-key';

export type SftpAuthInput = {
  sshAuthSock?: string;
  privateKeyPath?: string;
};

export function resolveSftpAuthMode(
  input: SftpAuthInput = {
    sshAuthSock: process.env.SSH_AUTH_SOCK,
    privateKeyPath: process.env.CERT_STORAGE_SFTP_PRIVATE_KEY,
  }
): SftpAuthMode {
  if (input.sshAuthSock?.trim()) {
    return 'ssh-agent';
  }
  if (input.privateKeyPath?.trim()) {
    return 'private-key';
  }
  throw new CertificateStorageError(
    'SFTP requer SSH_AUTH_SOCK (ssh-agent) ou CERT_STORAGE_SFTP_PRIVATE_KEY configurado'
  );
}

export function isSftpAuthConfigured(
  input: SftpAuthInput = {
    sshAuthSock: process.env.SSH_AUTH_SOCK,
    privateKeyPath: process.env.CERT_STORAGE_SFTP_PRIVATE_KEY,
  }
): boolean {
  return Boolean(input.sshAuthSock?.trim() || input.privateKeyPath?.trim());
}

export function describeSftpAuthMode(mode: SftpAuthMode): string {
  return mode;
}
