/**
 * H2.2.1 — Canal seguro de autorização operacional (offline).
 */
import { mkdtemp, rm, symlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { criarPeriodoConsultaPortal } from '../contracts/periodo';
import {
  configurarCanalHomologacaoOperacional,
  criarAutorizacaoHomologacao,
  criarAutorizacaoId,
  criarCanalAutorizacaoArquivo,
  criarCanalAutorizacaoMemoria,
  criarLimitesHomologacao,
  avaliarPonteHomologacaoDiscoveryOnly,
  definirGateExecucaoRealSomenteTeste,
  evidenciaContemSegredo,
  execucaoRealDiscoveryOnlyHabilitada,
  GATE_EXECUCAO_REAL_DISCOVERY_ONLY,
  HomologacaoNfseError,
  validarDiretorioFiscalSeguro,
  type AutorizacaoHomologacaoNfse,
  type CanalAutorizacaoHomologacao,
} from './index';

const CNPJ = '11222333000181';
const PERIODO = criarPeriodoConsultaPortal('01/01/2024', '31/01/2024');
const PERIODO_OUTRO = criarPeriodoConsultaPortal('01/02/2024', '28/02/2024');
const AGORA = new Date('2024-06-15T12:00:00.000Z');
const VALIDO_ATE = '2024-06-16T12:00:00.000Z';

const dirs: string[] = [];

afterEach(async () => {
  configurarCanalHomologacaoOperacional(null);
  definirGateExecucaoRealSomenteTeste(null);
  while (dirs.length) {
    const d = dirs.pop();
    if (d) await rm(d, { recursive: true, force: true });
  }
});

beforeEach(() => {
  configurarCanalHomologacaoOperacional(null);
  definirGateExecucaoRealSomenteTeste(null);
});

describe('H2.2.1 canal de autorização operacional', () => {
  it('01 autorização válida → PREPARADA_GATE_FECHADO', async () => {
    const dir = await dirTmp();
    const canal = criarCanalAutorizacaoMemoria();
    configurarCanalHomologacaoOperacional(canal);
    await emitir(canal, { diretorio: dir });

    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-221',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      agora: AGORA,
    });
    expect(r.situacao).toBe('PREPARADA_GATE_FECHADO');
    expect(r.estadoOperacional).toBe('BLOQUEADA');
    expect(r.encerrarEtapaFiscal).toBe(true);
    expect(r.codigoErro).toBe('GATE_EXECUCAO_FECHADO');
    expect(r.ticketConsumido).toBe(false);
    expect(r.descobertaExecutada).toBe(false);
    expect(r.efeitosProibidos.navegacaoPortal).toBe(false);
    expect(r.efeitosProibidos.discoverNfse).toBe(false);
    expect(r.efeitosProibidos.sefin).toBe(false);
    expect(execucaoRealDiscoveryOnlyHabilitada()).toBe(false);
    expect(GATE_EXECUCAO_REAL_DISCOVERY_ONLY).toBe(false);
    expect((await canal.consultar('exec-221'))?.estado).toBe('DISPONIVEL');
  });

  it('02 autorização ausente → legado (SEM_AUTORIZACAO)', async () => {
    configurarCanalHomologacaoOperacional(criarCanalAutorizacaoMemoria());
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-221',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      agora: AGORA,
    });
    expect(r.situacao).toBe('SEM_AUTORIZACAO');
    expect(r.encerrarEtapaFiscal).toBe(false);
  });

  it('03 autorização expirada → RECUSADA sem consumir ticket', async () => {
    const dir = await dirTmp();
    const canal = criarCanalAutorizacaoMemoria();
    configurarCanalHomologacaoOperacional(canal);
    await emitir(canal, { diretorio: dir });
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-221',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      agora: new Date('2024-06-20T00:00:00.000Z'),
    });
    expect(r.situacao).toBe('RECUSADA');
    expect(r.codigoErro).toBe('AUTORIZACAO_EXPIRADA');
    expect(r.encerrarEtapaFiscal).toBe(true);
    expect(r.ticketConsumido).toBe(false);
    const t = await canal.consultar('exec-221');
    expect(t?.estado).toBe('DISPONIVEL');
  });

  it('04 CNPJ divergente → RECUSADA', async () => {
    const dir = await dirTmp();
    const canal = criarCanalAutorizacaoMemoria();
    configurarCanalHomologacaoOperacional(canal);
    await emitir(canal, { diretorio: dir });
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-221',
      cnpj: '99888777000166',
      periodoConsulta: PERIODO,
      pagePresente: true,
      agora: AGORA,
    });
    expect(r.situacao).toBe('RECUSADA');
    expect(r.codigoErro).toBe('CNPJ_DIVERGENTE');
  });

  it('05 período divergente → RECUSADA', async () => {
    const dir = await dirTmp();
    const canal = criarCanalAutorizacaoMemoria();
    configurarCanalHomologacaoOperacional(canal);
    await emitir(canal, { diretorio: dir });
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-221',
      cnpj: CNPJ,
      periodoConsulta: PERIODO_OUTRO,
      pagePresente: true,
      agora: AGORA,
    });
    expect(r.codigoErro).toBe('PERIODO_DIVERGENTE');
  });

  it('06 execucaoId divergente → SEM_AUTORIZACAO no contexto errado', async () => {
    const dir = await dirTmp();
    const canal = criarCanalAutorizacaoMemoria();
    configurarCanalHomologacaoOperacional(canal);
    await emitir(canal, { diretorio: dir });
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-outra',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      agora: AGORA,
    });
    expect(r.situacao).toBe('SEM_AUTORIZACAO');
  });

  it('07 diretório divergente → RECUSADA', async () => {
    const dir = await dirTmp();
    const outro = await dirTmp();
    const canal = criarCanalAutorizacaoMemoria();
    configurarCanalHomologacaoOperacional(canal);
    // Ticket com dir A; consumo valida diretorio do ticket contra contexto —
    // a ponte usa diretorio do ticket. Para divergência, o ticket aponta dir
    // e validarAutorizacao compara com o mesmo. Simulamos via consumir direto.
    await emitir(canal, { diretorio: dir });
    await expect(
      canal.consumir(
        'exec-221',
        {
          execucaoId: 'exec-221',
          cnpj: CNPJ,
          periodoConsulta: PERIODO,
          diretorioFiscal: outro,
          agora: AGORA,
        },
        'TESTE'
      )
    ).rejects.toMatchObject({ codigo: 'DIRETORIO_DIVERGENTE' });
  });

  it('08 operação SEFIN recusada na emissão', async () => {
    const dir = await dirTmp();
    const canal = criarCanalAutorizacaoMemoria();
    const auth = criarAutorizacaoHomologacao({
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'exec-221',
      operacao: 'SEFIN_RECOVERY',
      validoAte: VALIDO_ATE,
      diretorioFiscal: dir,
      limites: criarLimitesHomologacao({
        maxDocumentos: 5,
        maxPaginas: 2,
        maxRequisicoesSefin: 3,
        timeoutMs: 10_000,
      }),
      agora: AGORA,
    });
    await expect(
      canal.emitir({
        versao: 1,
        autorizacaoId: criarAutorizacaoId(),
        autorizacao: auth,
        emitidoEm: AGORA.toISOString(),
      })
    ).rejects.toMatchObject({ codigo: 'OPERACAO_NAO_AUTORIZADA' });
  });

  it('09 gate fechado não consome; consumo único só via consumir()', async () => {
    const dir = await dirTmp();
    const canal = criarCanalAutorizacaoMemoria();
    configurarCanalHomologacaoOperacional(canal);
    await emitir(canal, { diretorio: dir });
    const r1 = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-221',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      agora: AGORA,
    });
    expect(r1.situacao).toBe('PREPARADA_GATE_FECHADO');
    expect(r1.ticketConsumido).toBe(false);
    expect((await canal.consultar('exec-221'))?.estado).toBe('DISPONIVEL');
    await canal.consumir(
      'exec-221',
      {
        execucaoId: 'exec-221',
        cnpj: CNPJ,
        periodoConsulta: PERIODO,
        diretorioFiscal: dir,
        agora: AGORA,
      },
      'TESTE'
    );
    expect((await canal.consultar('exec-221'))?.estado).toBe('CONSUMIDA');
  });

  it('10 reutilização após consumir() recusada; preparação pode repetir enquanto DISPONIVEL', async () => {
    const dir = await dirTmp();
    const canal = criarCanalAutorizacaoMemoria();
    configurarCanalHomologacaoOperacional(canal);
    await emitir(canal, { diretorio: dir });
    const r1 = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-221',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      agora: AGORA,
    });
    const r2 = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-221',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      agora: AGORA,
    });
    expect(r1.situacao).toBe('PREPARADA_GATE_FECHADO');
    expect(r2.situacao).toBe('PREPARADA_GATE_FECHADO');
    await canal.consumir(
      'exec-221',
      {
        execucaoId: 'exec-221',
        cnpj: CNPJ,
        periodoConsulta: PERIODO,
        diretorioFiscal: dir,
        agora: AGORA,
      },
      'TESTE'
    );
    await expect(
      canal.consumir(
        'exec-221',
        {
          execucaoId: 'exec-221',
          cnpj: CNPJ,
          periodoConsulta: PERIODO,
          diretorioFiscal: dir,
          agora: AGORA,
        },
        'TESTE'
      )
    ).rejects.toMatchObject({ codigo: 'AUTORIZACAO_JA_CONSUMIDA' });
  });

  it('11 concorrência simultânea (memória)', async () => {
    const dir = await dirTmp();
    const canal = criarCanalAutorizacaoMemoria();
    await emitir(canal, { diretorio: dir });
    const ctx = {
      execucaoId: 'exec-221',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      diretorioFiscal: dir,
      agora: AGORA,
    };
    const resultados = await Promise.allSettled([
      canal.consumir('exec-221', ctx, 'TESTE'),
      canal.consumir('exec-221', ctx, 'TESTE'),
    ]);
    const ok = resultados.filter((r) => r.status === 'fulfilled');
    const fail = resultados.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(fail).toHaveLength(1);
  });

  it('11b concorrência em arquivo (lease wx)', async () => {
    const store = await dirTmp();
    const dir = await dirTmp();
    const canal = criarCanalAutorizacaoArquivo(store);
    await emitir(canal, { diretorio: dir });
    const ctx = {
      execucaoId: 'exec-221',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      diretorioFiscal: dir,
      agora: AGORA,
    };
    const resultados = await Promise.allSettled([
      canal.consumir('exec-221', ctx, 'TESTE'),
      canal.consumir('exec-221', ctx, 'TESTE'),
    ]);
    const ok = resultados.filter((r) => r.status === 'fulfilled');
    expect(ok.length).toBe(1);
    const rej = resultados.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect((rej.reason as HomologacaoNfseError).codigo).toMatch(
      /AUTORIZACAO_JA_CONSUMIDA|AUTORIZACAO_CONCORRENCIA/
    );
  });

  it('12 timeout operacional: ticket expirado não reutilizável', async () => {
    const dir = await dirTmp();
    const canal = criarCanalAutorizacaoMemoria();
    await emitir(canal, { diretorio: dir });
    await expect(
      canal.consumir(
        'exec-221',
        {
          execucaoId: 'exec-221',
          cnpj: CNPJ,
          periodoConsulta: PERIODO,
          diretorioFiscal: dir,
          agora: new Date('2025-01-01T00:00:00.000Z'),
        },
        'TIMEOUT'
      )
    ).rejects.toMatchObject({ codigo: 'AUTORIZACAO_EXPIRADA' });
    expect((await canal.consultar('exec-221'))?.estado).toBe('FALHA');
  });

  it('13 cancelamento impede consumo', async () => {
    const dir = await dirTmp();
    const canal = criarCanalAutorizacaoMemoria();
    const ticket = await emitir(canal, { diretorio: dir });
    await canal.cancelar(ticket.autorizacaoId, 'cancelamento_teste');
    await expect(
      canal.consumir(
        'exec-221',
        {
          execucaoId: 'exec-221',
          cnpj: CNPJ,
          periodoConsulta: PERIODO,
          diretorioFiscal: dir,
          agora: AGORA,
        },
        'TESTE'
      )
    ).rejects.toMatchObject({ codigo: 'AUTORIZACAO_JA_CONSUMIDA' });
  });

  it('14 falha antes da execução (page ausente)', async () => {
    const dir = await dirTmp();
    const canal = criarCanalAutorizacaoMemoria();
    configurarCanalHomologacaoOperacional(canal);
    await emitir(canal, { diretorio: dir });
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-221',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: false,
      agora: AGORA,
    });
    expect(r.situacao).toBe('RECUSADA');
    expect(r.encerrarEtapaFiscal).toBe(true);
    // Ticket ainda DISPONIVEL (falha antes do consumo) — ou consumido?
    // Ponte recusa page antes de consumir → ticket permanece DISPONIVEL.
    expect((await canal.consultar('exec-221'))?.estado).toBe('DISPONIVEL');
  });

  it('15 falha após consumo não libera ticket', async () => {
    const dir = await dirTmp();
    const canal = criarCanalAutorizacaoMemoria();
    await emitir(canal, { diretorio: dir });
    await canal.consumir(
      'exec-221',
      {
        execucaoId: 'exec-221',
        cnpj: CNPJ,
        periodoConsulta: PERIODO,
        diretorioFiscal: dir,
        agora: AGORA,
      },
      'TESTE'
    );
    await expect(
      canal.consumir(
        'exec-221',
        {
          execucaoId: 'exec-221',
          cnpj: CNPJ,
          periodoConsulta: PERIODO,
          diretorioFiscal: dir,
          agora: AGORA,
        },
        'TESTE'
      )
    ).rejects.toMatchObject({ codigo: 'AUTORIZACAO_JA_CONSUMIDA' });
    expect((await canal.consultar('exec-221'))?.estado).toBe('CONSUMIDA');
  });

  it('16 gate real fechado por padrão', () => {
    expect(GATE_EXECUCAO_REAL_DISCOVERY_ONLY).toBe(false);
    expect(execucaoRealDiscoveryOnlyHabilitada()).toBe(false);
  });

  it('17 legado sem autorização (canal null)', async () => {
    configurarCanalHomologacaoOperacional(null);
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-221',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      agora: AGORA,
    });
    expect(r.situacao).toBe('SEM_AUTORIZACAO');
    expect(r.encerrarEtapaFiscal).toBe(false);
  });

  it('18 ausência de execução dupla (encerrarEtapaFiscal)', async () => {
    const dir = await dirTmp();
    const canal = criarCanalAutorizacaoMemoria();
    configurarCanalHomologacaoOperacional(canal);
    await emitir(canal, { diretorio: dir });
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-221',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      agora: AGORA,
    });
    expect(r.encerrarEtapaFiscal).toBe(true);
    expect(r.efeitosProibidos.execucaoDuplaLegado).toBe(false);
  });

  it('19 ausência de SEFIN', async () => {
    const dir = await dirTmp();
    const canal = criarCanalAutorizacaoMemoria();
    configurarCanalHomologacaoOperacional(canal);
    await emitir(canal, { diretorio: dir });
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-221',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      agora: AGORA,
    });
    expect(r.efeitosProibidos.sefin).toBe(false);
    expect(r.ticket?.autorizacao.limites.maxRequisicoesSefin).toBe(0);
  });

  it('20 ausência de XML', async () => {
    const dir = await dirTmp();
    const canal = criarCanalAutorizacaoMemoria();
    configurarCanalHomologacaoOperacional(canal);
    await emitir(canal, { diretorio: dir });
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-221',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      agora: AGORA,
    });
    expect(r.efeitosProibidos.escritaXml).toBe(false);
  });

  it('21 ausência de checkpoint', async () => {
    const dir = await dirTmp();
    const canal = criarCanalAutorizacaoMemoria();
    configurarCanalHomologacaoOperacional(canal);
    await emitir(canal, { diretorio: dir });
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-221',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      agora: AGORA,
    });
    expect(r.efeitosProibidos.checkpointRecuperacao).toBe(false);
  });

  it('22 nenhum navegador adicional', async () => {
    const dir = await dirTmp();
    const canal = criarCanalAutorizacaoMemoria();
    configurarCanalHomologacaoOperacional(canal);
    await emitir(canal, { diretorio: dir });
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-221',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      agora: AGORA,
    });
    expect(r.efeitosProibidos.navegadorAdicional).toBe(false);
    expect(r.efeitosProibidos.navegacaoPortal).toBe(false);
  });

  it('23 nenhum login adicional', async () => {
    const dir = await dirTmp();
    const canal = criarCanalAutorizacaoMemoria();
    configurarCanalHomologacaoOperacional(canal);
    await emitir(canal, { diretorio: dir });
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-221',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      agora: AGORA,
    });
    expect(r.efeitosProibidos.loginAdicional).toBe(false);
  });

  it('24 limpeza de recursos: cancelar + configurarCanal(null)', async () => {
    const dir = await dirTmp();
    const canal = criarCanalAutorizacaoMemoria();
    const t = await emitir(canal, { diretorio: dir });
    await canal.cancelar(t.autorizacaoId, 'limpeza');
    expect((await canal.consultar('exec-221'))?.estado).toBe('CANCELADA');
    configurarCanalHomologacaoOperacional(null);
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-221',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      agora: AGORA,
    });
    expect(r.situacao).toBe('SEM_AUTORIZACAO');
  });

  it('25 evidências sanitizadas + diretório seguro', async () => {
    const dir = await dirTmp();
    const canal = criarCanalAutorizacaoMemoria();
    configurarCanalHomologacaoOperacional(canal);
    await emitir(canal, { diretorio: dir });
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-221',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      agora: AGORA,
    });
    expect(r.evidencias.length).toBeGreaterThan(0);
    expect(r.evidencias.every((e) => !evidenciaContemSegredo(e))).toBe(true);
    expect(r.cnpjMascarado).not.toContain(CNPJ);
    const seguro = await validarDiretorioFiscalSeguro({ diretorioFiscal: dir });
    expect(path.isAbsolute(seguro)).toBe(true);
    await expect(
      validarDiretorioFiscalSeguro({ diretorioFiscal: `${dir}/../escape` })
    ).rejects.toMatchObject({ codigo: 'DIRETORIO_INSEGURO' });
  });

  it('25b symlink escape recusado quando raizPermitida', async () => {
    const raiz = await dirTmp();
    const fora = await dirTmp();
    const dentro = path.join(raiz, 'fiscal');
    await mkdir(dentro, { recursive: true });
    const link = path.join(raiz, 'link-fora');
    try {
      await symlink(fora, link);
    } catch {
      // ambientes sem symlink — pula
      return;
    }
    await expect(
      validarDiretorioFiscalSeguro({ diretorioFiscal: link, raizPermitida: raiz })
    ).rejects.toMatchObject({ codigo: 'DIRETORIO_INSEGURO' });
  });

  it('R1 gate fechado: sem PASS, sem SEFIN/XML/checkpoint/navegação', async () => {
    const dir = await dirTmp();
    const canal = criarCanalAutorizacaoMemoria();
    configurarCanalHomologacaoOperacional(canal);
    await emitir(canal, { diretorio: dir });
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-221',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      agora: AGORA,
    });
    expect(r.descobertaExecutada).toBe(false);
    expect(r.ticketConsumido).toBe(false);
    expect(r.codigoErro).toBe('GATE_EXECUCAO_FECHADO');
    expect(r.estadoOperacional).toBe('BLOQUEADA');
    expect(r.efeitosProibidos).toMatchObject({
      sefin: false,
      escritaXml: false,
      checkpointRecuperacao: false,
      navegacaoPortal: false,
      discoverNfse: false,
    });
    const fim = r.evidencias.find((e) => e.evento === 'ponte_preparada_gate_fechado');
    expect(fim?.detalhes.vereditoPass).toBe(false);
    expect(fim?.detalhes.coberturaFiscal).toBe(false);
  });

  it('R1 lease órfão não permite segundo consumo (arquivo)', async () => {
    const store = await dirTmp();
    const dir = await dirTmp();
    const canal = criarCanalAutorizacaoArquivo(store);
    const ticket = await emitir(canal, { diretorio: dir });
    const lease = path.join(store, `${ticket.autorizacaoId.replace(/[^a-zA-Z0-9_-]/g, '_')}.lease`);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(lease, JSON.stringify({ orfao: true, pid: 1 }), { flag: 'wx' });
    await expect(
      canal.consumir(
        'exec-221',
        {
          execucaoId: 'exec-221',
          cnpj: CNPJ,
          periodoConsulta: PERIODO,
          diretorioFiscal: dir,
          agora: AGORA,
        },
        'TESTE'
      )
    ).rejects.toMatchObject({ codigo: 'AUTORIZACAO_CONCORRENCIA' });
    expect((await canal.consultar('exec-221'))?.estado).toBe('DISPONIVEL');
  });

  it('R1 fluxo legado sem ticket permanece SEM_AUTORIZACAO', async () => {
    configurarCanalHomologacaoOperacional(null);
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'qualquer',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      agora: AGORA,
    });
    expect(r.situacao).toBe('SEM_AUTORIZACAO');
    expect(r.encerrarEtapaFiscal).toBe(false);
    expect(r.descobertaExecutada).toBe(false);
  });
});

async function dirTmp(): Promise<string> {
  const d = await mkdtemp(path.join(tmpdir(), 'an-h221-'));
  dirs.push(d);
  return d;
}

async function emitir(
  canal: CanalAutorizacaoHomologacao,
  opts: { diretorio: string; execucaoId?: string } = { diretorio: '' }
) {
  const auth: AutorizacaoHomologacaoNfse = criarAutorizacaoHomologacao({
    cnpj: CNPJ,
    periodoConsulta: PERIODO,
    execucaoId: opts.execucaoId ?? 'exec-221',
    operacao: 'DISCOVERY_ONLY',
    validoAte: VALIDO_ATE,
    diretorioFiscal: opts.diretorio,
    limites: criarLimitesHomologacao({
      maxDocumentos: 10,
      maxPaginas: 5,
      maxRequisicoesSefin: 0,
      timeoutMs: 30_000,
    }),
    motivo: 'teste-h221',
    agora: AGORA,
  });
  return canal.emitir({
    versao: 1,
    autorizacaoId: criarAutorizacaoId(),
    autorizacao: auth,
    emitidoEm: AGORA.toISOString(),
  });
}
