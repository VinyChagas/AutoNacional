import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { LocalCertificateStorage } from './local-certificate-storage';
import {
  CertificateFileNotFoundError,
  UnsafeCertificatePathError,
} from './certificate-storage';
import { resolveSafeCertificatePath } from './path-safety';

const SAMPLE = Buffer.from('pfx-test-bytes-not-a-real-certificate');

describe('LocalCertificateStorage', () => {
  let dir: string;
  let storage: LocalCertificateStorage;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'cert-storage-'));
    storage = new LocalCertificateStorage(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('escreve e lê arquivo existente', async () => {
    const relative = 'contabilidade/1/empresa/12345678000199/certs/arquivo.pfx';
    await storage.save(relative, SAMPLE);
    const read = await storage.read(relative);
    expect(Buffer.compare(read, SAMPLE)).toBe(0);
    const onDisk = await readFile(path.join(dir, relative));
    expect(Buffer.compare(onDisk, SAMPLE)).toBe(0);
  });

  it('exists() retorna true após escrita e false para arquivo inexistente', async () => {
    const relative = 'empresa/12345678000199/certs/novo.pfx';
    expect(await storage.exists(relative)).toBe(false);
    await storage.save(relative, SAMPLE);
    expect(await storage.exists(relative)).toBe(true);
  });

  it('exclui arquivo existente', async () => {
    const relative = 'empresa/12345678000199/certs/apagar.pfx';
    await storage.save(relative, SAMPLE);
    await storage.delete(relative);
    expect(await storage.exists(relative)).toBe(false);
  });

  it('delete de arquivo inexistente não lança', async () => {
    await expect(
      storage.delete('empresa/00000000000000/certs/ausente.pfx')
    ).resolves.toBeUndefined();
  });

  it('read de arquivo inexistente lança CertificateFileNotFoundError', async () => {
    await expect(
      storage.read('empresa/00000000000000/certs/ausente.pfx')
    ).rejects.toBeInstanceOf(CertificateFileNotFoundError);
  });

  it('não persiste path absoluto no destino — só o relativo sob a pasta base', async () => {
    const relative = 'contabilidade/2/empresa/11111111000191/certs/x.pfx';
    await storage.save(relative, SAMPLE);
    const full = path.join(dir, relative);
    expect(full.startsWith(dir)).toBe(true);
    expect(full).not.toBe(relative);
  });
});

describe('path traversal bloqueado', () => {
  let dir: string;
  let storage: LocalCertificateStorage;
  let outside: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'cert-storage-base-'));
    outside = await mkdtemp(path.join(tmpdir(), 'cert-storage-out-'));
    await writeFile(path.join(outside, 'secret.pfx'), SAMPLE);
    storage = new LocalCertificateStorage(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  const attacks = [
    '../secret.pfx',
    '../../etc/passwd',
    '/etc/passwd',
    'contabilidade/1/../../../etc/passwd',
    'foo/../../outside.pfx',
    '..\\secret.pfx',
    '/srv/data/autonacional/certificados/../etc/passwd',
    '//etc/passwd',
    'contabilidade/1/empresa/../../../../secret.pfx',
  ];

  it.each(attacks)('rejeita %s em save/read/delete/exists', async (attack) => {
    await expect(storage.save(attack, SAMPLE)).rejects.toBeInstanceOf(
      UnsafeCertificatePathError
    );
    await expect(storage.read(attack)).rejects.toBeInstanceOf(
      UnsafeCertificatePathError
    );
    await expect(storage.delete(attack)).rejects.toBeInstanceOf(
      UnsafeCertificatePathError
    );
    await expect(storage.exists(attack)).rejects.toBeInstanceOf(
      UnsafeCertificatePathError
    );
    expect(resolveSafeCertificatePath.bind(null, dir, attack)).toThrow(
      UnsafeCertificatePathError
    );
  });

  it('não permite ler arquivo fora da pasta base via ..', async () => {
    await expect(storage.read(`../${path.basename(outside)}/secret.pfx`)).rejects.toBeInstanceOf(
      UnsafeCertificatePathError
    );
  });

  it('mensagens de erro não incluem path físico', async () => {
    try {
      await storage.read('../secret.pfx');
      throw new Error('deveria ter lançado');
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).not.toContain(dir);
      expect(msg).not.toContain(outside);
      expect(msg.toLowerCase()).not.toContain('secret.pfx');
    }
  });
});

describe('resolveSafeCertificatePath', () => {
  it('aceita path relativo padronizado', () => {
    const base = path.join(tmpdir(), 'cert-base-ok');
    const resolved = resolveSafeCertificatePath(
      base,
      'contabilidade/1/empresa/12345678000199/certs/arquivo.pfx'
    );
    expect(resolved.startsWith(path.resolve(base))).toBe(true);
    expect(resolved).toContain('arquivo.pfx');
  });

  it('rejeita path vazio e a própria pasta base', () => {
    const base = path.join(tmpdir(), 'cert-base-empty');
    expect(() => resolveSafeCertificatePath(base, '')).toThrow(
      UnsafeCertificatePathError
    );
    expect(() => resolveSafeCertificatePath(base, '.')).toThrow(
      UnsafeCertificatePathError
    );
    expect(() => resolveSafeCertificatePath(base, '/')).toThrow(
      UnsafeCertificatePathError
    );
  });
});
