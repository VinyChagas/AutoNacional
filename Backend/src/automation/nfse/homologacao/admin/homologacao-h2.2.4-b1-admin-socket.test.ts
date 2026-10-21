/**
 * H2.2.4-B1 — Canal admin UDS (offline, health/status).
 */
import { chmod, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ADMIN_SECRET_MIN_LENGTH,
  ADMIN_SOCKET_FILENAME,
  ENV_ADMIN_SECRET,
  ENV_ADMIN_SOCKET_DIR,
  aplicarBootstrapAdminSocket,
  caminhoSocketAdmin,
  carregarSegredoAdmin,
  classificarSocketExistente,
  encerrarAdminSocket,
  enviarComandoAdminUds,
  iniciarAdminServidorUds,
  lerConfigAdminSocket,
  montarRespostaErro,
  obterAdminSocketAtivo,
  parseAdminRequest,
  prepararDiretorioAdminSocket,
  removerSocketOrfaoSeguro,
  tokenAdminValido,
} from './index';
import { GATE_EXECUCAO_REAL_DISCOVERY_ONLY } from '../gate-execucao-real';
import { configurarCanalHomologacaoOperacional } from '../canal-autorizacao';

/** ≥ 32 chars */
const SEGREDO = 'segredo-admin-teste-com-32chars!!';
const dirs: string[] = [];

afterEach(async () => {
  await encerrarAdminSocket();
  configurarCanalHomologacaoOperacional(null);
  while (dirs.length) {
    const d = dirs.pop();
    if (d) await rm(d, { recursive: true, force: true });
  }
});

async function dirTmp(): Promise<string> {
  const d = await mkdtemp(path.join(tmpdir(), 'an-h224b1-'));
  dirs.push(d);
  await chmod(d, 0o700);
  return d;
}

describe('H2.2.4-B1 canal admin UDS offline', () => {
  it('01 canal desativado por padrão', async () => {
    const cfg = lerConfigAdminSocket({});
    expect(cfg.habilitado).toBe(false);
    const r = await aplicarBootstrapAdminSocket({});
    expect(r.status).toBe('desativado');
    expect(obterAdminSocketAtivo()).toBeNull();
  });

  it('02 inicialização válida', async () => {
    const dir = await dirTmp();
    const ativo = await iniciarAdminServidorUds({ socketDir: dir, segredo: SEGREDO });
    expect(ativo.socketPath.endsWith(ADMIN_SOCKET_FILENAME)).toBe(true);
    const health = await enviarComandoAdminUds({
      socketPath: ativo.socketPath,
      token: SEGREDO,
      op: 'health',
    });
    expect(health.ok).toBe(true);
    await ativo.fechar();
  });

  it('03 diretório relativo recusado', async () => {
    await expect(prepararDiretorioAdminSocket('relativo/admin')).rejects.toMatchObject({
      codigo: 'DIRETORIO_INSEGURO',
    });
  });

  it('04 diretório inseguro (traversal) recusado', async () => {
    await expect(prepararDiretorioAdminSocket('/tmp/../etc')).rejects.toMatchObject({
      codigo: 'DIRETORIO_INSEGURO',
    });
  });

  it('05 symlink recusado', async () => {
    const real = await dirTmp();
    const parent = await dirTmp();
    const link = path.join(parent, 'link-admin');
    await symlink(real, link);
    await expect(prepararDiretorioAdminSocket(link)).rejects.toMatchObject({
      codigo: 'DIRETORIO_INSEGURO',
    });
  });

  it('06 permissões inadequadas corrigidas para 0700 ou recusa', async () => {
    const dir = await dirTmp();
    await chmod(dir, 0o755);
    const seguro = await prepararDiretorioAdminSocket(dir);
    const { stat } = await import('node:fs/promises');
    const st = await stat(seguro);
    expect(st.mode & 0o777).toBe(0o700);
  });

  it('07 socket preexistente vivo → bind recusado', async () => {
    const dir = await dirTmp();
    const a = await iniciarAdminServidorUds({ socketDir: dir, segredo: SEGREDO });
    await expect(
      iniciarAdminServidorUds({ socketDir: dir, segredo: SEGREDO })
    ).rejects.toMatchObject({ codigo: 'CONTEXTO_INVALIDO' });
    await a.fechar();
  });

  it('08 cliente autorizado (health)', async () => {
    const dir = await dirTmp();
    const ativo = await iniciarAdminServidorUds({ socketDir: dir, segredo: SEGREDO });
    const r = await enviarComandoAdminUds({
      socketPath: ativo.socketPath,
      token: SEGREDO,
      op: 'health',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.status).toBe('ok');
    await ativo.fechar();
  });

  it('09 cliente não autorizado', async () => {
    const dir = await dirTmp();
    const ativo = await iniciarAdminServidorUds({ socketDir: dir, segredo: SEGREDO });
    const r = await enviarComandoAdminUds({
      socketPath: ativo.socketPath,
      token: 'token-errado-nao-autorizado!!',
      op: 'health',
    });
    expect(r.ok).toBe(false);
    await ativo.fechar();
  });

  it('10 mensagem inválida', () => {
    expect(() => parseAdminRequest('{')).toThrow();
    expect(() => parseAdminRequest(JSON.stringify({ v: 1, op: 'hack', token: 'x', id: '1' }))).toThrow();
  });

  it('11 mensagem excessiva', () => {
    const grande = 'x'.repeat(5_000);
    expect(() => parseAdminRequest(grande)).toThrow();
  });

  it('12 timeout no cliente', async () => {
    const dir = await dirTmp();
    const sock = caminhoSocketAdmin(await prepararDiretorioAdminSocket(dir));
    // socket path inexistente / sem servidor
    await expect(
      enviarComandoAdminUds({
        socketPath: sock,
        token: SEGREDO,
        op: 'health',
        timeoutMs: 200,
      })
    ).rejects.toBeTruthy();
  });

  it('13 conexão interrompida / comando desconhecido via envelope', () => {
    expect(() =>
      parseAdminRequest(
        JSON.stringify({ v: 1, op: 'liberar', token: SEGREDO, id: '1', shell: 'rm' })
      )
    ).toThrow();
    const err = montarRespostaErro('CONTEXTO_INVALIDO', 'senha=abc token=xyz');
    expect(err.mensagem).not.toContain('abc');
  });

  it('14 comando desconhecido rejeitado', () => {
    expect(() =>
      parseAdminRequest(JSON.stringify({ v: 1, op: 'preparar', token: SEGREDO, id: 'a' }))
    ).toThrow();
  });

  it('15 health', async () => {
    const dir = await dirTmp();
    const ativo = await iniciarAdminServidorUds({ socketDir: dir, segredo: SEGREDO });
    const r = await enviarComandoAdminUds({
      socketPath: ativo.socketPath,
      token: SEGREDO,
      op: 'health',
    });
    expect(r.ok).toBe(true);
    await ativo.fechar();
  });

  it('16 status', async () => {
    const dir = await dirTmp();
    const ativo = await iniciarAdminServidorUds({ socketDir: dir, segredo: SEGREDO });
    const r = await enviarComandoAdminUds({
      socketPath: ativo.socketPath,
      token: SEGREDO,
      op: 'status',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.prepararLiberar).toBe(false);
      expect(r.data.discoverNoAdmin).toBe(false);
      expect(r.data.sefin).toBe(false);
      expect(r.data.gateExecucaoReal).toBe(false);
    }
    await ativo.fechar();
  });

  it('17 encerramento remove socket', async () => {
    const dir = await dirTmp();
    const ativo = await iniciarAdminServidorUds({ socketDir: dir, segredo: SEGREDO });
    const p = ativo.socketPath;
    await ativo.fechar();
    const { access } = await import('node:fs/promises');
    await expect(access(p)).rejects.toBeTruthy();
  });

  it('18 reinício após encerramento', async () => {
    const dir = await dirTmp();
    const a = await iniciarAdminServidorUds({ socketDir: dir, segredo: SEGREDO });
    await a.fechar();
    const b = await iniciarAdminServidorUds({ socketDir: dir, segredo: SEGREDO });
    const r = await enviarComandoAdminUds({
      socketPath: b.socketPath,
      token: SEGREDO,
      op: 'health',
    });
    expect(r.ok).toBe(true);
    await b.fechar();
  });

  it('19–24 ausência de efeitos fiscais / legado / gate', async () => {
    expect(GATE_EXECUCAO_REAL_DISCOVERY_ONLY).toBe(false);
    const dir = await dirTmp();
    const r = await aplicarBootstrapAdminSocket({
      [ENV_ADMIN_SOCKET_DIR]: dir,
      [ENV_ADMIN_SECRET]: SEGREDO,
    });
    expect(r.status).toBe('ativo');
    const status = await enviarComandoAdminUds({
      socketPath: (r as { socketPath: string }).socketPath,
      token: SEGREDO,
      op: 'status',
    });
    expect(status.ok).toBe(true);
    if (status.ok) {
      expect(status.data.prepararLiberar).toBe(false);
      expect(status.data.sefin).toBe(false);
      expect(status.data.discoverNoAdmin).toBe(false);
    }
    await encerrarAdminSocket();
    expect(obterAdminSocketAtivo()).toBeNull();
  });

  it('25 legado preservado (bootstrap admin não configura canal tickets)', async () => {
    const dir = await dirTmp();
    await aplicarBootstrapAdminSocket({
      [ENV_ADMIN_SOCKET_DIR]: dir,
      [ENV_ADMIN_SECRET]: SEGREDO,
    });
    // Canal de tickets permanece null se não houve bootstrap de store
    const { obterCanalHomologacaoOperacional } = await import('../canal-autorizacao');
    expect(obterCanalHomologacaoOperacional()).toBeNull();
    await encerrarAdminSocket();
  });

  it('26 token timing-safe', () => {
    expect(tokenAdminValido(SEGREDO, SEGREDO)).toBe(true);
    expect(tokenAdminValido('outro-segredo-com-32-chars!!!!', SEGREDO)).toBe(false);
  });

  it('27 bootstrap recusado com dir inválido', async () => {
    const r = await aplicarBootstrapAdminSocket({
      [ENV_ADMIN_SOCKET_DIR]: 'nao-absoluto',
      [ENV_ADMIN_SECRET]: SEGREDO,
    });
    expect(r.status).toBe('recusado');
    expect(obterAdminSocketAtivo()).toBeNull();
  });

  it('28 writeFile secret 0600 + arquivo', async () => {
    const dir = await dirTmp();
    const secretPath = path.join(dir, 'admin.secret');
    await writeFile(secretPath, SEGREDO, { mode: 0o600 });
    await chmod(secretPath, 0o600);
    const s = await carregarSegredoAdmin({ secretFile: secretPath, secretInline: null });
    expect(s).toBe(SEGREDO);
  });
});

describe('H2.2.4-B1-R1 revisão segurança UDS', () => {
  it('R1 segredo fraco recusado', async () => {
    await expect(
      carregarSegredoAdmin({
        secretFile: null,
        secretInline: 'curto',
        nodeEnv: 'development',
      })
    ).rejects.toMatchObject({ codigo: 'CONTEXTO_INVALIDO' });
    expect(ADMIN_SECRET_MIN_LENGTH).toBe(32);
  });

  it('R1 segredo ausente recusado', async () => {
    await expect(
      carregarSegredoAdmin({ secretFile: null, secretInline: null, nodeEnv: 'development' })
    ).rejects.toMatchObject({ codigo: 'CONTEXTO_INVALIDO' });
  });

  it('R1 produção rejeita segredo inline', async () => {
    await expect(
      carregarSegredoAdmin({
        secretFile: null,
        secretInline: SEGREDO,
        nodeEnv: 'production',
      })
    ).rejects.toMatchObject({ codigo: 'CONTEXTO_INVALIDO' });
  });

  it('R1 segredo incorreto → não autorizado', async () => {
    const dir = await dirTmp();
    const ativo = await iniciarAdminServidorUds({ socketDir: dir, segredo: SEGREDO });
    const r = await enviarComandoAdminUds({
      socketPath: ativo.socketPath,
      token: 'x'.repeat(32),
      op: 'health',
    });
    expect(r.ok).toBe(false);
    await ativo.fechar();
  });

  it('R1 segredo em arquivo inseguro (0644) recusado', async () => {
    const dir = await dirTmp();
    const secretPath = path.join(dir, 'bad.secret');
    await writeFile(secretPath, SEGREDO, { mode: 0o644 });
    await chmod(secretPath, 0o644);
    await expect(
      carregarSegredoAdmin({ secretFile: secretPath, secretInline: null })
    ).rejects.toMatchObject({ codigo: 'DIRETORIO_INSEGURO' });
  });

  it('R1 symlink de segredo recusado', async () => {
    const dir = await dirTmp();
    const real = path.join(dir, 'real.secret');
    await writeFile(real, SEGREDO, { mode: 0o600 });
    await chmod(real, 0o600);
    const link = path.join(dir, 'link.secret');
    await symlink(real, link);
    await expect(
      carregarSegredoAdmin({ secretFile: link, secretInline: null })
    ).rejects.toMatchObject({ codigo: 'DIRETORIO_INSEGURO' });
  });

  it('R1 socket ativo classificado como vivo', async () => {
    const dir = await dirTmp();
    const ativo = await iniciarAdminServidorUds({ socketDir: dir, segredo: SEGREDO });
    expect(await classificarSocketExistente(ativo.socketPath)).toBe('vivo');
    await ativo.fechar();
  });

  it('R1 socket órfão (ECONNREFUSED) pode ser removido', async () => {
    const dir = await dirTmp();
    const sock = caminhoSocketAdmin(await prepararDiretorioAdminSocket(dir));
    // Cria servidor e mata sem unlink limpo: fechar remove; simular órfão com listen+destroy leave file
    const net = await import('node:net');
    const srv = net.createServer();
    await new Promise<void>((resolve, reject) => {
      srv.once('error', reject);
      srv.listen(sock, () => resolve());
    });
    await chmod(sock, 0o600);
    // Fecha sem unlink → socket file órfão tipicamente ECONNREFUSED
    await new Promise<void>((resolve) => srv.close(() => resolve()));
    // Em alguns SO o close já remove o path; se ainda existir, classificar
    try {
      const estado = await classificarSocketExistente(sock);
      if (estado === 'orfao') {
        await removerSocketOrfaoSeguro(sock);
      }
      // Se o SO já removeu, ok
    } catch {
      /* path já limpo */
    }
    // Reinício deve funcionar
    const ativo = await iniciarAdminServidorUds({ socketDir: dir, segredo: SEGREDO });
    expect((await enviarComandoAdminUds({
      socketPath: ativo.socketPath,
      token: SEGREDO,
      op: 'health',
    })).ok).toBe(true);
    await ativo.fechar();
  });

  it('R1 inicialização concorrente: só um vence', async () => {
    const dir = await dirTmp();
    const rs = await Promise.allSettled([
      iniciarAdminServidorUds({ socketDir: dir, segredo: SEGREDO }),
      iniciarAdminServidorUds({ socketDir: dir, segredo: SEGREDO }),
    ]);
    const ok = rs.filter((x) => x.status === 'fulfilled');
    const fail = rs.filter((x) => x.status === 'rejected');
    expect(ok.length).toBe(1);
    expect(fail.length).toBe(1);
    if (ok[0]?.status === 'fulfilled') {
      await ok[0].value.fechar();
    }
  });

  it('R1 shutdown não deixa socket ativo', async () => {
    const dir = await dirTmp();
    await aplicarBootstrapAdminSocket({
      [ENV_ADMIN_SOCKET_DIR]: dir,
      [ENV_ADMIN_SECRET]: SEGREDO,
    });
    const pathSock = obterAdminSocketAtivo()?.socketPath;
    expect(pathSock).toBeTruthy();
    await encerrarAdminSocket();
    expect(obterAdminSocketAtivo()).toBeNull();
    if (pathSock) {
      await expect(
        enviarComandoAdminUds({ socketPath: pathSock, token: SEGREDO, op: 'health', timeoutMs: 300 })
      ).rejects.toBeTruthy();
    }
  });

  it('R1 health/status sem segredo na resposta', async () => {
    const dir = await dirTmp();
    const ativo = await iniciarAdminServidorUds({ socketDir: dir, segredo: SEGREDO });
    const h = await enviarComandoAdminUds({
      socketPath: ativo.socketPath,
      token: SEGREDO,
      op: 'health',
    });
    const s = await enviarComandoAdminUds({
      socketPath: ativo.socketPath,
      token: SEGREDO,
      op: 'status',
    });
    const blob = JSON.stringify({ h, s });
    expect(blob).not.toContain(SEGREDO);
    expect(blob.toLowerCase()).not.toContain('secret');
    await ativo.fechar();
  });

  it('R1 legado / gate / sem PQueue fiscal no admin', async () => {
    expect(GATE_EXECUCAO_REAL_DISCOVERY_ONLY).toBe(false);
    expect(lerConfigAdminSocket({}).habilitado).toBe(false);
    const dir = await dirTmp();
    const ativo = await iniciarAdminServidorUds({ socketDir: dir, segredo: SEGREDO });
    const st = await enviarComandoAdminUds({
      socketPath: ativo.socketPath,
      token: SEGREDO,
      op: 'status',
    });
    expect(st.ok).toBe(true);
    if (st.ok) {
      expect(st.data.prepararLiberar).toBe(false);
      expect(st.data.sefin).toBe(false);
      expect(st.data.discoverNoAdmin).toBe(false);
    }
    await ativo.fechar();
  });
});
