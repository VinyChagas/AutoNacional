import { afterEach, describe, expect, it } from 'vitest';
import { CertificateStorageError } from './certificate-storage';
import {
  describeSftpAuthMode,
  isSftpAuthConfigured,
  resolveSftpAuthMode,
} from './sftp-auth';
import { buildSftpConnectOptions } from './sftp-connection-manager';

describe('resolveSftpAuthMode', () => {
  it('SSH_AUTH_SOCK presente + private key ausente → válido (ssh-agent)', () => {
    expect(
      resolveSftpAuthMode({
        sshAuthSock: '/tmp/ssh-agent.sock',
        privateKeyPath: '',
      })
    ).toBe('ssh-agent');
    expect(
      isSftpAuthConfigured({
        sshAuthSock: '/tmp/ssh-agent.sock',
        privateKeyPath: '',
      })
    ).toBe(true);
  });

  it('SSH_AUTH_SOCK ausente + private key presente → válido (private-key)', () => {
    expect(
      resolveSftpAuthMode({
        sshAuthSock: '',
        privateKeyPath: '/home/user/.ssh/id_ed25519',
      })
    ).toBe('private-key');
    expect(
      isSftpAuthConfigured({
        sshAuthSock: '',
        privateKeyPath: '/home/user/.ssh/id_ed25519',
      })
    ).toBe(true);
  });

  it('ambos ausentes → erro', () => {
    expect(() =>
      resolveSftpAuthMode({
        sshAuthSock: '',
        privateKeyPath: '',
      })
    ).toThrow(CertificateStorageError);
    expect(
      isSftpAuthConfigured({
        sshAuthSock: '',
        privateKeyPath: '',
      })
    ).toBe(false);
  });

  it('prioriza ssh-agent quando ambos estão presentes', () => {
    expect(
      resolveSftpAuthMode({
        sshAuthSock: '/tmp/ssh-agent.sock',
        privateKeyPath: '/home/user/.ssh/id_ed25519',
      })
    ).toBe('ssh-agent');
  });

  it('describeSftpAuthMode não expõe secrets', () => {
    expect(describeSftpAuthMode('ssh-agent')).toBe('ssh-agent');
    expect(describeSftpAuthMode('private-key')).toBe('private-key');
    expect(describeSftpAuthMode('ssh-agent')).not.toContain('/tmp');
  });
});

describe('buildSftpConnectOptions', () => {
  const baseConfig = {
    host: 'example.com',
    port: 22,
    username: 'user',
  };

  afterEach(() => {
    delete process.env.SSH_AUTH_SOCK;
  });

  it('com ssh-agent, privateKey não é incluída nas opções de conexão', async () => {
    process.env.SSH_AUTH_SOCK = '/tmp/ssh-agent-test.sock';

    const options = await buildSftpConnectOptions({
      ...baseConfig,
      privateKeyPath: '/should/not/be/read',
    });

    expect(options.agent).toBe('/tmp/ssh-agent-test.sock');
    expect(options.privateKey).toBeUndefined();
    expect(String(options.agent)).not.toContain('should/not/be/read');
  });
});
