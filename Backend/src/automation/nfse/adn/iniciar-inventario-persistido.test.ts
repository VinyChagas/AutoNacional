/**
 * API-01U — Inventário persistido no Iniciar ADN (offline).
 * Sem rede, sem Playwright, sem alterar XMLs/checkpoints reais.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decidirAdnIniciar } from './iniciar-routing';
import { executarFluxoAdnIniciar } from './iniciar-executor';
import {
  decidirResultadoFinalAdnIniciar,
  InventarioPersistidoMemoriaAdn,
  listarCompetenciasDoPeriodo,
  type ContagensCompetenciaAdn,
} from './inventario-persistido';
import { syncAdnIniciarFixoParaTestes, resetIniciarAdnRuntimeParaTestes } from './iniciar-runtime';
import {
  configAdnIniciarPadrao,
  resetConfigAdnIniciarParaTestes,
  setConfigAdnIniciarParaTestes,
} from './iniciar-config';
import type { ResultadoSyncAdn } from './types';
import { limparRetencaoProgressoFiscal, limparRevisoesProgressoFiscal } from '../progresso-fiscal';

const CNPJ_A = '45517515000100';
const CNPJ_B = '11222333000181';
const CHAVE_E = '41069022228631747000167000000000003626090719238991';

/** Sem kill-switch — ADN padrão de produto. */
function envProduto(): NodeJS.ProcessEnv {
  return {};
}

function syncVazioCursorEsgotado(cnpj: string): ResultadoSyncAdn {
  return {
    cnpj,
    ambiente: 'producao',
    documentos: [],
    nsuInicial: 1737,
    ultimoNsuProcessado: 1737,
    lotesProcessados: 0,
    requests: 1,
    status: 'COMPLETO',
    fimDistribuicaoConfirmado: true,
    inventarioMensalCompletoDeclarado: false,
    motivoParada: 'nenhum_documento_localizado',
    duplicidades: 0,
    xmlsInvalidos: 0,
    contagens: {
      emitidas: 0,
      recebidas: 0,
      intermediadas: 0,
      eventos: 0,
      naoClassificados: 0,
    },
  };
}

function syncComNovos(cnpj: string): ResultadoSyncAdn {
  return {
    ...syncVazioCursorEsgotado(cnpj),
    nsuInicial: 1,
    ultimoNsuProcessado: 2,
    lotesProcessados: 1,
    requests: 1,
    status: 'PARCIAL',
    fimDistribuicaoConfirmado: false,
    motivoParada: 'limite_requisicoes',
    documentos: [
      {
        nsu: 1,
        chaveAcesso: CHAVE_E,
        classificacao: 'emitida',
        papeis: ['emitente'],
        sha256: 'a'.repeat(64),
        xmlValido: true,
        competencia: '2026-01',
      },
      {
        nsu: 2,
        chaveAcesso: '41069022252448489000162000000000005526095260389667',
        classificacao: 'recebida',
        papeis: ['tomador'],
        sha256: 'b'.repeat(64),
        xmlValido: true,
        competencia: '2026-01',
      },
    ],
    contagens: {
      emitidas: 1,
      recebidas: 1,
      intermediadas: 0,
      eventos: 0,
      naoClassificados: 0,
    },
  };
}

function comp(
  competencia: string,
  parcial: Partial<ContagensCompetenciaAdn> = {}
): ContagensCompetenciaAdn {
  const base = {
    competencia,
    emitidas: 0,
    recebidas: 0,
    intermediadas: 0,
    eventos: 0,
    naoClassificados: 0,
    xmlInvalidos: 0,
    totalArquivos: 0,
    ...parcial,
  };
  base.totalArquivos =
    base.emitidas +
    base.recebidas +
    base.intermediadas +
    base.eventos +
    base.naoClassificados +
    base.xmlInvalidos;
  return base;
}

describe('API-01U — competências e decisão de resultado', () => {
  it('lista competências inclusivas do período', () => {
    expect(listarCompetenciasDoPeriodo('01/12/2025', '31/01/2026')).toEqual([
      '2025-12',
      '2026-01',
    ]);
  });

  it('SEM_MOVIMENTO só com evidência de período vazio e fim NSU', () => {
    const fonte = new InventarioPersistidoMemoriaAdn();
    fonte.seed(CNPJ_A, 'producao', [comp('2026-01')], 1736);
    const consolidacao = {
      cnpj: CNPJ_A,
      ambiente: 'producao' as const,
      competenciasSolicitadas: ['2026-01'],
      porCompetencia: [comp('2026-01')],
      periodo: {
        emitidas: 0,
        recebidas: 0,
        intermediadas: 0,
        eventos: 0,
        naoClassificados: 0,
        xmlInvalidos: 0,
        totalArquivos: 0,
        nfsEmitidasRecebidas: 0,
      },
      armazenadoTotal: {
        emitidas: 100,
        recebidas: 50,
        intermediadas: 0,
        eventos: 0,
        naoClassificados: 0,
        xmlInvalidos: 0,
        totalArquivos: 150,
        chavesIndice: 1736,
      },
      sessao: {
        emitidas: 0,
        recebidas: 0,
        intermediadas: 0,
        eventos: 0,
        naoClassificados: 0,
        xmlInvalidos: 0,
        totalDocumentos: 0,
        novosPersistiveis: 0,
      },
      distribuicao: {
        status: 'COMPLETO' as const,
        fimDistribuicaoConfirmado: true,
      },
      evidenciaPersistenciaOk: true,
    };
    expect(decidirResultadoFinalAdnIniciar(consolidacao)).toBe('SEM_MOVIMENTO');
  });

  it('cursor esgotado + persistidos na competência → NFS_ENCONTRADAS', () => {
    const consolidacao = {
      cnpj: CNPJ_A,
      ambiente: 'producao' as const,
      competenciasSolicitadas: ['2026-01'],
      porCompetencia: [comp('2026-01', { emitidas: 10, recebidas: 5 })],
      periodo: {
        emitidas: 10,
        recebidas: 5,
        intermediadas: 0,
        eventos: 1,
        naoClassificados: 0,
        xmlInvalidos: 0,
        totalArquivos: 16,
        nfsEmitidasRecebidas: 15,
      },
      armazenadoTotal: {
        emitidas: 1000,
        recebidas: 700,
        intermediadas: 0,
        eventos: 36,
        naoClassificados: 0,
        xmlInvalidos: 0,
        totalArquivos: 1736,
        chavesIndice: 1736,
      },
      sessao: {
        emitidas: 0,
        recebidas: 0,
        intermediadas: 0,
        eventos: 0,
        naoClassificados: 0,
        xmlInvalidos: 0,
        totalDocumentos: 0,
        novosPersistiveis: 0,
      },
      distribuicao: {
        status: 'COMPLETO' as const,
        fimDistribuicaoConfirmado: true,
      },
      evidenciaPersistenciaOk: true,
    };
    expect(decidirResultadoFinalAdnIniciar(consolidacao)).toBe('NFS_ENCONTRADAS');
  });

  it('sem evidência de persistência → não declara SEM_MOVIMENTO', () => {
    const consolidacao = {
      cnpj: CNPJ_A,
      ambiente: 'producao' as const,
      competenciasSolicitadas: ['2026-01'],
      porCompetencia: [comp('2026-01')],
      periodo: {
        emitidas: 0,
        recebidas: 0,
        intermediadas: 0,
        eventos: 0,
        naoClassificados: 0,
        xmlInvalidos: 0,
        totalArquivos: 0,
        nfsEmitidasRecebidas: 0,
      },
      armazenadoTotal: {
        emitidas: 0,
        recebidas: 0,
        intermediadas: 0,
        eventos: 0,
        naoClassificados: 0,
        xmlInvalidos: 0,
        totalArquivos: 0,
        chavesIndice: null,
      },
      sessao: {
        emitidas: 0,
        recebidas: 0,
        intermediadas: 0,
        eventos: 0,
        naoClassificados: 0,
        xmlInvalidos: 0,
        totalDocumentos: 0,
        novosPersistiveis: 0,
      },
      distribuicao: {
        status: 'PARCIAL' as const,
        fimDistribuicaoConfirmado: false,
      },
      evidenciaPersistenciaOk: false,
    };
    expect(decidirResultadoFinalAdnIniciar(consolidacao)).toBe('ADN_INVENTARIO_INDETERMINADO');
  });

  it('sessão com emitidas de outros NSUs não altera resultado da competência vazia', () => {
    const consolidacao = {
      cnpj: '19903461000100',
      ambiente: 'producao' as const,
      competenciasSolicitadas: ['2026-09'],
      porCompetencia: [comp('2026-09')],
      periodo: {
        emitidas: 0,
        recebidas: 0,
        intermediadas: 0,
        eventos: 0,
        naoClassificados: 0,
        xmlInvalidos: 0,
        totalArquivos: 0,
        nfsEmitidasRecebidas: 0,
      },
      armazenadoTotal: {
        emitidas: 50,
        recebidas: 0,
        intermediadas: 0,
        eventos: 0,
        naoClassificados: 0,
        xmlInvalidos: 0,
        totalArquivos: 50,
        chavesIndice: 50,
      },
      sessao: {
        emitidas: 50,
        recebidas: 0,
        intermediadas: 0,
        eventos: 0,
        naoClassificados: 0,
        xmlInvalidos: 0,
        totalDocumentos: 50,
        novosPersistiveis: 50,
      },
      distribuicao: {
        status: 'PARCIAL' as const,
        fimDistribuicaoConfirmado: false,
      },
      evidenciaPersistenciaOk: true,
    };
    expect(decidirResultadoFinalAdnIniciar(consolidacao)).toBe(
      'ADN_INVENTARIO_INDETERMINADO'
    );
  });
});

describe('API-01U — fluxo Iniciar com inventário persistido', () => {
  beforeEach(() => {
    setConfigAdnIniciarParaTestes(configAdnIniciarPadrao());
  });

  afterEach(() => {
    resetIniciarAdnRuntimeParaTestes();
    resetConfigAdnIniciarParaTestes();
    limparRetencaoProgressoFiscal();
    limparRevisoesProgressoFiscal();
  });

  async function rodar(params: {
    cnpj: string;
    sync: ResultadoSyncAdn;
    seed?: ContagensCompetenciaAdn[];
    dataInicio?: string;
    dataFim?: string;
    chavesIndice?: number;
  }) {
    const decisao = decidirAdnIniciar({
      tipoAutenticacao: 'certificado',
      cnpj: params.cnpj,
      env: envProduto(),
    });
    expect(decisao.executarAdn).toBe(true);
    const fonte = new InventarioPersistidoMemoriaAdn();
    if (params.seed) {
      fonte.seed(params.cnpj, 'producao', params.seed, params.chavesIndice ?? 10);
    } else {
      fonte.seed(params.cnpj, 'producao', [], params.chavesIndice ?? 0);
    }
    return executarFluxoAdnIniciar(
      {
        cnpj: params.cnpj,
        dataInicio: params.dataInicio ?? '01/01/2026',
        dataFim: params.dataFim ?? '31/01/2026',
        identidade: {
          batchId: 'lote-01u',
          empresaId: '10',
          execucaoId: '9001',
          cnpj: params.cnpj,
        },
        decisao,
        env: envProduto(),
      },
      {
        executarSync: syncAdnIniciarFixoParaTestes(params.sync),
        fonteInventarioPersistido: fonte,
        exigirGateLive: false,
      }
    );
  }

  it('cursor esgotado + documentos persistidos na competência → contagens e NFS_ENCONTRADAS', async () => {
    const r = await rodar({
      cnpj: CNPJ_A,
      sync: syncVazioCursorEsgotado(CNPJ_A),
      seed: [comp('2026-01', { emitidas: 12, recebidas: 4, eventos: 2 })],
      chavesIndice: 1736,
    });
    expect(r.ok).toBe(true);
    expect(r.chromiumAberto).toBe(false);
    expect(r.resultadoFinal).toBe('NFS_ENCONTRADAS');
    expect(r.contagens.emitidas).toBe(12);
    expect(r.contagens.recebidas).toBe(4);
    expect(r.contagens.canceladas).toBe(2);
    expect(r.fiscal?.inventario.completude).toBe('PARCIAL');
    expect(r.fiscal?.inventario.conclusao_confiavel).toBe(false);
    expect(r.consolidacao?.sessao.totalDocumentos).toBe(0);
    expect(r.consolidacao?.periodo.nfsEmitidasRecebidas).toBe(16);
    expect(r.consolidacao?.armazenadoTotal.chavesIndice).toBe(1736);
    expect(r.motivo).toMatch(/sessão novos=0/);
    expect(r.motivo).toMatch(/resultado=NFS_ENCONTRADAS/);
  });

  it('cursor esgotado + competência sem documentos → SEM_MOVIMENTO com evidência', async () => {
    const r = await rodar({
      cnpj: CNPJ_A,
      sync: syncVazioCursorEsgotado(CNPJ_A),
      seed: [comp('2025-06', { emitidas: 50, recebidas: 10 })], // outra competência
      chavesIndice: 60,
      dataInicio: '01/01/2026',
      dataFim: '31/01/2026',
    });
    expect(r.ok).toBe(true);
    expect(r.resultadoFinal).toBe('SEM_MOVIMENTO');
    expect(r.contagens.emitidas).toBe(0);
    expect(r.contagens.recebidas).toBe(0);
    expect(r.fiscal?.inventario.completude).toBe('PARCIAL');
    expect(r.consolidacao?.armazenadoTotal.emitidas).toBe(50);
    expect(r.consolidacao?.periodo.totalArquivos).toBe(0);
  });

  it('primeira execução com documentos novos → NFS_ENCONTRADAS', async () => {
    const r = await rodar({
      cnpj: CNPJ_A,
      sync: syncComNovos(CNPJ_A),
      seed: [comp('2026-01', { emitidas: 1, recebidas: 1 })],
      chavesIndice: 2,
    });
    expect(r.resultadoFinal).toBe('NFS_ENCONTRADAS');
    expect(r.consolidacao?.sessao.totalDocumentos).toBe(2);
    expect(r.contagens.emitidas).toBe(1);
    expect(r.contagens.recebidas).toBe(1);
    expect(r.fiscal?.validacao.origem).toBe('ADN');
  });

  it('isolamento entre empresas e competências', async () => {
    const fonte = new InventarioPersistidoMemoriaAdn();
    fonte.seed(CNPJ_A, 'producao', [comp('2026-01', { emitidas: 7 })], 7);
    fonte.seed(CNPJ_B, 'producao', [comp('2026-01', { recebidas: 3 })], 3);

    const decisaoA = decidirAdnIniciar({
      tipoAutenticacao: 'certificado',
      cnpj: CNPJ_A,
      env: envProduto(),
    });
    const decisaoB = decidirAdnIniciar({
      tipoAutenticacao: 'certificado',
      cnpj: CNPJ_B,
      env: envProduto(),
    });

    const [a, b] = await Promise.all([
      executarFluxoAdnIniciar(
        {
          cnpj: CNPJ_A,
          dataInicio: '01/01/2026',
          dataFim: '31/01/2026',
          identidade: {
            batchId: 'lote-iso',
            empresaId: '1',
            execucaoId: '1',
            cnpj: CNPJ_A,
          },
          decisao: decisaoA,
        },
        {
          executarSync: syncAdnIniciarFixoParaTestes(syncVazioCursorEsgotado(CNPJ_A)),
          fonteInventarioPersistido: fonte,
          exigirGateLive: false,
        }
      ),
      executarFluxoAdnIniciar(
        {
          cnpj: CNPJ_B,
          dataInicio: '01/01/2026',
          dataFim: '31/01/2026',
          identidade: {
            batchId: 'lote-iso',
            empresaId: '2',
            execucaoId: '2',
            cnpj: CNPJ_B,
          },
          decisao: decisaoB,
        },
        {
          executarSync: syncAdnIniciarFixoParaTestes(syncVazioCursorEsgotado(CNPJ_B)),
          fonteInventarioPersistido: fonte,
          exigirGateLive: false,
        }
      ),
    ]);

    expect(a.contagens.emitidas).toBe(7);
    expect(a.contagens.recebidas).toBe(0);
    expect(a.resultadoFinal).toBe('NOTAS_EMITIDAS');
    expect(b.contagens.emitidas).toBe(0);
    expect(b.contagens.recebidas).toBe(3);
    expect(b.resultadoFinal).toBe('NOTAS_RECEBIDAS');
    expect(a.consolidacao?.cnpj).toBe(CNPJ_A);
    expect(b.consolidacao?.cnpj).toBe(CNPJ_B);
  });
});

describe('API-02B — resultado_final só pela competência (cenários reais)', () => {
  beforeEach(() => {
    setConfigAdnIniciarParaTestes(configAdnIniciarPadrao());
  });

  afterEach(() => {
    resetIniciarAdnRuntimeParaTestes();
    resetConfigAdnIniciarParaTestes();
    limparRetencaoProgressoFiscal();
    limparRevisoesProgressoFiscal();
  });

  const CNPJ_274 = '19903461000100';
  const CNPJ_139 = '24762400000100';
  const CNPJ_226 = '46704878000109';

  /** Lote ADN PARCIAL (MAX_REQUESTS=1) com docs de competências antigas na sessão. */
  function syncParcialSessaoAntiga(
    cnpj: string,
    docs: ResultadoSyncAdn['documentos']
  ): ResultadoSyncAdn {
    const contagens = {
      emitidas: docs.filter((d) => d.classificacao === 'emitida').length,
      recebidas: docs.filter((d) => d.classificacao === 'recebida').length,
      intermediadas: docs.filter((d) => d.classificacao === 'intermediada').length,
      eventos: docs.filter((d) => d.classificacao === 'evento').length,
      naoClassificados: 0,
    };
    return {
      cnpj,
      ambiente: 'producao',
      documentos: docs,
      nsuInicial: 1,
      ultimoNsuProcessado: 51,
      lotesProcessados: 1,
      requests: 1,
      status: 'PARCIAL',
      fimDistribuicaoConfirmado: false,
      inventarioMensalCompletoDeclarado: false,
      motivoParada: 'lote_cheio_continuar',
      duplicidades: 0,
      xmlsInvalidos: 0,
      contagens,
    };
  }

  async function rodarCompetencia202609(params: {
    cnpj: string;
    sync: ResultadoSyncAdn;
    seed: ContagensCompetenciaAdn[];
    chavesIndice?: number;
  }) {
    const decisao = decidirAdnIniciar({
      tipoAutenticacao: 'certificado',
      cnpj: params.cnpj,
      env: envProduto(),
    });
    expect(decisao.executarAdn).toBe(true);
    const fonte = new InventarioPersistidoMemoriaAdn();
    fonte.seed(
      params.cnpj,
      'producao',
      params.seed,
      params.chavesIndice ?? params.seed.reduce((n, c) => n + c.totalArquivos, 0)
    );
    return executarFluxoAdnIniciar(
      {
        cnpj: params.cnpj,
        dataInicio: '01/09/2026',
        dataFim: '30/09/2026',
        identidade: {
          batchId: 'lote-02b',
          empresaId: '02b',
          execucaoId: params.cnpj.slice(-4),
          cnpj: params.cnpj,
        },
        decisao,
        env: envProduto(),
      },
      {
        executarSync: syncAdnIniciarFixoParaTestes(params.sync),
        fonteInventarioPersistido: fonte,
        exigirGateLive: false,
      }
    );
  }

  it('274: competência 2026-09 vazia + sessão com emitidas antigas + PARCIAL → ADN_INVENTARIO_INDETERMINADO', async () => {
    const r = await rodarCompetencia202609({
      cnpj: CNPJ_274,
      sync: syncParcialSessaoAntiga(CNPJ_274, [
        {
          nsu: 1,
          chaveAcesso: '41069022219903461000100000000000004924013996222523',
          classificacao: 'emitida',
          papeis: ['emitente'],
          sha256: 'a'.repeat(64),
          xmlValido: true,
          competencia: '2024-01',
        },
        {
          nsu: 2,
          chaveAcesso: '41069022219903461000100000000000003023112664269089',
          classificacao: 'emitida',
          papeis: ['emitente'],
          sha256: 'b'.repeat(64),
          xmlValido: true,
          competencia: '2023-11',
        },
      ]),
      seed: [
        comp('2024-01', { emitidas: 5 }),
        comp('2023-11', { emitidas: 45 }),
        comp('2026-09'), // vazia
      ],
      chavesIndice: 50,
    });
    expect(r.ok).toBe(true);
    expect(r.consolidacao?.periodo.emitidas).toBe(0);
    expect(r.consolidacao?.periodo.recebidas).toBe(0);
    expect(r.consolidacao?.sessao.emitidas).toBe(2);
    expect(r.consolidacao?.distribuicao.status).toBe('PARCIAL');
    expect(r.contagens.emitidas).toBe(0);
    expect(r.contagens.recebidas).toBe(0);
    expect(r.resultadoFinal).toBe('ADN_INVENTARIO_INDETERMINADO');
    expect(r.resultadoFinal).not.toBe('NOTAS_EMITIDAS');
    expect(r.resultadoFinal).not.toBe('SEM_MOVIMENTO');
  });

  it('139: competência 2026-09 com 0 emitidas / 4 recebidas → NFS_ENCONTRADAS (NOTAS_RECEBIDAS)', async () => {
    const r = await rodarCompetencia202609({
      cnpj: CNPJ_139,
      sync: syncParcialSessaoAntiga(CNPJ_139, [
        {
          nsu: 10,
          chaveAcesso: '41069022275055772000120000000112766126096266847663',
          classificacao: 'recebida',
          papeis: ['tomador'],
          sha256: 'c'.repeat(64),
          xmlValido: true,
          competencia: '2026-09',
        },
      ]),
      seed: [
        comp('2025-01', { recebidas: 46 }),
        comp('2026-09', { recebidas: 4 }),
      ],
      chavesIndice: 50,
    });
    expect(r.ok).toBe(true);
    expect(r.consolidacao?.periodo.emitidas).toBe(0);
    expect(r.consolidacao?.periodo.recebidas).toBe(4);
    expect(r.contagens.emitidas).toBe(0);
    expect(r.contagens.recebidas).toBe(4);
    expect(r.resultadoFinal).toBe('NOTAS_RECEBIDAS');
  });

  it('226: competência 2026-09 vazia + sessão mista + PARCIAL → ADN_INVENTARIO_INDETERMINADO', async () => {
    const r = await rodarCompetencia202609({
      cnpj: CNPJ_226,
      sync: syncParcialSessaoAntiga(CNPJ_226, [
        {
          nsu: 1,
          chaveAcesso: '41069022246704878000109000000000000125118197875491',
          classificacao: 'emitida',
          papeis: ['emitente'],
          sha256: 'd'.repeat(64),
          xmlValido: true,
          competencia: '2025-11',
        },
        {
          nsu: 2,
          chaveAcesso: '41069021202862447000103000000189439024031657989522',
          classificacao: 'recebida',
          papeis: ['tomador'],
          sha256: 'e'.repeat(64),
          xmlValido: true,
          competencia: '2024-03',
        },
      ]),
      seed: [
        comp('2025-11', { emitidas: 20 }),
        comp('2024-03', { recebidas: 25 }),
        comp('2026-09'),
      ],
      chavesIndice: 45,
    });
    expect(r.ok).toBe(true);
    expect(r.consolidacao?.periodo.emitidas).toBe(0);
    expect(r.consolidacao?.periodo.recebidas).toBe(0);
    expect(r.consolidacao?.sessao.emitidas).toBe(1);
    expect(r.consolidacao?.sessao.recebidas).toBe(1);
    expect(r.contagens.emitidas).toBe(0);
    expect(r.contagens.recebidas).toBe(0);
    expect(r.resultadoFinal).toBe('ADN_INVENTARIO_INDETERMINADO');
    expect(r.resultadoFinal).not.toBe('NFS_ENCONTRADAS');
    expect(r.resultadoFinal).not.toBe('SEM_MOVIMENTO');
  });
});
