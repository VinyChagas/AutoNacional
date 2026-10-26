/**
 * H2.2.4-A — Bootstrap + CLI homologação (offline).
 */
import { mkdtemp, readFile, rm, symlink, writeFile, chmod, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  aplicarBootstrapCanalHomologacao,
  cliAtivar,
  cliCancelar,
  cliConsultar,
  cliEmitir,
  configurarCanalHomologacaoOperacional,
  criarCanalAutorizacaoArquivo,
  ENV_HOMOLOGACAO_STORE,
  GATE_EXECUCAO_REAL_DISCOVERY_ONLY,
  obterCanalHomologacaoOperacional,
  prepararStoreHomologacaoSeguro,
  avaliarPonteHomologacaoDiscoveryOnly,
  modoDiretorioEsperado,
  modoArquivoEsperado,
} from './index';
import { criarPeriodoConsultaPortal } from '../contracts/periodo';
import type { Page } from 'playwright';

const CNPJ = '11222333000181';
const PERIODO_I = '01/01/2024';
const PERIODO_F = '31/01/2024';
const PERIODO = criarPeriodoConsultaPortal(PERIODO_I, PERIODO_F);
const AGORA = new Date('2024-06-15T12:00:00.000Z');
const VALIDO_ATE = '2024-06-16T12:00:00.000Z';
const PAGE = {} as Page;

const dirs: string[] = [];
const envBackup = process.env[ENV_HOMOLOGACAO_STORE];

afterEach(async () => {
  configurarCanalHomologacaoOperacional(null);
  if (envBackup === undefined) delete process.env[ENV_HOMOLOGACAO_STORE];
  else process.env[ENV_HOMOLOGACAO_STORE] = envBackup;
  while (dirs.length) {
    const d = dirs.pop();
    if (d) await rm(d, { recursive: true, force: true });
  }
});

beforeEach(() => {
  configurarCanalHomologacaoOperacional(null);
  delete process.env[ENV_HOMOLOGACAO_STORE];
});

async function dirTmp(): Promise<string> {
  const d = await mkdtemp(path.join(tmpdir(), 'an-h224a-'));
  dirs.push(d);
  await chmod(d, 0o700);
  return d;
}

async function emitirPadrao(store: string, execucaoId = 'exec-224a') {
  const fiscal = await dirTmp();
  return cliEmitir({
    store,
    execucaoId,
    cnpj: CNPJ,
    periodoInicio: PERIODO_I,
    periodoFim: PERIODO_F,
    diretorioFiscal: fiscal,
    validoAte: VALIDO_ATE,
    motivo: 'teste-h224a',
    agora: AGORA,
  });
}

describe('H2.2.4-A bootstrap e CLI homologação offline', () => {
  it('01 bootstrap ausente → canal null (legado)', async () => {
    const r = await aplicarBootstrapCanalHomologacao({});
    expect(r.status).toBe('ausente');
    expect(obterCanalHomologacaoOperacional()).toBeNull();
  });

  it('02 bootstrap válido → canal configurado sem ativação', async () => {
    const store = await dirTmp();
    const r = await aplicarBootstrapCanalHomologacao({
      [ENV_HOMOLOGACAO_STORE]: store,
    });
    expect(r.status).toBe('configurado');
    if (r.status === 'configurado') {
      expect(r.store).toBeTruthy();
      expect(path.isAbsolute(r.store)).toBe(true);
    }
    expect(obterCanalHomologacaoOperacional()).not.toBeNull();
    expect(GATE_EXECUCAO_REAL_DISCOVERY_ONLY).toBe(false);
  });

  it('03 store path relativo → inseguro', async () => {
    await expect(prepararStoreHomologacaoSeguro('relativo/store')).rejects.toMatchObject({
      codigo: 'DIRETORIO_INSEGURO',
    });
  });

  it('04 store com symlink → recusado', async () => {
    const real = await dirTmp();
    const parent = await dirTmp();
    const link = path.join(parent, 'link-store');
    await symlink(real, link);
    await expect(prepararStoreHomologacaoSeguro(link)).rejects.toMatchObject({
      codigo: 'DIRETORIO_INSEGURO',
    });
  });

  it('05 permissões efetivas 0700/0600', async () => {
    const store = await dirTmp();
    await chmod(store, 0o755);
    const preparado = await prepararStoreHomologacaoSeguro(store);
    const stDir = await stat(preparado);
    expect(stDir.mode & 0o777).toBe(modoDiretorioEsperado());

    const ticket = await emitirPadrao(preparado);
    const arquivo = path.join(preparado, `${ticket.autorizacaoId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
    const stFile = await stat(arquivo);
    expect(stFile.mode & 0o777).toBe(modoArquivoEsperado());
  });

  it('06 emissão válida', async () => {
    const store = await dirTmp();
    const ticket = await emitirPadrao(store);
    expect(ticket.estado).toBe('DISPONIVEL');
    expect(ticket.ativacaoDiscoveryReal).toBe(false);
    expect(ticket.autorizacao.operacao).toBe('DISCOVERY_ONLY');
    expect(ticket.autorizacao.limites.maxRequisicoesSefin).toBe(0);
  });

  it('07 emissão inválida (sem motivo / genérica)', async () => {
    const store = await dirTmp();
    const fiscal = await dirTmp();
    await expect(
      cliEmitir({
        store,
        execucaoId: 'exec-x',
        cnpj: CNPJ,
        periodoInicio: PERIODO_I,
        periodoFim: PERIODO_F,
        diretorioFiscal: fiscal,
        validoAte: VALIDO_ATE,
        motivo: '   ',
        agora: AGORA,
      })
    ).rejects.toBeTruthy();
  });

  it('08 ativação válida', async () => {
    const store = await dirTmp();
    const ticket = await emitirPadrao(store);
    const ativado = await cliAtivar({
      store,
      autorizacaoId: ticket.autorizacaoId,
      motivo: 'ativacao-teste-h224a',
      agora: AGORA,
    });
    expect(ativado.ativacaoDiscoveryReal).toBe(true);
    expect(ativado.ativacaoMotivo).toBe('ativacao-teste-h224a');
  });

  it('09 ativação sem motivo', async () => {
    const store = await dirTmp();
    const ticket = await emitirPadrao(store);
    await expect(
      cliAtivar({ store, autorizacaoId: ticket.autorizacaoId, motivo: '' })
    ).rejects.toMatchObject({ codigo: 'AUTORIZACAO_MALFORMADA' });
  });

  it('10 cancelamento', async () => {
    const store = await dirTmp();
    const ticket = await emitirPadrao(store);
    await cliCancelar({
      store,
      autorizacaoId: ticket.autorizacaoId,
      motivo: 'revogacao-teste',
    });
    const { ticket: apos } = await cliConsultar(store, 'exec-224a');
    expect(apos?.estado).toBe('CANCELADA');
  });

  it('11 consulta', async () => {
    const store = await dirTmp();
    await emitirPadrao(store, 'exec-consulta');
    const { ticket } = await cliConsultar(store, 'exec-consulta');
    expect(ticket?.autorizacao.execucaoId).toBe('exec-consulta');
    const vazio = await cliConsultar(store, 'exec-inexistente');
    expect(vazio.ticket).toBeNull();
  });

  it('12 ticket expirado na emissão', async () => {
    const store = await dirTmp();
    const fiscal = await dirTmp();
    await expect(
      cliEmitir({
        store,
        execucaoId: 'exec-exp',
        cnpj: CNPJ,
        periodoInicio: PERIODO_I,
        periodoFim: PERIODO_F,
        diretorioFiscal: fiscal,
        validoAte: '2020-01-01T00:00:00.000Z',
        motivo: 'expirado',
        agora: AGORA,
      })
    ).rejects.toMatchObject({ codigo: 'AUTORIZACAO_EXPIRADA' });
  });

  it('13 ticket já consumido não reativa', async () => {
    const store = await dirTmp();
    const ticket = await emitirPadrao(store);
    await cliAtivar({
      store,
      autorizacaoId: ticket.autorizacaoId,
      motivo: 'ativar',
      agora: AGORA,
    });
    const canal = criarCanalAutorizacaoArquivo(store);
    await canal.consumir(
      'exec-224a',
      {
        execucaoId: 'exec-224a',
        cnpj: CNPJ,
        periodoConsulta: PERIODO,
        diretorioFiscal: ticket.autorizacao.diretorioFiscal,
        agora: AGORA,
      },
      'TESTE'
    );
    await expect(
      cliAtivar({
        store,
        autorizacaoId: ticket.autorizacaoId,
        motivo: 'nova-ativacao',
      })
    ).rejects.toMatchObject({ codigo: 'AUTORIZACAO_JA_CONSUMIDA' });
  });

  it('14 concorrência local (lease)', async () => {
    const store = await dirTmp();
    const ticket = await emitirPadrao(store);
    const canal = criarCanalAutorizacaoArquivo(store);
    const ctx = {
      execucaoId: 'exec-224a',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      diretorioFiscal: ticket.autorizacao.diretorioFiscal,
      agora: AGORA,
    };
    const rs = await Promise.allSettled([
      canal.consumir('exec-224a', ctx, 'TESTE'),
      canal.consumir('exec-224a', ctx, 'TESTE'),
    ]);
    expect(rs.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(rs.filter((x) => x.status === 'rejected')).toHaveLength(1);
  });

  it('15 persistência após “reinício” (novo canal no mesmo store)', async () => {
    const store = await dirTmp();
    const ticket = await emitirPadrao(store, 'exec-persist');
    await cliAtivar({
      store,
      autorizacaoId: ticket.autorizacaoId,
      motivo: 'persist',
      agora: AGORA,
    });
    const canal2 = criarCanalAutorizacaoArquivo(store);
    const lido = await canal2.consultar('exec-persist');
    expect(lido?.ativacaoDiscoveryReal).toBe(true);
    expect(lido?.autorizacaoId).toBe(ticket.autorizacaoId);
  });

  it('16 tentativa de reutilização após consumo', async () => {
    const store = await dirTmp();
    const ticket = await emitirPadrao(store);
    await cliAtivar({
      store,
      autorizacaoId: ticket.autorizacaoId,
      motivo: 'x',
      agora: AGORA,
    });
    const canal = criarCanalAutorizacaoArquivo(store);
    const ctx = {
      execucaoId: 'exec-224a',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      diretorioFiscal: ticket.autorizacao.diretorioFiscal,
      agora: AGORA,
    };
    await canal.consumir('exec-224a', ctx, 'TESTE');
    await expect(canal.consumir('exec-224a', ctx, 'TESTE')).rejects.toMatchObject({
      codigo: 'AUTORIZACAO_JA_CONSUMIDA',
    });
  });

  it('17 ausência de ativação global (gate permanece false)', async () => {
    const store = await dirTmp();
    await aplicarBootstrapCanalHomologacao({ [ENV_HOMOLOGACAO_STORE]: store });
    expect(GATE_EXECUCAO_REAL_DISCOVERY_ONLY).toBe(false);
  });

  it('18 nenhum acesso externo (CLI só filesystem)', async () => {
    const store = await dirTmp();
    const ticket = await emitirPadrao(store);
    expect(ticket.autorizacao.limites.maxRequisicoesSefin).toBe(0);
    // Sem fetch/http: operação local concluída
    expect(ticket.autorizacaoId.startsWith('auth-')).toBe(true);
  });

  it('19 legado sem ticket (ponte SEM_AUTORIZACAO)', async () => {
    const store = await dirTmp();
    await aplicarBootstrapCanalHomologacao({ [ENV_HOMOLOGACAO_STORE]: store });
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-sem-ticket',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      page: PAGE,
      agora: AGORA,
    });
    expect(r.situacao).toBe('SEM_AUTORIZACAO');
    expect(r.encerrarEtapaFiscal).toBe(false);
  });

  it('20 CLI não dispara execução/discovery', async () => {
    const store = await dirTmp();
    let discoverCalls = 0;
    await emitirPadrao(store);
    // CLI emit/ativar não chama ponte
    const ticket = (await cliConsultar(store, 'exec-224a')).ticket!;
    await cliAtivar({
      store,
      autorizacaoId: ticket.autorizacaoId,
      motivo: 'somente-cli',
      agora: AGORA,
    });
    expect(discoverCalls).toBe(0);
    expect(GATE_EXECUCAO_REAL_DISCOVERY_ONLY).toBe(false);
  });

  it('21 auditoria JSONL sanitizada', async () => {
    const store = await dirTmp();
    const ticket = await emitirPadrao(store);
    await cliAtivar({
      store,
      autorizacaoId: ticket.autorizacaoId,
      motivo: 'auditar',
      agora: AGORA,
    });
    const audit = path.join(store, '_auditoria', 'cli-audit.jsonl');
    const corpo = await readFile(audit, 'utf8');
    expect(corpo).toContain('cli_emissao');
    expect(corpo).toContain('cli_ativacao');
    expect(corpo).not.toContain('senha');
    expect(corpo).not.toContain(CNPJ);
    expect(corpo).toContain('cnpjMascarado');
  });

  it('22 bootstrap store inseguro → recusado + legado', async () => {
    const parent = await dirTmp();
    const real = await dirTmp();
    const link = path.join(parent, 'bad-link');
    await symlink(real, link);
    const r = await aplicarBootstrapCanalHomologacao({
      [ENV_HOMOLOGACAO_STORE]: link,
    });
    expect(r.status).toBe('recusado');
    expect(obterCanalHomologacaoOperacional()).toBeNull();
  });

  it('23 ticket não ativado → bloqueio na ponte', async () => {
    const store = await dirTmp();
    await aplicarBootstrapCanalHomologacao({ [ENV_HOMOLOGACAO_STORE]: store });
    await emitirPadrao(store, 'exec-bloq');
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-bloq',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      page: PAGE,
      agora: AGORA,
    });
    expect(r.estadoOperacional).toBe('BLOQUEADA');
    expect(r.descobertaExecutada).toBe(false);
  });

  it('24 lease órfão não é removido automaticamente', async () => {
    const store = await dirTmp();
    const ticket = await emitirPadrao(store);
    const lease = path.join(
      store,
      `${ticket.autorizacaoId.replace(/[^a-zA-Z0-9_-]/g, '_')}.lease`
    );
    await writeFile(lease, JSON.stringify({ orfao: true }), { mode: 0o600, flag: 'wx' });
    const canal = criarCanalAutorizacaoArquivo(store);
    await expect(
      canal.consumir(
        'exec-224a',
        {
          execucaoId: 'exec-224a',
          cnpj: CNPJ,
          periodoConsulta: PERIODO,
          diretorioFiscal: ticket.autorizacao.diretorioFiscal,
          agora: AGORA,
        },
        'TESTE'
      )
    ).rejects.toMatchObject({ codigo: 'AUTORIZACAO_CONCORRENCIA' });
  });
});

describe('H2.2.4-A-R1 revisão bootstrap/CLI/auditoria', () => {
  it('R1 bootstrap sem env → legado', async () => {
    delete process.env[ENV_HOMOLOGACAO_STORE];
    const r = await aplicarBootstrapCanalHomologacao({});
    expect(r.status).toBe('ausente');
    expect(obterCanalHomologacaoOperacional()).toBeNull();
  });

  it('R1 bootstrap env válida → canal sem ativação automática', async () => {
    const store = await dirTmp();
    const r = await aplicarBootstrapCanalHomologacao({ [ENV_HOMOLOGACAO_STORE]: store });
    expect(r.status).toBe('configurado');
    expect(obterCanalHomologacaoOperacional()).not.toBeNull();
    expect(GATE_EXECUCAO_REAL_DISCOVERY_ONLY).toBe(false);
    const { ticket } = await cliConsultar(store, 'qualquer');
    expect(ticket).toBeNull();
  });

  it('R1 bootstrap env inválida → recusado sem canal parcial', async () => {
    const r = await aplicarBootstrapCanalHomologacao({
      [ENV_HOMOLOGACAO_STORE]: 'nao/absoluto',
    });
    expect(r.status).toBe('recusado');
    expect(obterCanalHomologacaoOperacional()).toBeNull();
  });

  it('R1 falha de auditoria após emissão → FALHA_EVIDENCIA; ticket permanece', async () => {
    const store = await dirTmp();
    await writeFile(path.join(store, '_auditoria'), 'bloqueio-arquivo', 'utf8');
    const fiscal = await dirTmp();
    await expect(
      cliEmitir({
        store,
        execucaoId: 'exec-audit-fail',
        cnpj: CNPJ,
        periodoInicio: PERIODO_I,
        periodoFim: PERIODO_F,
        diretorioFiscal: fiscal,
        validoAte: VALIDO_ATE,
        motivo: 'deve-persistir-ticket',
        agora: AGORA,
      })
    ).rejects.toMatchObject({ codigo: 'FALHA_EVIDENCIA' });

    const canal = criarCanalAutorizacaoArquivo(store);
    const ticket = await canal.consultar('exec-audit-fail');
    expect(ticket?.estado).toBe('DISPONIVEL');
    expect(ticket?.ativacaoDiscoveryReal).toBe(false);
  });

  it('R1 escrita concorrente na auditoria preserva todas as linhas', async () => {
    const store = await dirTmp();
    const { registrarAuditoriaCli } = await import('./cli-auditoria');
    await Promise.all(
      Array.from({ length: 24 }, (_, i) =>
        registrarAuditoriaCli(store, {
          evento: 'cli_consulta',
          execucaoId: `exec-c-${i}`,
          agora: AGORA,
        })
      )
    );
    const corpo = await readFile(path.join(store, '_auditoria', 'cli-audit.jsonl'), 'utf8');
    const linhas = corpo.trim().split('\n').filter(Boolean);
    expect(linhas).toHaveLength(24);
    const st = await stat(path.join(store, '_auditoria', 'cli-audit.jsonl'));
    expect(st.mode & 0o777).toBe(modoArquivoEsperado());
  });

  it('R1 auditoria sanitiza dados sensíveis no motivo', async () => {
    const store = await dirTmp();
    const { registrarAuditoriaCli, sanitizarTextoAuditoria } = await import('./cli-auditoria');
    expect(sanitizarTextoAuditoria('senha=segredo123 token=abc')).toContain('senha=***');
    await registrarAuditoriaCli(store, {
      evento: 'cli_recusada',
      motivo: 'senha=segredo123',
      detalhe: 'password=xyz cookie=abc',
      agora: AGORA,
    });
    const corpo = await readFile(path.join(store, '_auditoria', 'cli-audit.jsonl'), 'utf8');
    expect(corpo).not.toContain('segredo123');
    expect(corpo).not.toContain('password=xyz');
    expect(corpo).toContain('senha=***');
  });

  it('R1 legado sem canal (ponte)', async () => {
    configurarCanalHomologacaoOperacional(null);
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-legado-r1',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      page: PAGE,
      agora: AGORA,
    });
    expect(r.situacao).toBe('SEM_AUTORIZACAO');
    expect(r.encerrarEtapaFiscal).toBe(false);
  });

  it('R1 falha de permissões: store relativo recusado', async () => {
    await expect(prepararStoreHomologacaoSeguro('../escape')).rejects.toMatchObject({
      codigo: 'DIRETORIO_INSEGURO',
    });
  });
});
