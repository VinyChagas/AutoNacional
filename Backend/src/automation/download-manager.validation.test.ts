import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { validarArquivoBaixado, removerArquivoInvalido } from './download-manager';

describe('validarArquivoBaixado', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'an-dl-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('aceita PDF com assinatura %PDF', async () => {
    const p = path.join(dir, 'nota.pdf');
    await fs.writeFile(p, Buffer.from('%PDF-1.4\n%content'));
    const r = await validarArquivoBaixado(p, 'pdf');
    expect(r.valid).toBe(true);
  });

  it('rejeita PDF sem assinatura', async () => {
    const p = path.join(dir, 'fake.pdf');
    await fs.writeFile(p, Buffer.from('<html>erro</html>'));
    const r = await validarArquivoBaixado(p, 'pdf');
    expect(r.valid).toBe(false);
  });

  it('aceita XML valido', async () => {
    const p = path.join(dir, 'nota.xml');
    await fs.writeFile(p, '<?xml version="1.0"?><nfeProc></nfeProc>');
    const r = await validarArquivoBaixado(p, 'xml');
    expect(r.valid).toBe(true);
  });

  it('rejeita HTML salvo como XML', async () => {
    const p = path.join(dir, 'erro.xml');
    await fs.writeFile(p, '<!DOCTYPE html><html><body>erro</body></html>');
    const r = await validarArquivoBaixado(p, 'xml');
    expect(r.valid).toBe(false);
  });

  it('remove arquivo invalido', async () => {
    const p = path.join(dir, 'x.bin');
    await fs.writeFile(p, 'x');
    await removerArquivoInvalido(p);
    await expect(fs.access(p)).rejects.toBeTruthy();
  });
});
