import { describe, expect, it } from 'vitest';
import { montarReconciliacaoExecucao } from './reconciliacao-execucao';
import { metricasOperacionaisVazias } from './metricas-operacionais';
import type { ProgressoFiscalNfse } from '../progresso-fiscal/types';

function fiscalBase(over: Partial<ProgressoFiscalNfse['validacao']> & {
  emitidas?: number;
  recebidas?: number;
  canceladas?: number;
  vigentes?: number;
  indeterminadas?: number;
}): ProgressoFiscalNfse {
  const emitidas = over.emitidas ?? 0;
  const recebidas = over.recebidas ?? 0;
  const canceladas = over.canceladas ?? 0;
  const vigentes = over.vigentes ?? Math.max(0, emitidas + recebidas - canceladas);
  const indeterminadas = over.indeterminadas ?? 0;
  return {
    versao: 1,
    batch_id: 'b1',
    empresa_id: '1',
    execucao_id: '10',
    cnpj: '19903461000100',
    revisao: 1,
    inventario: {
      estado: 'completa',
      completude: 'COMPLETO',
      conclusao_confiavel: true,
      totais: {
        emitidas,
        recebidas,
        canceladas,
        vigentes,
        indeterminadas,
        descobertos: emitidas + recebidas,
        paginas: 1,
      },
    },
    validacao: {
      estado: 'completa',
      origem: 'PORTAL',
      vigentes,
      canceladas,
      indeterminadas,
      conclusao_confiavel: indeterminadas === 0,
    },
    recuperacao: { estado: 'nao_executada', conclusao_confiavel: false },
    codigo: null,
    message: null,
    estado_operacional: null,
    veredito_discovery: 'PASS',
  };
}

describe('API-03B montarReconciliacaoExecucao', () => {
  it('reconciliada quando vigentes == xmls e sem indeterminadas', () => {
    const m = metricasOperacionaisVazias();
    m.contadores.xmlsPersistidos = 12;
    m.contadores.xmlsExportados = 2;
    m.contadores.xmlsJaExistentes = 10;
    const r = montarReconciliacaoExecucao({
      statusExecucao: 'OK',
      fiscal: fiscalBase({ emitidas: 12, recebidas: 0, canceladas: 0, vigentes: 12 }),
      metricas: m,
    });
    expect(r.status_fiscal).toBe('reconciliada');
    expect(r.chaves_vigentes_faltantes).toBe(0);
    expect(r.cobertura_pct).toBe(100);
    expect(r.xmls_downloads).toBe(12);
    expect(r.xmls_novos).toBe(2);
    expect(r.xmls_preexistentes_downloads).toBe(10);
  });

  it('canceladas não entram na meta de vigentes (gap = vigentes − xmls)', () => {
    const m = metricasOperacionaisVazias();
    m.contadores.xmlsPersistidos = 10;
    const r = montarReconciliacaoExecucao({
      statusExecucao: 'OK',
      fiscal: fiscalBase({ emitidas: 12, recebidas: 0, canceladas: 2, vigentes: 10 }),
      metricas: m,
    });
    expect(r.vigentes).toBe(10);
    expect(r.canceladas).toBe(2);
    expect(r.chaves_vigentes_faltantes).toBe(0);
    expect(r.status_fiscal).toBe('reconciliada');
  });

  it('indeterminadas viram concluida_com_pendencias (API-03M)', () => {
    const m = metricasOperacionaisVazias();
    m.contadores.xmlsPersistidos = 5;
    const r = montarReconciliacaoExecucao({
      statusExecucao: 'OK',
      resultadoFinal: 'CONCLUIDA_COM_PENDENCIAS',
      fiscal: fiscalBase({
        emitidas: 5,
        recebidas: 0,
        vigentes: 5,
        indeterminadas: 1,
      }),
      metricas: m,
      xmlsComAtencaoFiscal: 1,
    });
    expect(r.status_fiscal).toBe('concluida_com_pendencias');
    expect(r.indeterminadas).toBe(1);
    expect(r.xmls_com_atencao_fiscal).toBe(1);
  });

  it('API-03N — fallback de vigentes subtrai indeterminadas', () => {
    const m = metricasOperacionaisVazias();
    m.contadores.xmlsPersistidos = 203;
    const r = montarReconciliacaoExecucao({
      statusExecucao: 'ERRO',
      qtdEmitidas: 200,
      qtdRecebidas: 35,
      qtdCanceladas: 30,
      // sem validacao.vigentes — força fallback
      fiscal: {
        ...fiscalBase({
          emitidas: 200,
          recebidas: 35,
          canceladas: 30,
          vigentes: 204,
          indeterminadas: 1,
        }),
        validacao: {
          estado: 'indisponivel',
          origem: 'indisponivel',
          vigentes: null as unknown as number,
          canceladas: 30,
          indeterminadas: 1,
          conclusao_confiavel: false,
        },
      },
      metricas: m,
    });
    // Se validacao.vigentes for null, usa totais.vigentes=204 (não 235-30=205).
    expect(r.vigentes).toBe(204);
    expect(r.chaves_vigentes_faltantes).toBe(1);
  });

  it('sem movimento confirmado', () => {
    const r = montarReconciliacaoExecucao({
      statusExecucao: 'OK',
      qtdEmitidas: 0,
      qtdRecebidas: 0,
      fiscal: fiscalBase({ emitidas: 0, recebidas: 0, vigentes: 0 }),
      metricas: metricasOperacionaisVazias(),
    });
    expect(r.status_fiscal).toBe('sem_movimento');
  });

  it('erro não conta como sucesso', () => {
    const r = montarReconciliacaoExecucao({
      statusExecucao: 'ERRO',
      mensagemErro: 'NAV_FALHA',
      etapaAtual: 'abrir_menu',
      qtdEmitidas: 0,
      qtdRecebidas: 0,
    });
    expect(r.status_fiscal).toBe('erro');
    expect(r.motivo_erro).toContain('NAV_FALHA');
    expect(r.etapa_falha).toBe('abrir_menu');
  });

  it('parcial quando faltam XMLs vigentes', () => {
    const m = metricasOperacionaisVazias();
    m.contadores.xmlsPersistidos = 8;
    const r = montarReconciliacaoExecucao({
      statusExecucao: 'OK',
      fiscal: fiscalBase({ emitidas: 10, recebidas: 0, vigentes: 10 }),
      metricas: m,
    });
    expect(r.status_fiscal).toBe('parcial');
    expect(r.chaves_vigentes_faltantes).toBe(2);
    expect(r.cobertura_pct).toBe(80);
  });

  it('não converte ausência de métrica em zero', () => {
    const r = montarReconciliacaoExecucao({
      statusExecucao: 'OK',
      qtdEmitidas: 3,
      qtdRecebidas: 1,
    });
    expect(r.xmls_validos_confirmados).toBeNull();
    expect(r.xmls_downloads).toBeNull();
    expect(r.cobertura_pct).toBeNull();
    expect(r.status_fiscal).toBe('parcial');
  });

  it('distingue XML novo vs preexistente nos downloads', () => {
    const m = metricasOperacionaisVazias();
    m.contadores.xmlsPersistidos = 5;
    m.contadores.xmlsExportados = 1;
    m.contadores.xmlsJaExistentes = 4;
    const r = montarReconciliacaoExecucao({
      statusExecucao: 'OK',
      fiscal: fiscalBase({ emitidas: 5, vigentes: 5 }),
      metricas: m,
    });
    expect(r.xmls_novos).toBe(1);
    expect(r.xmls_preexistentes_downloads).toBe(4);
    expect(r.xmls_downloads).toBe(5);
  });

  it('downloads já iguais (só preexistentes) não inventam xmls_novos', () => {
    const m = metricasOperacionaisVazias();
    m.contadores.xmlsPersistidos = 7;
    m.contadores.xmlsExportados = 0;
    m.contadores.xmlsJaExistentes = 7;
    const r = montarReconciliacaoExecucao({
      statusExecucao: 'OK',
      fiscal: fiscalBase({ emitidas: 7, vigentes: 7 }),
      metricas: m,
    });
    expect(r.xmls_novos).toBe(0);
    expect(r.xmls_preexistentes_downloads).toBe(7);
    expect(r.xmls_downloads).toBe(7);
    expect(r.status_fiscal).toBe('reconciliada');
  });

  it('divergência de chaves (faltantes > 0) → parcial', () => {
    const m = metricasOperacionaisVazias();
    m.contadores.xmlsPersistidos = 3;
    const r = montarReconciliacaoExecucao({
      statusExecucao: 'OK',
      fiscal: fiscalBase({ emitidas: 10, vigentes: 10 }),
      metricas: m,
    });
    expect(r.chaves_vigentes_faltantes).toBe(7);
    expect(r.status_fiscal).toBe('parcial');
    expect(r.cobertura_pct).toBe(30);
  });
});
