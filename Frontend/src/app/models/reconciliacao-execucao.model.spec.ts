import {
  contarStatusFiscal,
  mapearReconciliacaoLinha,
  percentualProcessadas,
} from './reconciliacao-execucao.model';
import type { ExecutionRow } from './execution-row.model';

function row(partial: Partial<ExecutionRow> & Pick<ExecutionRow, 'empresa_id' | 'status'>): ExecutionRow {
  return {
    cnpj: '19903461000100',
    razao_social: 'Teste',
    metodo: 'CERTIFICADO',
    qtd_emitidas: 0,
    qtd_recebidas: 0,
    qtd_canceladas: 0,
    mensagem: '',
    ...partial,
  };
}

describe('API-03B reconciliacao-execucao (FE)', () => {
  it('progresso = processadas (OK+ERRO) / total — erros não são sucesso', () => {
    const rows = [
      row({ empresa_id: 1, status: 'OK' }),
      row({ empresa_id: 2, status: 'ERRO', mensagem: 'falha' }),
      row({ empresa_id: 3, status: 'FILA' }),
      row({ empresa_id: 4, status: 'EM_EXECUCAO' }),
    ];
    expect(percentualProcessadas(rows)).toBe(50);
    expect(contarStatusFiscal(rows, 'erro')).toBe(1);
  });

  it('lote 100% processado com falhas → 100% progresso', () => {
    const rows = [
      row({ empresa_id: 1, status: 'OK' }),
      row({ empresa_id: 2, status: 'ERRO' }),
      row({ empresa_id: 3, status: 'ERRO' }),
    ];
    expect(percentualProcessadas(rows)).toBe(100);
  });

  it('ausência de métrica → — (não zero)', () => {
    const v = mapearReconciliacaoLinha(row({ empresa_id: 1, status: 'OK', qtd_emitidas: 2 }));
    expect(v.xmlsValidos).toBe('—');
    expect(v.downloads).toBe('—');
    expect(v.cobertura).toBe('—');
  });

  it('canceladas permanecem no inventário e não confundem cobertura', () => {
    const v = mapearReconciliacaoLinha(
      row({
        empresa_id: 1,
        status: 'OK',
        reconciliacao: {
          emitidas_descobertas: 12,
          recebidas_descobertas: 0,
          vigentes: 10,
          canceladas: 2,
          indeterminadas: 0,
          xmls_validos_confirmados: 10,
          xmls_downloads: 10,
          chaves_vigentes_faltantes: 0,
          cobertura_pct: 100,
          status_fiscal: 'reconciliada',
        },
      })
    );
    expect(v.canceladas).toBe('2');
    expect(v.vigentes).toBe('10');
    expect(v.cobertura).toBe('100%');
    expect(v.statusFiscal).toBe('reconciliada');
  });

  it('indeterminadas viram concluida_com_pendencias e listam detalhe (API-03M)', () => {
    const v = mapearReconciliacaoLinha(
      row({
        empresa_id: 1,
        status: 'OK',
        resultado_final: 'CONCLUIDA_COM_PENDENCIAS',
        reconciliacao: {
          vigentes: 5,
          indeterminadas: 1,
          xmls_validos_confirmados: 5,
          xmls_com_atencao_fiscal: 1,
          status_fiscal: 'concluida_com_pendencias',
          pendencias_fiscais: [
            {
              chave_acesso: '35503081100019209906829000000135665026088014831864',
              codigo: 'ATENCAO_SITUACAO_NAO_CONFIRMADA',
              motivo: 'XML recuperado; situação não confirmada',
              xml_recuperado: true,
              documento_exportado: true,
            },
          ],
        },
      })
    );
    expect(v.temIndeterminadas).toBe(true);
    expect(v.temPendenciasFiscais).toBe(true);
    expect(v.indeterminadas).toBe('1');
    expect(v.statusFiscal).toBe('concluida_com_pendencias');
    expect(v.pendenciasFiscais.length).toBe(1);
    expect(v.pendenciasFiscais[0].xmlRecuperado).toBe(true);
  });

  it('API-03N — faltantes usam lista de chaves vigentes (não infla com indeterminada)', () => {
    const v = mapearReconciliacaoLinha(
      row({
        empresa_id: 1,
        status: 'ERRO',
        mensagem: 'Cobertura fiscal incompleta',
        reconciliacao: {
          vigentes: 204,
          indeterminadas: 1,
          xmls_validos_confirmados: 203,
          xmls_com_atencao_fiscal: 1,
          chaves_vigentes_faltantes: 1,
          chaves_vigentes_faltantes_lista: [
            '35503082227458780000174000000000073626087361792414',
          ],
          status_fiscal: 'erro',
        },
      })
    );
    expect(v.vigentes).toBe('204');
    expect(v.faltantes).toBe('1');
    expect(v.chavesVigentesFaltantesLista.length).toBe(1);
    expect(v.xmlsAtencaoFiscal).toBe('1');
  });

  it('distingue XMLs novos vs preexistentes via payload API', () => {
    const v = mapearReconciliacaoLinha(
      row({
        empresa_id: 1,
        status: 'OK',
        reconciliacao: {
          vigentes: 5,
          xmls_validos_confirmados: 5,
          xmls_novos: 1,
          xmls_preexistentes_downloads: 4,
          xmls_downloads: 5,
          status_fiscal: 'reconciliada',
        },
      })
    );
    expect(v.downloads).toBe('5');
    expect(v.statusFiscal).toBe('reconciliada');
  });

  it('erro expõe motivo, etapa e hint de retomada', () => {
    const v = mapearReconciliacaoLinha(
      row({
        empresa_id: 1,
        status: 'ERRO',
        mensagem: 'NAV_FALHA filtro',
        ultimo_stage: 'abrir_menu',
        reconciliacao: {
          status_fiscal: 'erro',
          motivo_erro: 'NAV_FALHA filtro',
          etapa_falha: 'abrir_menu',
          chaves_vigentes_faltantes: 3,
        },
      })
    );
    expect(v.statusFiscal).toBe('erro');
    expect(v.motivoErro).toContain('NAV_FALHA');
    expect(v.etapaFalha).toBe('abrir_menu');
    expect(v.faltantes).toBe('3');
    expect(v.retomavelHint).toBeTruthy();
  });

  it('compatibilidade com execução antiga sem reconciliacao', () => {
    const v = mapearReconciliacaoLinha(
      row({
        empresa_id: 1,
        status: 'OK',
        qtd_emitidas: 0,
        qtd_recebidas: 0,
        metricas_operacionais: null,
        progresso_fiscal: undefined,
      })
    );
    expect(v.statusFiscal === 'sem_movimento' || v.statusFiscal === 'indisponivel' || v.statusFiscal === 'parcial').toBe(
      true
    );
    expect(v.xmlsValidos).toBe('—');
  });
});
