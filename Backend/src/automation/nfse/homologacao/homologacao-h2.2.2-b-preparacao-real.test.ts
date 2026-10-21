/**
 * H2.2.2-B — Preparação final Discovery-Only (offline).
 * Ativação individual + discover injetável; sem Portal/SEFIN/certificado.
 */
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
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
  GATE_EXECUCAO_REAL_DISCOVERY_ONLY,
  type AutorizacaoHomologacaoNfse,
  type CanalAutorizacaoHomologacao,
  type DiscoverNfseInjetavel,
} from './index';

const CNPJ = '11222333000181';
const CNPJ_OUTRO = '99888777000166';
const PERIODO = criarPeriodoConsultaPortal('01/01/2024', '31/01/2024');
const PERIODO_OUTRO = criarPeriodoConsultaPortal('01/02/2024', '28/02/2024');
const AGORA = new Date('2024-06-15T12:00:00.000Z');
const VALIDO_ATE = '2024-06-16T12:00:00.000Z';
const PAGE = { id: 'page-auth' } as unknown as Page;
const PAGE_B = { id: 'page-outro' } as unknown as Page;

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

describe('H2.2.2-B preparação real Discovery-Only offline', () => {
  it('01 sem autorização → legado', async () => {
    configurarCanalHomologacaoOperacional(criarCanalAutorizacaoMemoria());
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-222b',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      page: PAGE,
      discover: mockDiscoverCompleto(),
      agora: AGORA,
    });
    expect(r.situacao).toBe('SEM_AUTORIZACAO');
    expect(r.encerrarEtapaFiscal).toBe(false);
    expect(r.descobertaExecutada).toBe(false);
  });

  it('02 autorização inválida → bloqueio', async () => {
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

  it('03 autorização válida de outra empresa', async () => {
    const dir = await dirTmp();
    await preparar(dir, { ativar: true });
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-222b',
      cnpj: CNPJ_OUTRO,
      periodoConsulta: PERIODO,
      pagePresente: true,
      page: PAGE,
      discover: mockDiscoverCompleto(),
      agora: AGORA,
    });
    expect(r.codigoErro).toBe('CNPJ_DIVERGENTE');
    expect(r.ticketConsumido).toBe(false);
    expect(r.descobertaExecutada).toBe(false);
  });

  it('04 autorização válida de outro período', async () => {
    const dir = await dirTmp();
    await preparar(dir, { ativar: true });
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-222b',
      cnpj: CNPJ,
      periodoConsulta: PERIODO_OUTRO,
      pagePresente: true,
      page: PAGE,
      discover: mockDiscoverCompleto(),
      agora: AGORA,
    });
    expect(r.codigoErro).toBe('PERIODO_DIVERGENTE');
    expect(r.descobertaExecutada).toBe(false);
  });

  it('05 autorização expirada', async () => {
    const dir = await dirTmp();
    await preparar(dir, { ativar: true });
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-222b',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      page: PAGE,
      discover: mockDiscoverCompleto(),
      agora: new Date('2024-07-01T00:00:00.000Z'),
    });
    expect(r.codigoErro).toBe('AUTORIZACAO_EXPIRADA');
    expect(r.ticketConsumido).toBe(false);
  });

  it('06 gate fechado (padrão) sem ativação → BLOQUEADA', async () => {
    const dir = await dirTmp();
    await preparar(dir);
    expect(GATE_EXECUCAO_REAL_DISCOVERY_ONLY).toBe(false);
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-222b',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      page: PAGE,
      discover: mockDiscoverCompleto(),
      agora: AGORA,
    });
    expect(r.estadoOperacional).toBe('BLOQUEADA');
    expect(r.situacao).toBe('PREPARADA_GATE_FECHADO');
    expect(r.codigoErro).toBe('ATIVACAO_INDIVIDUAL_AUSENTE');
    expect(r.descobertaExecutada).toBe(false);
  });

  it('07 ativação individual válida → CONCLUIDA', async () => {
    const dir = await dirTmp();
    await preparar(dir, { ativar: true });
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-222b',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      page: PAGE,
      discover: mockDiscoverCompleto(),
      persistirEvidencias: false,
      agora: AGORA,
    });
    expect(r.estadoOperacional).toBe('CONCLUIDA');
    expect(r.ticketConsumido).toBe(true);
    expect(r.descobertaExecutada).toBe(true);
    expect(r.ticket?.ativacaoDiscoveryReal).toBe(true);
  });

  it('08 ativação de outra execução recusada', async () => {
    const dir = await dirTmp();
    const canal = await preparar(dir, { ativar: true, execucaoId: 'exec-A' });
    await canal.emitir({
      versao: 1,
      autorizacaoId: criarAutorizacaoId(),
      autorizacao: criarAuth(dir, 'exec-B'),
      emitidoEm: AGORA.toISOString(),
    });
    // exec-B sem ativação; discover presente
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-B',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      page: PAGE,
      discover: mockDiscoverCompleto(),
      agora: AGORA,
    });
    expect(r.estadoOperacional).toBe('BLOQUEADA');
    expect(r.codigoErro).toBe('ATIVACAO_INDIVIDUAL_AUSENTE');
    expect((await canal.consultar('exec-A'))?.ativacaoDiscoveryReal).toBe(true);
  });

  it('09 consumo único', async () => {
    const dir = await dirTmp();
    const canal = await preparar(dir, { ativar: true });
    const r1 = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-222b',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      page: PAGE,
      discover: mockDiscoverCompleto(),
      persistirEvidencias: false,
      agora: AGORA,
    });
    expect(r1.ticketConsumido).toBe(true);
    const r2 = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-222b',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      page: PAGE,
      discover: mockDiscoverCompleto(),
      agora: AGORA,
    });
    expect(r2.codigoErro).toBe('AUTORIZACAO_JA_CONSUMIDA');
    expect((await canal.consultar('exec-222b'))?.estado).toBe('CONSUMIDA');
  });

  it('10 concorrência', async () => {
    const dir = await dirTmp();
    const canal = await preparar(dir, { ativar: true });
    const ctx = {
      execucaoId: 'exec-222b',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      diretorioFiscal: dir,
      agora: AGORA,
    };
    const rs = await Promise.allSettled([
      canal.consumir('exec-222b', ctx, 'TESTE'),
      canal.consumir('exec-222b', ctx, 'TESTE'),
    ]);
    expect(rs.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(rs.filter((x) => x.status === 'rejected')).toHaveLength(1);
  });

  it('11 Page autenticada reutilizada', async () => {
    const dir = await dirTmp();
    await preparar(dir, { ativar: true });
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
      execucaoId: 'exec-222b',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      page: PAGE,
      discover,
      persistirEvidencias: false,
      agora: AGORA,
    });
    expect(pages.length).toBe(2);
    expect(pages.every((p) => p === PAGE)).toBe(true);
    expect(pages.some((p) => p === PAGE_B)).toBe(false);
  });

  it('12 discover real injetado via mock', async () => {
    const dir = await dirTmp();
    await preparar(dir, { ativar: true });
    let chamadas = 0;
    const discover: DiscoverNfseInjetavel = async (input) => {
      chamadas += 1;
      return fecharMock({
        tipo: input.tipo,
        status: 'DISCOVERY_COMPLETE',
        inventario: inv(input.tipo === 'EMITIDAS' ? 'EMITIDA' : 'RECEBIDA', [{ n: chamadas }]),
        paginas: 1,
      });
    };
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-222b',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      page: PAGE,
      discover,
      persistirEvidencias: false,
      agora: AGORA,
    });
    expect(chamadas).toBe(2);
    expect(r.efeitosProibidos.discoverNfse).toBe(true);
  });

  it('13 emitidas e recebidas', async () => {
    const dir = await dirTmp();
    await preparar(dir, { ativar: true });
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-222b',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      page: PAGE,
      discover: mockDiscover({
        EMITIDAS: inv('EMITIDA', [{ n: 1 }, { n: 2 }]),
        RECEBIDAS: inv('RECEBIDA', [{ n: 3 }]),
      }),
      persistirEvidencias: false,
      agora: AGORA,
    });
    expect(r.resultadoDiscovery?.totais.emitidas).toBe(2);
    expect(r.resultadoDiscovery?.totais.recebidas).toBe(1);
  });

  it('14 paginação (orçamento global)', async () => {
    const dir = await dirTmp();
    await preparar(dir, { ativar: true, maxPaginas: 5 });
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
      execucaoId: 'exec-222b',
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

  it('15 limites (páginas) → INCOMPLETA', async () => {
    const dir = await dirTmp();
    await preparar(dir, { ativar: true, maxPaginas: 1 });
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-222b',
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
          diagnosticos: [{ codigo: 'LIMITE_PAGINAS', mensagem: 'limite' }],
        }),
      persistirEvidencias: false,
      agora: AGORA,
    });
    expect(r.estadoOperacional).toBe('INCOMPLETA');
    expect(r.resultadoDiscovery?.veredito).not.toBe('PASS');
  });

  it('16 timeout', async () => {
    const dir = await dirTmp();
    await preparar(dir, { ativar: true, timeoutMs: 100 });
    let tick = AGORA.getTime();
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-222b',
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
    expect(r.resultadoDiscovery?.codigoErro).toBe('TIMEOUT');
    expect(r.ticketConsumido).toBe(true);
  });

  it('17 cancelamento (ticket permanece consumido)', async () => {
    const dir = await dirTmp();
    const canal = await preparar(dir, { ativar: true });
    const ac = new AbortController();
    ac.abort();
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-222b',
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
    expect((await canal.consultar('exec-222b'))?.estado).toBe('CONSUMIDA');
  });

  it('18 inventário incompleto', async () => {
    const dir = await dirTmp();
    await preparar(dir, { ativar: true });
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-222b',
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
    expect(r.estadoOperacional).toBe('INCOMPLETA');
    expect(r.resultadoDiscovery?.estadoInventario).not.toBe('COMPLETO');
  });

  it('19 falha de evidência', async () => {
    const dir = await dirTmp();
    await preparar(dir, { ativar: true });
    await writeFile(path.join(dir, 'homologacao'), 'bloqueio', 'utf8');
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-222b',
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

  it('20 encerramento sem legado', async () => {
    const dir = await dirTmp();
    await preparar(dir, { ativar: true });
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-222b',
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

  it('21 nenhuma chamada SEFIN', async () => {
    const dir = await dirTmp();
    await preparar(dir, { ativar: true });
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-222b',
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

  it('22 nenhuma escrita XML', async () => {
    const dir = await dirTmp();
    await preparar(dir, { ativar: true });
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-222b',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      page: PAGE,
      discover: mockDiscoverCompleto(),
      persistirEvidencias: true,
      agora: AGORA,
    });
    expect(r.efeitosProibidos.escritaXml).toBe(false);
    const pasta = path.join(dir, 'homologacao');
    const arquivos = await readdir(pasta);
    expect(arquivos.every((a) => !a.endsWith('.xml'))).toBe(true);
  });

  it('23 nenhum checkpoint', async () => {
    const dir = await dirTmp();
    await preparar(dir, { ativar: true });
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-222b',
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

  it('24 nenhum navegador adicional', async () => {
    const dir = await dirTmp();
    await preparar(dir, { ativar: true });
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-222b',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      page: PAGE,
      discover: mockDiscoverCompleto(),
      persistirEvidencias: false,
      agora: AGORA,
    });
    expect(r.efeitosProibidos.navegadorAdicional).toBe(false);
  });

  it('25 nenhum login adicional', async () => {
    const dir = await dirTmp();
    await preparar(dir, { ativar: true });
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-222b',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      page: PAGE,
      discover: mockDiscoverCompleto(),
      persistirEvidencias: false,
      agora: AGORA,
    });
    expect(r.efeitosProibidos.loginAdicional).toBe(false);
  });

  it('26 gate aberto sozinho é insuficiente', async () => {
    const dir = await dirTmp();
    await preparar(dir);
    definirGateExecucaoRealSomenteTeste(true);
    let chamadas = 0;
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-222b',
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
    expect(r.situacao).toBe('BLOQUEADA_GATE_REAL');
    expect(r.codigoErro).toBe('ATIVACAO_INDIVIDUAL_AUSENTE');
  });

  it('27 falha/timeout não liberam ticket', async () => {
    const dir = await dirTmp();
    const canal = await preparar(dir, { ativar: true, timeoutMs: 50 });
    let tick = AGORA.getTime();
    await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-222b',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      page: PAGE,
      discover: async (input) => {
        input.controle?.antesDeOperacao?.('antes');
        tick += 100_000;
        input.controle?.antesDeOperacao?.('depois');
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
    expect((await canal.consultar('exec-222b'))?.estado).toBe('CONSUMIDA');
  });
});

/**
 * Revisão final H2.2.2-B — comprovação A/B com gate global fechado.
 * Política: ativação individual autoriza exceção; gate fechado não impede A.
 */
describe('H2.2.2-B revisão A/B ativação individual (gate fechado)', () => {
  it('Ticket A ativado executa; B bloqueado; sem ticket não discovery; sem SEFIN/XML/checkpoint', async () => {
    expect(GATE_EXECUCAO_REAL_DISCOVERY_ONLY).toBe(false);
    definirGateExecucaoRealSomenteTeste(null); // garante gate padrão fechado

    const dirA = await dirTmp();
    const dirB = await dirTmp();
    const canal = criarCanalAutorizacaoMemoria();
    configurarCanalHomologacaoOperacional(canal);

    const ticketA = await canal.emitir({
      versao: 1,
      autorizacaoId: criarAutorizacaoId(),
      autorizacao: criarAuth(dirA, 'exec-A'),
      emitidoEm: AGORA.toISOString(),
    });
    await canal.emitir({
      versao: 1,
      autorizacaoId: criarAutorizacaoId(),
      autorizacao: criarAuth(dirB, 'exec-B'),
      emitidoEm: AGORA.toISOString(),
    });

    // Somente A recebe ativação individual explícita
    await canal.ativarDiscoveryReal(ticketA.autorizacaoId, 'revisao-ab-ticket-A', AGORA);

    expect((await canal.consultar('exec-A'))?.ativacaoDiscoveryReal).toBe(true);
    expect((await canal.consultar('exec-B'))?.ativacaoDiscoveryReal).toBe(false);

    const discoverCalls: { execucaoId: string; tipo: string }[] = [];
    const discover: DiscoverNfseInjetavel = async (input) => {
      // rastreia por page id / ordem — A e B usam PAGE; contamos chamadas globais
      discoverCalls.push({ execucaoId: 'em-voo', tipo: String(input.tipo) });
      return fecharMock({
        tipo: input.tipo,
        status: 'DISCOVERY_COMPLETE',
        inventario: inv(input.tipo === 'EMITIDAS' ? 'EMITIDA' : 'RECEBIDA', [{ n: discoverCalls.length }]),
        paginas: 1,
      });
    };

    const rA = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-A',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      page: PAGE,
      discover,
      persistirEvidencias: false,
      agora: AGORA,
    });

    const callsAposA = discoverCalls.length;
    expect(rA.descobertaExecutada).toBe(true);
    expect(rA.ticketConsumido).toBe(true);
    expect(rA.estadoOperacional).toBe('CONCLUIDA');
    expect(callsAposA).toBe(2); // EMITIDAS + RECEBIDAS
    expect(rA.efeitosProibidos).toMatchObject({
      sefin: false,
      escritaXml: false,
      checkpointRecuperacao: false,
      navegadorAdicional: false,
      loginAdicional: false,
    });
    expect(rA.resultadoDiscovery?.limitesAplicados.maxRequisicoesSefin).toBe(0);

    const rB = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-B',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      page: PAGE,
      discover,
      persistirEvidencias: false,
      agora: AGORA,
    });

    expect(rB.estadoOperacional).toBe('BLOQUEADA');
    expect(rB.codigoErro).toBe('ATIVACAO_INDIVIDUAL_AUSENTE');
    expect(rB.descobertaExecutada).toBe(false);
    expect(rB.ticketConsumido).toBe(false);
    expect(discoverCalls.length).toBe(callsAposA); // B não chamou discover
    expect((await canal.consultar('exec-B'))?.estado).toBe('DISPONIVEL');

    // Sem ticket → legado (não acessa discovery)
    const rSem = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'exec-SEM-TICKET',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      page: PAGE,
      discover,
      agora: AGORA,
    });
    expect(rSem.situacao).toBe('SEM_AUTORIZACAO');
    expect(rSem.encerrarEtapaFiscal).toBe(false);
    expect(rSem.descobertaExecutada).toBe(false);
    expect(discoverCalls.length).toBe(callsAposA);

    // Gate permanece fechado após o fluxo
    expect(GATE_EXECUCAO_REAL_DISCOVERY_ONLY).toBe(false);
  });
});

async function dirTmp(): Promise<string> {
  const d = await mkdtemp(path.join(tmpdir(), 'an-h222b-'));
  dirs.push(d);
  return d;
}

function criarAuth(dir: string, execucaoId: string, limites: {
  maxPaginas?: number;
  maxDocumentos?: number;
  timeoutMs?: number;
} = {}): AutorizacaoHomologacaoNfse {
  return criarAutorizacaoHomologacao({
    cnpj: CNPJ,
    periodoConsulta: PERIODO,
    execucaoId,
    operacao: 'DISCOVERY_ONLY',
    validoAte: VALIDO_ATE,
    diretorioFiscal: dir,
    limites: criarLimitesHomologacao({
      maxDocumentos: limites.maxDocumentos ?? 20,
      maxPaginas: limites.maxPaginas ?? 10,
      maxRequisicoesSefin: 0,
      timeoutMs: limites.timeoutMs ?? 30_000,
    }),
    motivo: 'teste-h222b',
    agora: AGORA,
  });
}

async function preparar(
  dir: string,
  opts: {
    ativar?: boolean;
    execucaoId?: string;
    maxPaginas?: number;
    maxDocumentos?: number;
    timeoutMs?: number;
  } = {}
): Promise<CanalAutorizacaoHomologacao> {
  const canal = criarCanalAutorizacaoMemoria();
  configurarCanalHomologacaoOperacional(canal);
  const execucaoId = opts.execucaoId ?? 'exec-222b';
  const ticket = await canal.emitir({
    versao: 1,
    autorizacaoId: criarAutorizacaoId(),
    autorizacao: criarAuth(dir, execucaoId, opts),
    emitidoEm: AGORA.toISOString(),
  });
  if (opts.ativar) {
    await canal.ativarDiscoveryReal(ticket.autorizacaoId, 'h222b-ativacao-individual', AGORA);
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
