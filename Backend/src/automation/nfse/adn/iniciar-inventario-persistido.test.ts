/**
 * API-01U — Inventário persistido no Iniciar ADN (offline).
 * Sem rede, sem Playwright, sem alterar XMLs/checkpoints reais.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { decidirAdnIniciar } from './iniciar-routing';
import { executarFluxoAdnIniciar } from './iniciar-executor';
import { NOME_ALLOWLIST_ADN_INICIAR, NOME_FLAG_ADN_INICIAR } from './iniciar-feature-flag';
import {
  decidirResultadoFinalAdnIniciar,
  InventarioPersistidoMemoriaAdn,
  listarCompetenciasDoPeriodo,
  type ContagensCompetenciaAdn,
} from './inventario-persistido';
import { syncAdnIniciarFixoParaTestes, resetIniciarAdnRuntimeParaTestes } from './iniciar-runtime';
import type { ResultadoSyncAdn } from './types';
import { limparRetencaoProgressoFiscal, limparRevisoesProgressoFiscal } from '../progresso-fiscal';

const CNPJ_A = '45517515000100';
const CNPJ_B = '11222333000181';
const CHAVE_E = '41069022228631747000167000000000003626090719238991';

function envFlagOn(cnpj = CNPJ_A): NodeJS.ProcessEnv {
  return {
    [NOME_FLAG_ADN_INICIAR]: 'true',
    [NOME_ALLOWLIST_ADN_INICIAR]: cnpj,
  };
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

  it('SEM_MOVIMENTO só com evidência de período vazio', () => {
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
      evidenciaPersistenciaOk: false,
    };
    expect(decidirResultadoFinalAdnIniciar(consolidacao)).toBe('ADN_INVENTARIO_INDETERMINADO');
  });
});

describe('API-01U — fluxo Iniciar com inventário persistido', () => {
  afterEach(() => {
    resetIniciarAdnRuntimeParaTestes();
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
      env: envFlagOn(params.cnpj),
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
        env: envFlagOn(params.cnpj),
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
      env: envFlagOn(`${CNPJ_A},${CNPJ_B}`),
    });
    const decisaoB = decidirAdnIniciar({
      tipoAutenticacao: 'certificado',
      cnpj: CNPJ_B,
      env: envFlagOn(`${CNPJ_A},${CNPJ_B}`),
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
