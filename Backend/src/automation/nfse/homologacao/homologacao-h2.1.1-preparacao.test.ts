/**
 * H2.1.1 — Segurança de limites e preparação H2.2 (offline).
 * Sem Playwright real, Portal, SEFIN ou certificados.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Page } from 'playwright';
import { criarDocumentoFiscal } from '../contracts/documento-fiscal';
import { montarInventario, type InventarioNfse } from '../contracts/inventario';
import { criarPeriodoConsultaPortal } from '../contracts/periodo';
import type { DiscoverNfseInput } from '../discovery/discovery-service';
import type { ResultadoDescobertaNfse } from '../discovery/types';
import {
  criarAutorizacaoHomologacao,
  criarLimitesHomologacao,
  evidenciaContemSegredo,
  executarDiscoveryOnlyHomologacao,
  persistirEvidenciasHomologacao,
  type AutorizacaoHomologacaoNfse,
  type DiscoverNfseInjetavel,
} from './index';

const CNPJ = '11222333000181';
const PERIODO = criarPeriodoConsultaPortal('01/01/2024', '31/01/2024');
const AGORA = new Date('2024-06-15T12:00:00.000Z');
const VALIDO_ATE = '2024-06-16T12:00:00.000Z';
const PAGE = {} as Page;

const dirsTemporarios: string[] = [];

afterEach(async () => {
  while (dirsTemporarios.length) {
    const dir = dirsTemporarios.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe('H2.1.1 limites, abort, evidências e isolamento', () => {
  it('01 timeout durante Emitidas', async () => {
    const dir = await dirFiscal();
    let tick = AGORA.getTime();
    const chamadas: string[] = [];
    const discover: DiscoverNfseInjetavel = async (input) => {
      chamadas.push(input.tipo);
      input.controle?.antesDeOperacao?.('antes_pagina');
      tick += 10_000;
      input.controle?.antesDeOperacao?.('apos_pagina');
      return fecharMock({
        tipo: input.tipo,
        status: 'DISCOVERY_COMPLETE',
        inventario: inventarioDirecao('EMITIDA', [{ n: 1, situacao: 'VIGENTE' }]),
        paginasPercorridas: 1,
      });
    };
    const resultado = await executarDiscoveryOnlyHomologacao({
      autorizacao: authDiscovery({ timeoutMs: 5_000, diretorio: dir }),
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'exec-h211',
      diretorioFiscal: dir,
      discover,
      agora: AGORA,
      relogio: () => new Date(tick),
    });
    expect(resultado.veredito).not.toBe('PASS');
    expect(resultado.codigoErro).toBe('TIMEOUT');
    expect(chamadas).toEqual(['EMITIDAS']);
  });

  it('02 timeout durante Recebidas', async () => {
    const dir = await dirFiscal();
    let tick = AGORA.getTime();
    const chamadas: string[] = [];
    const discover: DiscoverNfseInjetavel = async (input) => {
      chamadas.push(input.tipo);
      if (input.tipo === 'RECEBIDAS') {
        tick += 50_000;
        input.controle?.antesDeOperacao?.('antes_navegacao');
      }
      return fecharMock({
        tipo: input.tipo,
        status: 'DISCOVERY_COMPLETE',
        inventario: inventarioDirecao(
          input.tipo === 'EMITIDAS' ? 'EMITIDA' : 'RECEBIDA',
          input.tipo === 'EMITIDAS' ? [{ n: 1, situacao: 'VIGENTE' }] : []
        ),
        paginasPercorridas: 1,
      });
    };
    const resultado = await executarDiscoveryOnlyHomologacao({
      autorizacao: authDiscovery({ timeoutMs: 10_000, diretorio: dir }),
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'exec-h211',
      diretorioFiscal: dir,
      discover,
      agora: AGORA,
      relogio: () => new Date(tick),
    });
    expect(resultado.codigoErro).toBe('TIMEOUT');
    expect(resultado.veredito).not.toBe('PASS');
    expect(chamadas).toEqual(['EMITIDAS', 'RECEBIDAS']);
  });

  it('03 abort durante paginação', async () => {
    const dir = await dirFiscal();
    const ac = new AbortController();
    const discover: DiscoverNfseInjetavel = async (input) => {
      input.controle?.antesDeOperacao?.('antes_pagina');
      ac.abort();
      input.controle?.antesDeOperacao?.('apos_pagina');
      return fecharMock({
        tipo: input.tipo,
        status: 'DISCOVERY_COMPLETE',
        inventario: inventarioDirecao('EMITIDA', []),
        paginasPercorridas: 1,
      });
    };
    const resultado = await executarDiscoveryOnlyHomologacao({
      autorizacao: authDiscovery({ diretorio: dir }),
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'exec-h211',
      diretorioFiscal: dir,
      discover,
      agora: AGORA,
      signal: ac.signal,
    });
    expect(resultado.codigoErro).toBe('INTERRUPCAO');
    expect(resultado.veredito).not.toBe('PASS');
  });

  it('04 abort antes da navegação', async () => {
    const dir = await dirFiscal();
    const ac = new AbortController();
    ac.abort();
    const chamadas: string[] = [];
    const resultado = await executarDiscoveryOnlyHomologacao({
      autorizacao: authDiscovery({ diretorio: dir }),
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'exec-h211',
      diretorioFiscal: dir,
      discover: async (input) => {
        chamadas.push(input.tipo);
        return fecharMock({
          tipo: input.tipo,
          status: 'DISCOVERY_COMPLETE',
          inventario: inventarioDirecao('EMITIDA', []),
          paginasPercorridas: 0,
        });
      },
      agora: AGORA,
      signal: ac.signal,
    });
    expect(resultado.codigoErro).toBe('INTERRUPCAO');
    expect(chamadas).toEqual([]);
    expect(resultado.veredito).toBe('FAIL');
  });

  it('05 limite de documentos na primeira direção', async () => {
    const dir = await dirFiscal();
    const chamadas: string[] = [];
    const resultado = await executarDiscoveryOnlyHomologacao({
      autorizacao: authDiscovery({ maxDocumentos: 2, diretorio: dir }),
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'exec-h211',
      diretorioFiscal: dir,
      discover: mockDiscover(chamadas, {
        EMITIDAS: inventarioDirecao('EMITIDA', [
          { n: 1, situacao: 'VIGENTE' },
          { n: 2, situacao: 'VIGENTE' },
          { n: 3, situacao: 'VIGENTE' },
        ]),
        RECEBIDAS: inventarioDirecao('RECEBIDA', [{ n: 4, situacao: 'VIGENTE' }]),
      }),
      agora: AGORA,
    });
    expect(resultado.codigoErro).toBe('LIMITE_DOCUMENTOS');
    expect(resultado.estadoInventario).toBe('PARCIAL');
    expect(resultado.veredito).toBe('INCOMPLETO');
    expect(chamadas).toEqual(['EMITIDAS']);
  });

  it('06 limite de documentos na segunda direção', async () => {
    const dir = await dirFiscal();
    const chamadas: string[] = [];
    const orcamentos: number[] = [];
    const discover: DiscoverNfseInjetavel = async (input) => {
      chamadas.push(input.tipo);
      orcamentos.push(input.maxDocumentos ?? -1);
      if (input.tipo === 'EMITIDAS') {
        return fecharMock({
          tipo: input.tipo,
          status: 'DISCOVERY_COMPLETE',
          inventario: inventarioDirecao('EMITIDA', [
            { n: 1, situacao: 'VIGENTE' },
            { n: 2, situacao: 'VIGENTE' },
          ]),
          paginasPercorridas: 1,
        });
      }
      return fecharMock({
        tipo: input.tipo,
        status: 'DISCOVERY_INCOMPLETE',
        inventario: inventarioDirecao('RECEBIDA', [
          { n: 3, situacao: 'VIGENTE' },
          { n: 4, situacao: 'VIGENTE' },
        ]),
        paginasPercorridas: 1,
        diagnosticos: [
          {
            codigo: 'LIMITE_DOCUMENTOS',
            mensagem: 'Limite de documentos atingido.',
          },
        ],
      });
    };
    const resultado = await executarDiscoveryOnlyHomologacao({
      autorizacao: authDiscovery({ maxDocumentos: 3, diretorio: dir }),
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'exec-h211',
      diretorioFiscal: dir,
      discover,
      agora: AGORA,
    });
    expect(chamadas).toEqual(['EMITIDAS', 'RECEBIDAS']);
    expect(orcamentos).toEqual([3, 1]);
    expect(resultado.codigoErro).toBe('LIMITE_DOCUMENTOS');
    expect(resultado.veredito).toBe('INCOMPLETO');
  });

  it('07 limite global de páginas (não reinicia entre direções)', async () => {
    const dir = await dirFiscal();
    const maxRecebidos: number[] = [];
    const discover: DiscoverNfseInjetavel = async (input) => {
      maxRecebidos.push(input.maxPaginas ?? -1);
      return fecharMock({
        tipo: input.tipo,
        status: 'DISCOVERY_COMPLETE',
        inventario: inventarioDirecao(
          input.tipo === 'EMITIDAS' ? 'EMITIDA' : 'RECEBIDA',
          []
        ),
        paginasPercorridas: 2,
      });
    };
    await executarDiscoveryOnlyHomologacao({
      autorizacao: authDiscovery({ maxPaginas: 5, diretorio: dir }),
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'exec-h211',
      diretorioFiscal: dir,
      discover,
      agora: AGORA,
    });
    expect(maxRecebidos).toEqual([5, 3]);
  });

  it('08 paginação truncada → inventário incompleto', async () => {
    const dir = await dirFiscal();
    const resultado = await executarDiscoveryOnlyHomologacao({
      autorizacao: authDiscovery({ maxPaginas: 1, diretorio: dir }),
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'exec-h211',
      diretorioFiscal: dir,
      discover: async (input) =>
        fecharMock({
          tipo: input.tipo,
          status: 'DISCOVERY_INCOMPLETE',
          inventario: inventarioDirecao('EMITIDA', [{ n: 1, situacao: 'VIGENTE' }]),
          paginasPercorridas: 1,
          diagnosticos: [
            { codigo: 'LIMITE_PAGINAS', mensagem: 'Limite de 1 páginas atingido.' },
          ],
        }),
      agora: AGORA,
    });
    expect(resultado.estadoInventario).toBe('PARCIAL');
    expect(resultado.veredito).toBe('INCOMPLETO');
    expect(resultado.codigoErro).toBe('LIMITE_PAGINAS');
  });

  it('09 inventário incompleto sem PASS', async () => {
    const dir = await dirFiscal();
    const resultado = await executarDiscoveryOnlyHomologacao({
      autorizacao: authDiscovery({ diretorio: dir }),
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'exec-h211',
      diretorioFiscal: dir,
      discover: async (input) =>
        fecharMock({
          tipo: input.tipo,
          status: 'DISCOVERY_INCOMPLETE',
          inventario: montarInventario({
            id: `inv-${input.tipo}`,
            cnpj: CNPJ,
            periodoConsulta: PERIODO,
            documentos: [],
            completude: 'PARCIAL',
          }),
          paginasPercorridas: 1,
          diagnosticos: [{ codigo: 'CAPTURA_PARCIAL', mensagem: 'parcial' }],
        }),
      agora: AGORA,
    });
    expect(resultado.veredito).toBe('INCOMPLETO');
    expect(resultado.veredito).not.toBe('PASS');
  });

  it('10 nenhum PASS após cancelamento', async () => {
    const dir = await dirFiscal();
    const ac = new AbortController();
    ac.abort();
    const resultado = await executarDiscoveryOnlyHomologacao({
      autorizacao: authDiscovery({ diretorio: dir }),
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'exec-h211',
      diretorioFiscal: dir,
      discover: mockDiscover([]),
      agora: AGORA,
      signal: ac.signal,
    });
    expect(resultado.veredito).not.toBe('PASS');
    expect(resultado.evidencias.every((e) => e.detalhes.veredito !== 'PASS')).toBe(true);
  });

  it('11 nenhuma chamada SEFIN', async () => {
    const r = await okMinimo();
    expect(r.efeitosProibidos.sefin).toBe(false);
    expect(r.limitesAplicados.maxRequisicoesSefin).toBe(0);
  });

  it('12 nenhum XML gravado', async () => {
    expect((await okMinimo()).efeitosProibidos.escritaXml).toBe(false);
  });

  it('13 nenhum checkpoint de recuperação', async () => {
    expect((await okMinimo()).efeitosProibidos.checkpointRecuperacao).toBe(false);
  });

  it('14 nenhum navegador adicional', async () => {
    const dir = await dirFiscal();
    const pages: Page[] = [];
    const resultado = await executarDiscoveryOnlyHomologacao({
      autorizacao: authDiscovery({ diretorio: dir }),
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'exec-h211',
      diretorioFiscal: dir,
      discover: async (input) => {
        pages.push(input.page);
        return fecharMock({
          tipo: input.tipo,
          status: 'DISCOVERY_COMPLETE',
          inventario: inventarioDirecao(
            input.tipo === 'EMITIDAS' ? 'EMITIDA' : 'RECEBIDA',
            []
          ),
          paginasPercorridas: 1,
        });
      },
      agora: AGORA,
    });
    expect(pages.every((p) => p === PAGE)).toBe(true);
    expect(resultado.efeitosProibidos.navegadorAdicional).toBe(false);
  });

  it('15 nenhum login adicional', async () => {
    expect((await okMinimo()).efeitosProibidos.loginAdicional).toBe(false);
  });

  it('16 nenhuma alteração do legado ({autorizada:true} isolado)', async () => {
    const dir = await dirFiscal();
    const chamadas: string[] = [];
    const resultado = await executarDiscoveryOnlyHomologacao({
      autorizacao: { autorizada: true } as unknown as AutorizacaoHomologacaoNfse,
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'exec-h211',
      diretorioFiscal: dir,
      discover: mockDiscover(chamadas),
      agora: AGORA,
    });
    expect(resultado.codigoErro).toBe('AUTORIZACAO_MALFORMADA');
    expect(chamadas).toEqual([]);
  });

  it('17 evidência persistida (diretório temporário)', async () => {
    const dir = await dirFiscal();
    const resultado = await executarDiscoveryOnlyHomologacao({
      autorizacao: authDiscovery({ diretorio: dir }),
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'exec-h211',
      diretorioFiscal: dir,
      discover: mockDiscover([], {
        EMITIDAS: inventarioDirecao('EMITIDA', []),
        RECEBIDAS: inventarioDirecao('RECEBIDA', []),
      }),
      agora: AGORA,
      persistirEvidencias: true,
    });
    expect(resultado.veredito).toBe('PASS');
    expect(
      resultado.evidencias.some((e) => e.evento === 'discovery_only_evidencia_persistida')
    ).toBe(true);
    const pasta = path.join(dir, 'homologacao');
    const { readdir } = await import('node:fs/promises');
    const arquivos = await readdir(pasta);
    expect(arquivos.some((a) => a.startsWith('evidencia-h2-') && a.endsWith('.json'))).toBe(true);
    const corpo = await readFile(path.join(pasta, arquivos[0]!), 'utf8');
    expect(corpo).toContain('cnpjMascarado');
    expect(corpo).not.toContain(CNPJ);
    expect(corpo.toLowerCase()).not.toContain('"senha"');
  });

  it('18 evidência imutável (não sobrescreve)', async () => {
    const dir = await dirFiscal();
    const auth = authDiscovery({ diretorio: dir });
    const base = await executarDiscoveryOnlyHomologacao({
      autorizacao: auth,
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'exec-h211',
      diretorioFiscal: dir,
      discover: mockDiscover([], {
        EMITIDAS: inventarioDirecao('EMITIDA', []),
        RECEBIDAS: inventarioDirecao('RECEBIDA', []),
      }),
      agora: AGORA,
    });
    const p1 = await persistirEvidenciasHomologacao({
      diretorioFiscal: dir,
      execucaoId: 'exec-h211',
      evidencias: base.evidencias,
      resultado: base,
      agora: AGORA,
    });
    await expect(
      persistirEvidenciasHomologacao({
        diretorioFiscal: dir,
        execucaoId: 'exec-h211',
        evidencias: base.evidencias,
        resultado: base,
        agora: AGORA,
      })
    ).rejects.toMatchObject({ codigo: 'FALHA_EVIDENCIA' });
    const novamente = await readFile(p1.caminho, 'utf8');
    expect(novamente).toContain('"veredito": "PASS"');
  });

  it('19 falha de escrita', async () => {
    const dir = await dirFiscal();
    const bloqueio = path.join(dir, 'homologacao');
    await writeFile(bloqueio, 'nao-e-diretorio', 'utf8');
    const base = await okMinimo(dir);
    await expect(
      persistirEvidenciasHomologacao({
        diretorioFiscal: dir,
        execucaoId: 'exec-h211',
        evidencias: base.evidencias,
        resultado: base,
        agora: AGORA,
      })
    ).rejects.toMatchObject({ codigo: 'FALHA_EVIDENCIA' });
  });

  it('20 erros sanitizados (sem chave completa / senha)', async () => {
    const dir = await dirFiscal();
    const chaveCompleta = '1'.repeat(50);
    const resultado = await executarDiscoveryOnlyHomologacao({
      autorizacao: authDiscovery({ diretorio: dir }),
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'exec-h211',
      diretorioFiscal: dir,
      discover: async (input) =>
        fecharMock({
          tipo: input.tipo,
          status: 'DISCOVERY_FAILED',
          inventario: inventarioDirecao('EMITIDA', []),
          paginasPercorridas: 0,
          diagnosticos: [
            {
              codigo: 'NAV_FALHA',
              mensagem: `falha senha=segredo123 chave ${chaveCompleta}`,
            },
          ],
        }),
      agora: AGORA,
    });
    const msgs = resultado.diagnosticos.map((d) => d.mensagem).join(' ');
    expect(msgs).toContain('senha=***');
    expect(msgs).toContain('[chave-omitida]');
    expect(msgs).not.toContain(chaveCompleta);
    expect(msgs).not.toContain('segredo123');
    expect(resultado.evidencias.every((e) => !evidenciaContemSegredo(e))).toBe(true);
  });
});

async function dirFiscal(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'an-h211-'));
  dirsTemporarios.push(dir);
  return dir;
}

function authDiscovery(
  limites: Partial<{
    maxDocumentos: number;
    maxPaginas: number;
    timeoutMs: number;
    diretorio: string;
  }> = {}
): AutorizacaoHomologacaoNfse {
  return criarAutorizacaoHomologacao({
    cnpj: CNPJ,
    periodoConsulta: PERIODO,
    execucaoId: 'exec-h211',
    operacao: 'DISCOVERY_ONLY',
    validoAte: VALIDO_ATE,
    diretorioFiscal: limites.diretorio ?? '/tmp/autonacional-fiscal-h211',
    limites: criarLimitesHomologacao({
      maxDocumentos: limites.maxDocumentos ?? 20,
      maxPaginas: limites.maxPaginas ?? 10,
      maxRequisicoesSefin: 0,
      timeoutMs: limites.timeoutMs ?? 30_000,
    }),
    motivo: 'teste-h211',
    agora: AGORA,
  });
}

async function okMinimo(dir?: string) {
  const diretorio = dir ?? (await dirFiscal());
  return executarDiscoveryOnlyHomologacao({
    autorizacao: authDiscovery({ diretorio }),
    page: PAGE,
    cnpj: CNPJ,
    periodoConsulta: PERIODO,
    execucaoId: 'exec-h211',
    diretorioFiscal: diretorio,
    discover: mockDiscover([], {
      EMITIDAS: inventarioDirecao('EMITIDA', []),
      RECEBIDAS: inventarioDirecao('RECEBIDA', []),
    }),
    agora: AGORA,
  });
}

function chave(n: number): string {
  return String(n).padStart(50, '1');
}

function inventarioDirecao(
  direcao: 'EMITIDA' | 'RECEBIDA',
  itens: { n: number; situacao: 'VIGENTE' | 'CANCELADA' | 'INDETERMINADA' }[]
): InventarioNfse {
  return montarInventario({
    id: `inv-${direcao}-${itens.length}`,
    cnpj: CNPJ,
    periodoConsulta: PERIODO,
    documentos: itens.map((item) =>
      criarDocumentoFiscal({
        chaveNacional: chave(item.n),
        cnpj: CNPJ,
        direcao,
        situacao: item.situacao,
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
  paginasPercorridas: number;
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
    paginasPercorridas: input.paginasPercorridas,
  };
}

function mockDiscover(
  chamadas: string[],
  mapa: Partial<Record<'EMITIDAS' | 'RECEBIDAS', InventarioNfse>> = {}
): DiscoverNfseInjetavel {
  return async (input) => {
    chamadas.push(input.tipo);
    const inventario =
      mapa[input.tipo as 'EMITIDAS' | 'RECEBIDAS'] ??
      inventarioDirecao(input.tipo === 'EMITIDAS' ? 'EMITIDA' : 'RECEBIDA', []);
    return fecharMock({
      tipo: input.tipo,
      status: 'DISCOVERY_COMPLETE',
      inventario,
      paginasPercorridas: 1,
    });
  };
}
