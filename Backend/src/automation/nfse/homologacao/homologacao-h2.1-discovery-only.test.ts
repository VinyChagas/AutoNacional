/**
 * Homologação H2.1 — DISCOVERY_ONLY offline.
 * Sem Playwright real, Portal Nacional, SEFIN ou certificados.
 */
import { describe, expect, it } from 'vitest';
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
  type AutorizacaoHomologacaoNfse,
  type DiscoverNfseInjetavel,
} from './index';

const CNPJ = '11222333000181';
const PERIODO = criarPeriodoConsultaPortal('01/01/2024', '31/01/2024');
const PERIODO_OUTRO = criarPeriodoConsultaPortal('01/02/2024', '28/02/2024');
const DIR = '/tmp/autonacional-fiscal-h21';
const DIR_OUTRO = '/tmp/autonacional-fiscal-h21-outro';
const AGORA = new Date('2024-06-15T12:00:00.000Z');
const VALIDO_ATE = '2024-06-16T12:00:00.000Z';
const PAGE = {} as Page;

describe('H2.1 DISCOVERY_ONLY — autorização e isolamento', () => {
  it('01 autorização válida → PASS com inventário completo', async () => {
    const chamadas: string[] = [];
    const discover = mockDiscover(chamadas, {
      EMITIDAS: inventarioDirecao('EMITIDA', [
        { n: 1, situacao: 'VIGENTE' },
        { n: 2, situacao: 'CANCELADA' },
      ]),
      RECEBIDAS: inventarioDirecao('RECEBIDA', [
        { n: 3, situacao: 'VIGENTE' },
        { n: 4, situacao: 'INDETERMINADA' },
      ]),
    });

    const resultado = await executarDiscoveryOnlyHomologacao({
      autorizacao: authDiscovery(),
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'exec-h21',
      diretorioFiscal: DIR,
      discover,
      agora: AGORA,
    });

    expect(resultado.veredito).toBe('PASS');
    expect(resultado.estadoInventario).toBe('COMPLETO');
    expect(resultado.totais.emitidas).toBe(2);
    expect(resultado.totais.recebidas).toBe(2);
    expect(resultado.totais.vigentes).toBe(2);
    expect(resultado.totais.canceladas).toBe(1);
    expect(resultado.totais.indeterminadas).toBe(1);
    expect(resultado.cnpjMascarado).toMatch(/…/);
    expect(resultado.cnpjMascarado).not.toContain(CNPJ);
    expect(chamadas).toEqual(['EMITIDAS', 'RECEBIDAS']);
    expect(resultado.evidencias.some((e) => e.evento === 'discovery_only_inicio')).toBe(true);
    expect(resultado.evidencias.some((e) => e.evento === 'discovery_only_fim')).toBe(true);
    expect(resultado.evidencias.every((e) => !evidenciaContemSegredo(e))).toBe(true);
  });

  it('02 autorização ausente → FAIL sem descoberta', async () => {
    const chamadas: string[] = [];
    const resultado = await executarDiscoveryOnlyHomologacao({
      autorizacao: null,
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'exec-h21',
      diretorioFiscal: DIR,
      discover: mockDiscover(chamadas),
      agora: AGORA,
    });
    expect(resultado.veredito).toBe('FAIL');
    expect(resultado.codigoErro).toBe('AUTORIZACAO_AUSENTE');
    expect(chamadas).toEqual([]);
  });

  it('03 CNPJ divergente → FAIL sem descoberta', async () => {
    const chamadas: string[] = [];
    const resultado = await executarDiscoveryOnlyHomologacao({
      autorizacao: authDiscovery(),
      page: PAGE,
      cnpj: '99888777000166',
      periodoConsulta: PERIODO,
      execucaoId: 'exec-h21',
      diretorioFiscal: DIR,
      discover: mockDiscover(chamadas),
      agora: AGORA,
    });
    expect(resultado.veredito).toBe('FAIL');
    expect(resultado.codigoErro).toBe('CNPJ_DIVERGENTE');
    expect(chamadas).toEqual([]);
  });

  it('04 período divergente → FAIL sem descoberta', async () => {
    const chamadas: string[] = [];
    const resultado = await executarDiscoveryOnlyHomologacao({
      autorizacao: authDiscovery(),
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: PERIODO_OUTRO,
      execucaoId: 'exec-h21',
      diretorioFiscal: DIR,
      discover: mockDiscover(chamadas),
      agora: AGORA,
    });
    expect(resultado.veredito).toBe('FAIL');
    expect(resultado.codigoErro).toBe('PERIODO_DIVERGENTE');
    expect(chamadas).toEqual([]);
  });

  it('05 execução divergente → FAIL sem descoberta', async () => {
    const chamadas: string[] = [];
    const resultado = await executarDiscoveryOnlyHomologacao({
      autorizacao: authDiscovery(),
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'exec-outra',
      diretorioFiscal: DIR,
      discover: mockDiscover(chamadas),
      agora: AGORA,
    });
    expect(resultado.veredito).toBe('FAIL');
    expect(resultado.codigoErro).toBe('EXECUCAO_DIVERGENTE');
    expect(chamadas).toEqual([]);
  });

  it('06 autorização expirada → FAIL sem descoberta', async () => {
    const chamadas: string[] = [];
    const resultado = await executarDiscoveryOnlyHomologacao({
      autorizacao: authDiscovery(),
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'exec-h21',
      diretorioFiscal: DIR,
      discover: mockDiscover(chamadas),
      agora: new Date('2024-06-17T00:00:00.000Z'),
    });
    expect(resultado.veredito).toBe('FAIL');
    expect(resultado.codigoErro).toBe('AUTORIZACAO_EXPIRADA');
    expect(chamadas).toEqual([]);
  });

  it('07 operação divergente (SEFIN_RECOVERY) → FAIL sem descoberta', async () => {
    const chamadas: string[] = [];
    const auth = criarAutorizacaoHomologacao({
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'exec-h21',
      operacao: 'SEFIN_RECOVERY',
      validoAte: VALIDO_ATE,
      diretorioFiscal: DIR,
      limites: criarLimitesHomologacao({
        maxDocumentos: 10,
        maxPaginas: 5,
        maxRequisicoesSefin: 3,
        timeoutMs: 30_000,
      }),
      agora: AGORA,
    });
    const resultado = await executarDiscoveryOnlyHomologacao({
      autorizacao: auth,
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'exec-h21',
      diretorioFiscal: DIR,
      discover: mockDiscover(chamadas),
      agora: AGORA,
    });
    expect(resultado.veredito).toBe('FAIL');
    expect(resultado.codigoErro).toBe('OPERACAO_NAO_AUTORIZADA');
    expect(chamadas).toEqual([]);
  });

  it('08 diretório divergente → FAIL sem descoberta', async () => {
    const chamadas: string[] = [];
    const resultado = await executarDiscoveryOnlyHomologacao({
      autorizacao: authDiscovery(),
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'exec-h21',
      diretorioFiscal: DIR_OUTRO,
      discover: mockDiscover(chamadas),
      agora: AGORA,
    });
    expect(resultado.veredito).toBe('FAIL');
    expect(resultado.codigoErro).toBe('DIRETORIO_DIVERGENTE');
    expect(chamadas).toEqual([]);
  });

  it('09 limite de documentos → INCOMPLETO, sem segunda direção se estourar', async () => {
    const chamadas: string[] = [];
    const discover = mockDiscover(chamadas, {
      EMITIDAS: inventarioDirecao('EMITIDA', [
        { n: 1, situacao: 'VIGENTE' },
        { n: 2, situacao: 'VIGENTE' },
        { n: 3, situacao: 'VIGENTE' },
      ]),
      RECEBIDAS: inventarioDirecao('RECEBIDA', [{ n: 4, situacao: 'VIGENTE' }]),
    });
    const resultado = await executarDiscoveryOnlyHomologacao({
      autorizacao: authDiscovery({ maxDocumentos: 2 }),
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'exec-h21',
      diretorioFiscal: DIR,
      discover,
      agora: AGORA,
    });
    expect(resultado.veredito).toBe('INCOMPLETO');
    expect(resultado.codigoErro).toBe('LIMITE_DOCUMENTOS');
    expect(resultado.estadoInventario).toBe('PARCIAL');
    expect(chamadas).toEqual(['EMITIDAS']);
  });

  it('10 limite de páginas → INCOMPLETO, nunca cobertura 100%', async () => {
    const chamadas: string[] = [];
    const discover: DiscoverNfseInjetavel = async (input) => {
      chamadas.push(input.tipo);
      return fecharMock({
        tipo: input.tipo,
        status: 'DISCOVERY_INCOMPLETE',
        inventario: inventarioDirecao(
          input.tipo === 'EMITIDAS' ? 'EMITIDA' : 'RECEBIDA',
          [{ n: 10, situacao: 'VIGENTE' }]
        ),
        paginasPercorridas: input.maxPaginas ?? 1,
        diagnosticos: [
          {
            codigo: 'LIMITE_SEGURANCA_PAGINAS',
            mensagem: `Limite de segurança de ${input.maxPaginas} páginas atingido.`,
          },
        ],
      });
    };
    const resultado = await executarDiscoveryOnlyHomologacao({
      autorizacao: authDiscovery({ maxPaginas: 1 }),
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'exec-h21',
      diretorioFiscal: DIR,
      discover,
      agora: AGORA,
    });
    expect(resultado.veredito).toBe('INCOMPLETO');
    expect(resultado.codigoErro).toBe('LIMITE_PAGINAS');
    expect(resultado.estadoInventario).toBe('PARCIAL');
    expect(resultado.veredito).not.toBe('PASS');
  });

  it('11 timeout → FAIL/INCOMPLETO sem nova direção', async () => {
    const chamadas: string[] = [];
    const resultado = await executarDiscoveryOnlyHomologacao({
      autorizacao: authDiscovery({ timeoutMs: 100 }),
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'exec-h21',
      diretorioFiscal: DIR,
      discover: mockDiscover(chamadas),
      agora: AGORA,
      inicioLimitesEm: new Date(AGORA.getTime() - 5_000),
    });
    expect(resultado.veredito).toBe('FAIL');
    expect(resultado.codigoErro).toBe('TIMEOUT');
    expect(chamadas).toEqual([]);
  });

  it('12 interrupção via AbortSignal → FAIL sem descoberta', async () => {
    const chamadas: string[] = [];
    const ac = new AbortController();
    ac.abort();
    const resultado = await executarDiscoveryOnlyHomologacao({
      autorizacao: authDiscovery(),
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'exec-h21',
      diretorioFiscal: DIR,
      discover: mockDiscover(chamadas),
      agora: AGORA,
      signal: ac.signal,
    });
    expect(resultado.veredito).toBe('FAIL');
    expect(resultado.codigoErro).toBe('INTERRUPCAO');
    expect(chamadas).toEqual([]);
  });

  it('13 emitidas descobertas e contabilizadas', async () => {
    const chamadas: string[] = [];
    const resultado = await executarDiscoveryOnlyHomologacao({
      autorizacao: authDiscovery(),
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'exec-h21',
      diretorioFiscal: DIR,
      discover: mockDiscover(chamadas, {
        EMITIDAS: inventarioDirecao('EMITIDA', [{ n: 1, situacao: 'VIGENTE' }]),
        RECEBIDAS: inventarioDirecao('RECEBIDA', []),
      }),
      agora: AGORA,
    });
    expect(resultado.totais.emitidas).toBe(1);
    expect(chamadas[0]).toBe('EMITIDAS');
  });

  it('14 recebidas descobertas e contabilizadas', async () => {
    const chamadas: string[] = [];
    const resultado = await executarDiscoveryOnlyHomologacao({
      autorizacao: authDiscovery(),
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'exec-h21',
      diretorioFiscal: DIR,
      discover: mockDiscover(chamadas, {
        EMITIDAS: inventarioDirecao('EMITIDA', []),
        RECEBIDAS: inventarioDirecao('RECEBIDA', [
          { n: 5, situacao: 'VIGENTE' },
          { n: 6, situacao: 'VIGENTE' },
        ]),
      }),
      agora: AGORA,
    });
    expect(resultado.totais.recebidas).toBe(2);
    expect(chamadas).toContain('RECEBIDAS');
  });

  it('15 paginação: maxPaginas repassado ao discover', async () => {
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
        paginasPercorridas: 1,
      });
    };
    await executarDiscoveryOnlyHomologacao({
      autorizacao: authDiscovery({ maxPaginas: 7 }),
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'exec-h21',
      diretorioFiscal: DIR,
      discover,
      agora: AGORA,
    });
    expect(maxRecebidos).toEqual([7, 7]);
  });

  it('16 canceladas permanecem no inventário', async () => {
    const resultado = await executarDiscoveryOnlyHomologacao({
      autorizacao: authDiscovery(),
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'exec-h21',
      diretorioFiscal: DIR,
      discover: mockDiscover([], {
        EMITIDAS: inventarioDirecao('EMITIDA', [{ n: 1, situacao: 'CANCELADA' }]),
        RECEBIDAS: inventarioDirecao('RECEBIDA', []),
      }),
      agora: AGORA,
    });
    expect(resultado.totais.canceladas).toBe(1);
    expect(resultado.veredito).toBe('PASS');
  });

  it('17 indeterminadas permanecem e são contadas', async () => {
    const resultado = await executarDiscoveryOnlyHomologacao({
      autorizacao: authDiscovery(),
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'exec-h21',
      diretorioFiscal: DIR,
      discover: mockDiscover([], {
        EMITIDAS: inventarioDirecao('EMITIDA', [{ n: 1, situacao: 'INDETERMINADA' }]),
        RECEBIDAS: inventarioDirecao('RECEBIDA', []),
      }),
      agora: AGORA,
    });
    expect(resultado.totais.indeterminadas).toBe(1);
  });

  it('18 duplicidades: mesma chave nas duas direções → INCOMPLETO', async () => {
    const chaveDup = chave(99);
    const resultado = await executarDiscoveryOnlyHomologacao({
      autorizacao: authDiscovery(),
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'exec-h21',
      diretorioFiscal: DIR,
      discover: async (input) =>
        fecharMock({
          tipo: input.tipo,
          status: 'DISCOVERY_COMPLETE',
          inventario: montarInventario({
            id: `inv-${input.tipo}`,
            cnpj: CNPJ,
            periodoConsulta: PERIODO,
            documentos: [
              criarDocumentoFiscal({
                chaveNacional: chaveDup,
                cnpj: CNPJ,
                direcao: input.tipo === 'EMITIDAS' ? 'EMITIDA' : 'RECEBIDA',
                situacao: 'VIGENTE',
                periodoConsulta: PERIODO,
              }),
            ],
            completude: 'COMPLETO',
          }),
          paginasPercorridas: 1,
          diagnosticos:
            input.tipo === 'RECEBIDAS'
              ? [
                  {
                    codigo: 'CHAVE_EM_AMBAS_DIRECOES',
                    mensagem: `Chave presente em emitidas e recebidas: ${chaveDup}.`,
                  },
                ]
              : [],
        }),
      agora: AGORA,
    });
    expect(resultado.veredito).toBe('INCOMPLETO');
    expect(resultado.diagnosticos.some((d) => d.codigo === 'CHAVE_EM_AMBAS_DIRECOES')).toBe(true);
    expect(resultado.diagnosticos.every((d) => !d.mensagem.includes(chaveDup))).toBe(true);
  });

  it('19 inventário incompleto → nunca PASS', async () => {
    const resultado = await executarDiscoveryOnlyHomologacao({
      autorizacao: authDiscovery(),
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'exec-h21',
      diretorioFiscal: DIR,
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
          diagnosticos: [{ codigo: 'CAPTURA_PARCIAL', mensagem: 'Tabela incompleta.' }],
        }),
      agora: AGORA,
    });
    expect(resultado.estadoInventario).toBe('PARCIAL');
    expect(resultado.veredito).toBe('INCOMPLETO');
    expect(resultado.veredito).not.toBe('PASS');
  });

  it('20 ausência de SEFIN (efeitosProibidos.sefin === false)', async () => {
    const resultado = await executarDiscoveryOnlyHomologacao({
      autorizacao: authDiscovery(),
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'exec-h21',
      diretorioFiscal: DIR,
      discover: mockDiscover([], {
        EMITIDAS: inventarioDirecao('EMITIDA', []),
        RECEBIDAS: inventarioDirecao('RECEBIDA', []),
      }),
      agora: AGORA,
    });
    expect(resultado.efeitosProibidos.sefin).toBe(false);
    expect(resultado.limitesAplicados.maxRequisicoesSefin).toBe(0);
  });

  it('21 ausência de escrita XML', async () => {
    const resultado = await executarDiscoveryOnlyHomologacao({
      autorizacao: authDiscovery(),
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'exec-h21',
      diretorioFiscal: DIR,
      discover: mockDiscover([], {
        EMITIDAS: inventarioDirecao('EMITIDA', []),
        RECEBIDAS: inventarioDirecao('RECEBIDA', []),
      }),
      agora: AGORA,
    });
    expect(resultado.efeitosProibidos.escritaXml).toBe(false);
  });

  it('22 ausência de checkpoint de recuperação', async () => {
    const resultado = await executarDiscoveryOnlyHomologacao({
      autorizacao: authDiscovery(),
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'exec-h21',
      diretorioFiscal: DIR,
      discover: mockDiscover([], {
        EMITIDAS: inventarioDirecao('EMITIDA', []),
        RECEBIDAS: inventarioDirecao('RECEBIDA', []),
      }),
      agora: AGORA,
    });
    expect(resultado.efeitosProibidos.checkpointRecuperacao).toBe(false);
  });

  it('23 ausência de navegador adicional (reutiliza page injetada)', async () => {
    const pagesVistas: Page[] = [];
    const discover: DiscoverNfseInjetavel = async (input) => {
      pagesVistas.push(input.page);
      return fecharMock({
        tipo: input.tipo,
        status: 'DISCOVERY_COMPLETE',
        inventario: inventarioDirecao(
          input.tipo === 'EMITIDAS' ? 'EMITIDA' : 'RECEBIDA',
          []
        ),
        paginasPercorridas: 1,
      });
    };
    const resultado = await executarDiscoveryOnlyHomologacao({
      autorizacao: authDiscovery(),
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'exec-h21',
      diretorioFiscal: DIR,
      discover,
      agora: AGORA,
    });
    expect(pagesVistas).toHaveLength(2);
    expect(pagesVistas.every((p) => p === PAGE)).toBe(true);
    expect(resultado.efeitosProibidos.navegadorAdicional).toBe(false);
  });

  it('24 ausência de login adicional', async () => {
    const resultado = await executarDiscoveryOnlyHomologacao({
      autorizacao: authDiscovery(),
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'exec-h21',
      diretorioFiscal: DIR,
      discover: mockDiscover([], {
        EMITIDAS: inventarioDirecao('EMITIDA', []),
        RECEBIDAS: inventarioDirecao('RECEBIDA', []),
      }),
      agora: AGORA,
    });
    expect(resultado.efeitosProibidos.loginAdicional).toBe(false);
  });

  it('25 ausência de efeitos no legado: {autorizada:true} isolado não autoriza', async () => {
    const chamadas: string[] = [];
    const generica = { autorizada: true } as unknown as AutorizacaoHomologacaoNfse;
    const resultado = await executarDiscoveryOnlyHomologacao({
      autorizacao: generica,
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'exec-h21',
      diretorioFiscal: DIR,
      discover: mockDiscover(chamadas),
      agora: AGORA,
    });
    expect(resultado.veredito).toBe('FAIL');
    expect(resultado.codigoErro).toBe('AUTORIZACAO_MALFORMADA');
    expect(chamadas).toEqual([]);
  });
});

function authDiscovery(
  limites: Partial<{
    maxDocumentos: number;
    maxPaginas: number;
    maxRequisicoesSefin: number;
    timeoutMs: number;
  }> = {}
): AutorizacaoHomologacaoNfse {
  return criarAutorizacaoHomologacao({
    cnpj: CNPJ,
    periodoConsulta: PERIODO,
    execucaoId: 'exec-h21',
    operacao: 'DISCOVERY_ONLY',
    validoAte: VALIDO_ATE,
    diretorioFiscal: DIR,
    limites: criarLimitesHomologacao({
      maxDocumentos: limites.maxDocumentos ?? 20,
      maxPaginas: limites.maxPaginas ?? 10,
      maxRequisicoesSefin: limites.maxRequisicoesSefin ?? 0,
      timeoutMs: limites.timeoutMs ?? 30_000,
    }),
    motivo: 'teste-h21-discovery-only',
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
