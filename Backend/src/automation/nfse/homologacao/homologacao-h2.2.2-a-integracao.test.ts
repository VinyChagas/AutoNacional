/**
 * H2.2.2-A — Integração Discovery-Only offline (gate + canal + adaptador + evidências).
 * Sem Playwright real, Portal, SEFIN ou certificados.
 */
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Page } from 'playwright';
import { criarDocumentoFiscal } from '../contracts/documento-fiscal';
import { montarInventario, type InventarioNfse } from '../contracts/inventario';
import { criarPeriodoConsultaPortal } from '../contracts/periodo';
import type { DiscoverNfseInput } from '../discovery/discovery-service';
import type { ResultadoDescobertaNfse } from '../discovery/types';
import {
  avaliarPonteHomologacaoDiscoveryOnly,
  configurarCanalHomologacaoOperacional,
  criarAutorizacaoHomologacao,
  criarAutorizacaoId,
  criarCanalAutorizacaoMemoria,
  criarLimitesHomologacao,
  definirGateExecucaoRealSomenteTeste,
  evidenciaContemSegredo,
  GATE_EXECUCAO_REAL_DISCOVERY_ONLY,
  type AutorizacaoHomologacaoNfse,
  type CanalAutorizacaoHomologacao,
  type DiscoverNfseInjetavel,
} from './index';

const CNPJ = '11222333000181';
const PERIODO = criarPeriodoConsultaPortal('01/01/2024', '31/01/2024');
const PERIODO_OUTRO = criarPeriodoConsultaPortal('01/02/2024', '28/02/2024');
const AGORA = new Date('2024-06-15T12:00:00.000Z');
const VALIDO_ATE = '2024-06-16T12:00:00.000Z';
const PAGE = {} as Page;

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

describe('H2.2.2-A integração Discovery-Only offline', () => {
  it('01 gate fechado → BLOQUEADA', async () => {
    const dir = await dirTmp();
    await prepararCanal(dir);
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-222a',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      page: PAGE,
      agora: AGORA,
    });
    expect(r.estadoOperacional).toBe('BLOQUEADA');
    expect(r.situacao).toBe('PREPARADA_GATE_FECHADO');
    expect(GATE_EXECUCAO_REAL_DISCOVERY_ONLY).toBe(false);
  });

  it('02 ticket não consumido com gate fechado', async () => {
    const dir = await dirTmp();
    const canal = await prepararCanal(dir);
    await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-222a',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      page: PAGE,
      agora: AGORA,
    });
    expect((await canal.consultar('exec-222a'))?.estado).toBe('DISPONIVEL');
  });

  it('03 ticket válido + ativação individual → CONCLUIDA', async () => {
    const dir = await dirTmp();
    await prepararCanal(dir, {}, { ativar: true });
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-222a',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      page: PAGE,
      discover: mockDiscoverCompleto(),
      persistirEvidencias: true,
      agora: AGORA,
    });
    expect(r.estadoOperacional).toBe('CONCLUIDA');
    expect(r.situacao).toBe('DESCOBERTA_CONCLUIDA');
    expect(r.ticketConsumido).toBe(true);
    expect(r.descobertaExecutada).toBe(true);
    expect(r.resultadoDiscovery?.veredito).toBe('PASS');
    expect(r.resultadoDiscovery?.estadoInventario).toBe('COMPLETO');
  });

  it('04 ticket inválido ({autorizada:true}) → sem descoberta', async () => {
    const canal = criarCanalAutorizacaoMemoria();
    configurarCanalHomologacaoOperacional(canal);
    await expect(
      canal.emitir({
        versao: 1,
        autorizacaoId: criarAutorizacaoId(),
        autorizacao: { autorizada: true } as unknown as AutorizacaoHomologacaoNfse,
        emitidoEm: AGORA.toISOString(),
      })
    ).rejects.toBeTruthy();
  });

  it('05 ticket expirado → FALHA sem consumo', async () => {
    const dir = await dirTmp();
    await prepararCanal(dir);
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-222a',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      page: PAGE,
      agora: new Date('2024-07-01T00:00:00.000Z'),
    });
    expect(r.estadoOperacional).toBe('FALHA');
    expect(r.ticketConsumido).toBe(false);
    expect(r.descobertaExecutada).toBe(false);
  });

  it('06 CNPJ divergente', async () => {
    const dir = await dirTmp();
    await prepararCanal(dir);
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-222a',
      cnpj: '99888777000166',
      periodoConsulta: PERIODO,
      pagePresente: true,
      page: PAGE,
      agora: AGORA,
    });
    expect(r.codigoErro).toBe('CNPJ_DIVERGENTE');
    expect(r.descobertaExecutada).toBe(false);
  });

  it('07 período divergente', async () => {
    const dir = await dirTmp();
    await prepararCanal(dir);
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-222a',
      cnpj: CNPJ,
      periodoConsulta: PERIODO_OUTRO,
      pagePresente: true,
      page: PAGE,
      agora: AGORA,
    });
    expect(r.codigoErro).toBe('PERIODO_DIVERGENTE');
  });

  it('08 execucaoId divergente → legado', async () => {
    const dir = await dirTmp();
    await prepararCanal(dir);
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-outra',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      page: PAGE,
      agora: AGORA,
    });
    expect(r.situacao).toBe('SEM_AUTORIZACAO');
    expect(r.encerrarEtapaFiscal).toBe(false);
  });

  it('09 consumo único com ativação individual', async () => {
    const dir = await dirTmp();
    const canal = await prepararCanal(dir, {}, { ativar: true });
    const r1 = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-222a',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      page: PAGE,
      discover: mockDiscoverCompleto(),
      persistirEvidencias: false,
      agora: AGORA,
    });
    expect(r1.ticketConsumido).toBe(true);
    expect((await canal.consultar('exec-222a'))?.estado).toBe('CONSUMIDA');
    const r2 = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-222a',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      page: PAGE,
      discover: mockDiscoverCompleto(),
      agora: AGORA,
    });
    expect(r2.situacao).toBe('RECUSADA');
    expect(r2.codigoErro).toBe('AUTORIZACAO_JA_CONSUMIDA');
  });

  it('10 concorrência no consumo', async () => {
    const dir = await dirTmp();
    const canal = await prepararCanal(dir);
    const ctx = {
      execucaoId: 'exec-222a',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      diretorioFiscal: dir,
      agora: AGORA,
    };
    const rs = await Promise.allSettled([
      canal.consumir('exec-222a', ctx, 'TESTE'),
      canal.consumir('exec-222a', ctx, 'TESTE'),
    ]);
    expect(rs.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(rs.filter((x) => x.status === 'rejected')).toHaveLength(1);
  });

  it('11 Page autenticada injetada (mesma referência)', async () => {
    const dir = await dirTmp();
    await prepararCanal(dir, {}, { ativar: true });
    const pages: Page[] = [];
    const discover: DiscoverNfseInjetavel = async (input) => {
      pages.push(input.page);
      return fecharMock({
        tipo: input.tipo,
        status: 'DISCOVERY_COMPLETE',
        inventario: inv(input.tipo === 'EMITIDAS' ? 'EMITIDA' : 'RECEBIDA', []),
        paginas: 1,
      });
    };
    await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-222a',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      page: PAGE,
      discover,
      persistirEvidencias: false,
      agora: AGORA,
    });
    expect(pages.every((p) => p === PAGE)).toBe(true);
  });

  it('12 emitidas contabilizadas', async () => {
    const dir = await dirTmp();
    await prepararCanal(dir, {}, { ativar: true });
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-222a',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      page: PAGE,
      discover: mockDiscover({
        EMITIDAS: inv('EMITIDA', [{ n: 1 }, { n: 2 }]),
        RECEBIDAS: inv('RECEBIDA', []),
      }),
      persistirEvidencias: false,
      agora: AGORA,
    });
    expect(r.resultadoDiscovery?.totais.emitidas).toBe(2);
  });

  it('13 recebidas contabilizadas', async () => {
    const dir = await dirTmp();
    await prepararCanal(dir, {}, { ativar: true });
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-222a',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      page: PAGE,
      discover: mockDiscover({
        EMITIDAS: inv('EMITIDA', []),
        RECEBIDAS: inv('RECEBIDA', [{ n: 3 }, { n: 4 }, { n: 5 }]),
      }),
      persistirEvidencias: false,
      agora: AGORA,
    });
    expect(r.resultadoDiscovery?.totais.recebidas).toBe(3);
  });

  it('14 paginação: orçamento global de páginas', async () => {
    const dir = await dirTmp();
    await prepararCanal(dir, { maxPaginas: 5 }, { ativar: true });
    const maxes: number[] = [];
    const discover: DiscoverNfseInjetavel = async (input) => {
      maxes.push(input.maxPaginas ?? -1);
      return fecharMock({
        tipo: input.tipo,
        status: 'DISCOVERY_COMPLETE',
        inventario: inv(input.tipo === 'EMITIDAS' ? 'EMITIDA' : 'RECEBIDA', []),
        paginas: 2,
      });
    };
    await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-222a',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      page: PAGE,
      discover,
      persistirEvidencias: false,
      agora: AGORA,
    });
    expect(maxes).toEqual([5, 3]);
  });

  it('15 inventário completo → CONCLUIDA', async () => {
    const dir = await dirTmp();
    await prepararCanal(dir, {}, { ativar: true });
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-222a',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      page: PAGE,
      discover: mockDiscoverCompleto(),
      persistirEvidencias: false,
      agora: AGORA,
    });
    expect(r.estadoOperacional).toBe('CONCLUIDA');
    expect(r.resultadoDiscovery?.estadoInventario).toBe('COMPLETO');
  });

  it('16 inventário incompleto → INCOMPLETA (sem PASS)', async () => {
    const dir = await dirTmp();
    await prepararCanal(dir, { maxPaginas: 1 }, { ativar: true });
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-222a',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      page: PAGE,
      discover: async (input) =>
        fecharMock({
          tipo: input.tipo,
          status: 'DISCOVERY_INCOMPLETE',
          inventario: inv('EMITIDA', [{ n: 1 }]),
          paginas: 1,
          diagnosticos: [{ codigo: 'LIMITE_PAGINAS', mensagem: 'limite páginas' }],
        }),
      persistirEvidencias: false,
      agora: AGORA,
    });
    expect(r.estadoOperacional).toBe('INCOMPLETA');
    expect(r.resultadoDiscovery?.veredito).not.toBe('PASS');
  });

  it('17 cancelamento → CANCELADA', async () => {
    const dir = await dirTmp();
    await prepararCanal(dir, {}, { ativar: true });
    const ac = new AbortController();
    ac.abort();
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-222a',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      page: PAGE,
      discover: mockDiscoverCompleto(),
      signal: ac.signal,
      persistirEvidencias: false,
      agora: AGORA,
    });
    expect(r.estadoOperacional).toBe('CANCELADA');
    expect(r.ticketConsumido).toBe(true);
  });

  it('18 timeout → INCOMPLETA', async () => {
    const dir = await dirTmp();
    await prepararCanal(dir, { timeoutMs: 100 }, { ativar: true });
    let tick = AGORA.getTime();
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-222a',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      page: PAGE,
      discover: async (input) => {
        input.controle?.antesDeOperacao?.('antes_pagina');
        tick += 50_000;
        input.controle?.antesDeOperacao?.('apos_pagina');
        return fecharMock({
          tipo: input.tipo,
          status: 'DISCOVERY_COMPLETE',
          inventario: inv('EMITIDA', []),
          paginas: 1,
        });
      },
      persistirEvidencias: false,
      agora: AGORA,
      relogio: () => new Date(tick),
    });
    expect(r.estadoOperacional).toBe('INCOMPLETA');
    expect(r.resultadoDiscovery?.codigoErro).toBe('TIMEOUT');
  });

  it('19 falha de descoberta → FALHA', async () => {
    const dir = await dirTmp();
    await prepararCanal(dir, {}, { ativar: true });
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-222a',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      page: PAGE,
      discover: async (input) =>
        fecharMock({
          tipo: input.tipo,
          status: 'DISCOVERY_FAILED',
          inventario: inv('EMITIDA', []),
          paginas: 0,
          diagnosticos: [{ codigo: 'NAV_FALHA', mensagem: 'falha simulada' }],
        }),
      persistirEvidencias: false,
      agora: AGORA,
    });
    expect(['FALHA', 'INCOMPLETA']).toContain(r.estadoOperacional);
    expect(r.resultadoDiscovery?.veredito).not.toBe('PASS');
  });

  it('20 falha de persistência → FALHA (não aprovada)', async () => {
    const dir = await dirTmp();
    await prepararCanal(dir, {}, { ativar: true });
    // Bloqueia pasta homologacao tornando-a arquivo
    await writeFile(path.join(dir, 'homologacao'), 'bloqueio', 'utf8');
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-222a',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      page: PAGE,
      discover: mockDiscoverCompleto(),
      persistirEvidencias: true,
      agora: AGORA,
    });
    expect(r.estadoOperacional).toBe('FALHA');
    expect(r.codigoErro).toBe('FALHA_EVIDENCIA');
  });

  it('21 evidência íntegra (sanitizada, sem sobrescrita)', async () => {
    const dir = await dirTmp();
    await prepararCanal(dir, {}, { ativar: true });
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-222a',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      page: PAGE,
      discover: mockDiscoverCompleto(),
      persistirEvidencias: true,
      agora: AGORA,
    });
    expect(r.estadoOperacional).toBe('CONCLUIDA');
    expect(r.evidencias.every((e) => !evidenciaContemSegredo(e))).toBe(true);
    const pasta = path.join(dir, 'homologacao');
    const arquivos = await readdir(pasta);
    expect(arquivos.some((a) => a.endsWith('.json'))).toBe(true);
    const corpo = await readFile(path.join(pasta, arquivos[0]!), 'utf8');
    expect(corpo).not.toContain(CNPJ);
    expect(corpo).toContain('cnpjMascarado');
  });

  it('22 ausência de SEFIN', async () => {
    const dir = await dirTmp();
    await prepararCanal(dir, {}, { ativar: true });
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-222a',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      page: PAGE,
      discover: mockDiscoverCompleto(),
      persistirEvidencias: false,
      agora: AGORA,
    });
    expect(r.efeitosProibidos.sefin).toBe(false);
    expect(r.resultadoDiscovery?.limitesAplicados.maxRequisicoesSefin).toBe(0);
  });

  it('23 ausência de XML', async () => {
    const dir = await dirTmp();
    await prepararCanal(dir, {}, { ativar: true });
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-222a',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      page: PAGE,
      discover: mockDiscoverCompleto(),
      persistirEvidencias: false,
      agora: AGORA,
    });
    expect(r.efeitosProibidos.escritaXml).toBe(false);
  });

  it('24 ausência de checkpoint', async () => {
    const dir = await dirTmp();
    await prepararCanal(dir, {}, { ativar: true });
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-222a',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      page: PAGE,
      discover: mockDiscoverCompleto(),
      persistirEvidencias: false,
      agora: AGORA,
    });
    expect(r.efeitosProibidos.checkpointRecuperacao).toBe(false);
  });

  it('25 ausência de execução dupla (encerrarEtapaFiscal)', async () => {
    const dir = await dirTmp();
    await prepararCanal(dir, {}, { ativar: true });
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-222a',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      page: PAGE,
      discover: mockDiscoverCompleto(),
      persistirEvidencias: false,
      agora: AGORA,
    });
    expect(r.encerrarEtapaFiscal).toBe(true);
    expect(r.efeitosProibidos.execucaoDuplaLegado).toBe(false);
  });

  it('26 legado sem ticket', async () => {
    configurarCanalHomologacaoOperacional(criarCanalAutorizacaoMemoria());
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-222a',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      page: PAGE,
      agora: AGORA,
    });
    expect(r.situacao).toBe('SEM_AUTORIZACAO');
    expect(r.encerrarEtapaFiscal).toBe(false);
    expect(r.estadoOperacional).toBeNull();
  });

  it('27 limpeza de recursos (canal null + gate null)', async () => {
    const dir = await dirTmp();
    await prepararCanal(dir, {}, { ativar: true });
    configurarCanalHomologacaoOperacional(null);
    definirGateExecucaoRealSomenteTeste(null);
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-222a',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      page: PAGE,
      agora: AGORA,
    });
    expect(r.situacao).toBe('SEM_AUTORIZACAO');
  });

  it('28 nenhuma navegação real sem ativação individual', async () => {
    const dir = await dirTmp();
    await prepararCanal(dir);
    let chamadas = 0;
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-222a',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      page: PAGE,
      discover: async (input) => {
        chamadas += 1;
        return fecharMock({
          tipo: input.tipo,
          status: 'DISCOVERY_COMPLETE',
          inventario: inv('EMITIDA', []),
          paginas: 0,
        });
      },
      agora: AGORA,
    });
    expect(chamadas).toBe(0);
    expect(r.efeitosProibidos.navegacaoPortal).toBe(false);
    expect(r.descobertaExecutada).toBe(false);
  });

  it('29 nenhuma ativação externa (gate padrão false; sem env)', () => {
    expect(GATE_EXECUCAO_REAL_DISCOVERY_ONLY).toBe(false);
    expect(process.env.NFSE_DISCOVERY_ONLY_GATE).toBeUndefined();
  });

  it('30 nenhum PASS indevido (incompleto / bloqueada)', async () => {
    const dir = await dirTmp();
    const canal = await prepararCanal(dir);
    const bloqueada = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-222a',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      page: PAGE,
      agora: AGORA,
    });
    expect(bloqueada.estadoOperacional).toBe('BLOQUEADA');
    expect(bloqueada.resultadoDiscovery).toBeNull();

    const ticket = await canal.consultar('exec-222a');
    await canal.ativarDiscoveryReal(ticket!.autorizacaoId, 'teste-h222a-incompleto', AGORA);
    const incompleta = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-222a',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      page: PAGE,
      discover: async (input) =>
        fecharMock({
          tipo: input.tipo,
          status: 'DISCOVERY_INCOMPLETE',
          inventario: montarInventario({
            id: 'p',
            cnpj: CNPJ,
            periodoConsulta: PERIODO,
            documentos: [],
            completude: 'PARCIAL',
          }),
          paginas: 1,
          diagnosticos: [{ codigo: 'CAPTURA_PARCIAL', mensagem: 'parcial' }],
        }),
      persistirEvidencias: false,
      agora: AGORA,
    });
    expect(incompleta.resultadoDiscovery?.veredito).not.toBe('PASS');
    expect(incompleta.estadoOperacional).toBe('INCOMPLETA');
  });
});

async function dirTmp(): Promise<string> {
  const d = await mkdtemp(path.join(tmpdir(), 'an-h222a-'));
  dirs.push(d);
  return d;
}

async function prepararCanal(
  dir: string,
  limites: Partial<{ maxPaginas: number; maxDocumentos: number; timeoutMs: number }> = {},
  opts: { ativar?: boolean } = {}
): Promise<CanalAutorizacaoHomologacao> {
  const canal = criarCanalAutorizacaoMemoria();
  configurarCanalHomologacaoOperacional(canal);
  const auth = criarAutorizacaoHomologacao({
    cnpj: CNPJ,
    periodoConsulta: PERIODO,
    execucaoId: 'exec-222a',
    operacao: 'DISCOVERY_ONLY',
    validoAte: VALIDO_ATE,
    diretorioFiscal: dir,
    limites: criarLimitesHomologacao({
      maxDocumentos: limites.maxDocumentos ?? 20,
      maxPaginas: limites.maxPaginas ?? 10,
      maxRequisicoesSefin: 0,
      timeoutMs: limites.timeoutMs ?? 30_000,
    }),
    motivo: 'teste-h222a',
    agora: AGORA,
  });
  const ticket = await canal.emitir({
    versao: 1,
    autorizacaoId: criarAutorizacaoId(),
    autorizacao: auth,
    emitidoEm: AGORA.toISOString(),
  });
  if (opts.ativar) {
    await canal.ativarDiscoveryReal(ticket.autorizacaoId, 'teste-h222a-ativacao', AGORA);
  }
  return canal;
}

function chave(n: number): string {
  return String(n).padStart(50, '1');
}

function inv(
  direcao: 'EMITIDA' | 'RECEBIDA',
  itens: { n: number }[]
): InventarioNfse {
  return montarInventario({
    id: `inv-${direcao}-${itens.length}`,
    cnpj: CNPJ,
    periodoConsulta: PERIODO,
    documentos: itens.map((i) =>
      criarDocumentoFiscal({
        chaveNacional: chave(i.n),
        cnpj: CNPJ,
        direcao,
        situacao: 'VIGENTE',
        periodoConsulta: PERIODO,
      })
    ),
    completude: 'COMPLETO',
  });
}

function fecharMock(input: {
  tipo: DiscoverNfseInput['tipo'];
  status: ResultadoDescobertaNfse['status'];
  inventario: InventarioNfse;
  paginas: number;
  diagnosticos?: ResultadoDescobertaNfse['diagnosticos'];
}): ResultadoDescobertaNfse {
  return {
    cnpj: CNPJ,
    periodoConsulta: PERIODO,
    tipo: input.tipo,
    status: input.status,
    inventario: input.inventario,
    registros: [],
    diagnosticos: input.diagnosticos ?? [],
    paginasPercorridas: input.paginas,
  };
}

function mockDiscover(
  mapa: Partial<Record<'EMITIDAS' | 'RECEBIDAS', InventarioNfse>>
): DiscoverNfseInjetavel {
  return async (input) => {
    const inventario =
      mapa[input.tipo as 'EMITIDAS' | 'RECEBIDAS'] ??
      inv(input.tipo === 'EMITIDAS' ? 'EMITIDA' : 'RECEBIDA', []);
    return fecharMock({
      tipo: input.tipo,
      status: 'DISCOVERY_COMPLETE',
      inventario,
      paginas: 1,
    });
  };
}

function mockDiscoverCompleto(): DiscoverNfseInjetavel {
  return mockDiscover({
    EMITIDAS: inv('EMITIDA', [{ n: 1 }]),
    RECEBIDAS: inv('RECEBIDA', [{ n: 2 }]),
  });
}
