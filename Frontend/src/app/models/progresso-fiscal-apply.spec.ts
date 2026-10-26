/**
 * UI-01e-C1 — proteção conservadora contra regressão fiscal (offline).
 */
import {
  avaliarProtecaoRegressaoFiscal,
  decidirAplicacaoFiscal,
  decidirAplicacaoFiscalSse,
  decidirPollingFiscal,
  limparDiagnosticosFiscalConservador,
} from './progresso-fiscal-apply';
import { mapearVisaoFiscal } from './execution-fiscal-view.model';
import type { ExecutionRow } from './execution-row.model';
import type { ProgressoFiscalNfse } from './progresso-fiscal.model';

function baseTotais(over: Partial<ProgressoFiscalNfse['inventario']['totais']> = {}) {
  return {
    emitidas: 10,
    recebidas: 5,
    canceladas: 1,
    vigentes: 12,
    indeterminadas: 2,
    descobertos: 15,
    paginas: 2,
    ...over,
  };
}

function fiscal(opts: {
  estado: ProgressoFiscalNfse['inventario']['estado'];
  confiavel?: boolean;
  completude?: ProgressoFiscalNfse['inventario']['completude'];
  totais?: Partial<ProgressoFiscalNfse['inventario']['totais']>;
  execucao_id?: string;
  empresa_id?: string;
  batch_id?: string | null;
}): ProgressoFiscalNfse {
  const confiavel = opts.confiavel ?? opts.estado === 'completa';
  return {
    versao: 1,
    batch_id: opts.batch_id === undefined ? 'lote-1' : opts.batch_id,
    empresa_id: opts.empresa_id ?? '7',
    execucao_id: opts.execucao_id ?? '42',
    cnpj: '12345678000190',
    inventario: {
      estado: opts.estado,
      completude:
        opts.completude ??
        (opts.estado === 'completa' ? 'COMPLETO' : 'PARCIAL'),
      conclusao_confiavel: confiavel,
      totais: baseTotais(opts.totais),
    },
    validacao: {
      estado: opts.estado === 'completa' ? 'completa' : opts.estado === 'parcial' ? 'parcial' : opts.estado,
      origem: 'PORTAL',
      vigentes: 12,
      canceladas: 1,
      indeterminadas: 2,
      conclusao_confiavel: confiavel && opts.estado === 'completa',
    },
    recuperacao: { estado: 'nao_executada', conclusao_confiavel: false },
    codigo: null,
    message: null,
    estado_operacional: null,
    veredito_discovery: opts.estado === 'completa' ? 'PASS' : 'INCOMPLETO',
  };
}

function row(p: Partial<ExecutionRow> = {}): ExecutionRow {
  return {
    empresa_id: p.empresa_id ?? '7',
    cnpj: p.cnpj ?? '12345678000190',
    razao_social: 'Emp',
    metodo: 'CERTIFICADO',
    qtd_emitidas: p.qtd_emitidas ?? 0,
    qtd_recebidas: 0,
    qtd_canceladas: 0,
    status: p.status ?? 'EM_EXECUCAO',
    mensagem: '',
    execucao_id: p.execucao_id,
    progresso_fiscal: p.progresso_fiscal,
    fiscal_seq: p.fiscal_seq,
  };
}

afterEach(() => {
  limparDiagnosticosFiscalConservador();
});

describe('UI-01e-C1 proteção regressão fiscal', () => {
  it('1. parcial → completo: aplica', () => {
    const r = row({ progresso_fiscal: fiscal({ estado: 'parcial', confiavel: false }) });
    const dec = decidirAplicacaoFiscal(r, fiscal({ estado: 'completa', confiavel: true }), {
      batchIdAtual: 'lote-1',
      proximoSeq: 0,
    }, 'sse');
    expect(dec.acao).toBe('aplicar');
    if (dec.acao === 'aplicar') {
      expect(dec.row.progresso_fiscal!.inventario.estado).toBe('completa');
      expect(dec.row.progresso_fiscal!.inventario.conclusao_confiavel).toBe(true);
    }
  });

  it('2. completo → parcial atrasado: ignora e preserva totais', () => {
    const completo = fiscal({ estado: 'completa', confiavel: true, totais: { emitidas: 10, descobertos: 15 } });
    const r = row({ progresso_fiscal: completo, execucao_id: '42' });
    const atrasado = fiscal({ estado: 'parcial', confiavel: false, totais: { emitidas: 99, descobertos: 200 } });
    const dec = decidirAplicacaoFiscal(r, atrasado, { batchIdAtual: 'lote-1', proximoSeq: 1 }, 'sse');
    expect(dec.acao).toBe('ignorar');
    expect(avaliarProtecaoRegressaoFiscal(completo, atrasado).motivo).toBe(
      'regressao_completo_para_intermediario'
    );
    expect(r.progresso_fiscal!.inventario.totais.emitidas).toBe(10);
  });

  it('3. completo → em_andamento atrasado: ignora', () => {
    const completo = fiscal({ estado: 'completa', confiavel: true });
    const dec = decidirAplicacaoFiscal(
      row({ progresso_fiscal: completo, execucao_id: '42' }),
      fiscal({ estado: 'em_andamento', confiavel: false }),
      { batchIdAtual: 'lote-1', proximoSeq: 1 },
      'sse'
    );
    expect(dec.acao).toBe('ignorar');
  });

  it('4. falha → em_andamento atrasado: ignora', () => {
    const dec = decidirAplicacaoFiscal(
      row({ progresso_fiscal: fiscal({ estado: 'falha', confiavel: false }), execucao_id: '42' }),
      fiscal({ estado: 'em_andamento', confiavel: false }),
      { batchIdAtual: 'lote-1', proximoSeq: 1 },
      'sse'
    );
    expect(dec.acao).toBe('ignorar');
    if (dec.acao === 'ignorar') {
      expect(dec.motivo).toBe('regressao_terminal_para_intermediario');
    }
  });

  it('5. cancelada → parcial atrasado: ignora', () => {
    const dec = decidirAplicacaoFiscal(
      row({ progresso_fiscal: fiscal({ estado: 'cancelada', confiavel: false }), execucao_id: '42' }),
      fiscal({ estado: 'parcial', confiavel: false }),
      { batchIdAtual: 'lote-1', proximoSeq: 1 },
      'sse'
    );
    expect(dec.acao).toBe('ignorar');
  });

  it('6. timeout → em_andamento atrasado: ignora', () => {
    const dec = decidirAplicacaoFiscal(
      row({ progresso_fiscal: fiscal({ estado: 'timeout', confiavel: false }), execucao_id: '42' }),
      fiscal({ estado: 'em_andamento', confiavel: false }),
      { batchIdAtual: 'lote-1', proximoSeq: 1 },
      'sse'
    );
    expect(dec.acao).toBe('ignorar');
  });

  it('7. limite → parcial atrasado: ignora', () => {
    const dec = decidirAplicacaoFiscal(
      row({ progresso_fiscal: fiscal({ estado: 'limite', confiavel: false }), execucao_id: '42' }),
      fiscal({ estado: 'parcial', confiavel: false }),
      { batchIdAtual: 'lote-1', proximoSeq: 1 },
      'sse'
    );
    expect(dec.acao).toBe('ignorar');
  });

  it('8. dois terminais conflitantes: preserva existente', () => {
    const falha = fiscal({ estado: 'falha', confiavel: false });
    const cancelada = fiscal({ estado: 'cancelada', confiavel: false });
    const r = row({ progresso_fiscal: falha, execucao_id: '42' });
    const dec = decidirAplicacaoFiscal(r, cancelada, { batchIdAtual: 'lote-1', proximoSeq: 2 }, 'sse');
    expect(dec.acao).toBe('ignorar');
    if (dec.acao === 'ignorar') {
      expect(dec.motivo).toBe('conflito_terminais_erro');
      expect(dec.diagnostico).toContain('de=falha');
      expect(dec.diagnostico).toContain('para=cancelada');
      expect(dec.diagnostico).not.toMatch(/senha|pfx|xml|cookie|token/i);
    }
    expect(r.progresso_fiscal!.inventario.estado).toBe('falha');
  });

  it('9. polling terminal sem fiscal: limpa', () => {
    const dec = decidirPollingFiscal(
      row({
        status: 'OK',
        progresso_fiscal: fiscal({ estado: 'completa', confiavel: true }),
      }),
      null,
      'concluido',
      { batchIdAtual: 'lote-1', proximoSeq: 3 }
    );
    expect(dec.acao).toBe('limpar');
  });

  it('10. polling com fiscal válido: aplica (parcial→completo)', () => {
    const dec = decidirPollingFiscal(
      row({ progresso_fiscal: fiscal({ estado: 'parcial', confiavel: false }), execucao_id: '42' }),
      fiscal({ estado: 'completa', confiavel: true }),
      'concluido',
      { batchIdAtual: 'lote-1', proximoSeq: 0 }
    );
    expect(dec.acao).toBe('aplicar');
  });

  it('11. SSE de outro lote', () => {
    const f = fiscal({ estado: 'completa', batch_id: 'outro' });
    const dec = decidirAplicacaoFiscalSse(row(), 'outro', '7', '42', f, {
      batchIdAtual: 'lote-1',
      proximoSeq: 0,
    });
    expect(dec.acao).toBe('ignorar');
    if (dec.acao === 'ignorar') expect(dec.motivo).toBe('sse_outro_lote');
  });

  it('12. SSE de outra empresa', () => {
    const f = fiscal({ estado: 'completa', empresa_id: '9' });
    const dec = decidirAplicacaoFiscalSse(row({ empresa_id: '7' }), 'lote-1', '9', '42', f, {
      batchIdAtual: 'lote-1',
      proximoSeq: 0,
    });
    expect(dec.acao).toBe('ignorar');
  });

  it('13. SSE de outra execução', () => {
    const r = row({
      execucao_id: '42',
      progresso_fiscal: fiscal({ estado: 'completa', confiavel: true }),
    });
    const f = fiscal({ estado: 'completa', execucao_id: '99' });
    const dec = decidirAplicacaoFiscalSse(r, 'lote-1', '7', '99', f, {
      batchIdAtual: 'lote-1',
      proximoSeq: 1,
    });
    expect(dec.acao).toBe('ignorar');
  });

  it('14–15. contagens menores/maiores não decidem precedência (completo permanece)', () => {
    const completo = fiscal({ estado: 'completa', confiavel: true, totais: { emitidas: 5, descobertos: 5 } });
    const r = row({ progresso_fiscal: completo, execucao_id: '42' });
    const menor = fiscal({
      estado: 'parcial',
      confiavel: false,
      totais: { emitidas: 1, descobertos: 1 },
    });
    const maior = fiscal({
      estado: 'parcial',
      confiavel: false,
      totais: { emitidas: 999, descobertos: 999, paginas: 99 },
    });
    expect(decidirAplicacaoFiscal(r, menor, { batchIdAtual: 'lote-1', proximoSeq: 1 }, 'sse').acao).toBe(
      'ignorar'
    );
    expect(decidirAplicacaoFiscal(r, maior, { batchIdAtual: 'lote-1', proximoSeq: 1 }, 'sse').acao).toBe(
      'ignorar'
    );
    expect(r.progresso_fiscal!.inventario.totais.emitidas).toBe(5);
  });

  it('16. fallback legado sem progresso_fiscal', () => {
    const v = mapearVisaoFiscal(
      row({ status: 'OK', qtd_emitidas: 4, progresso_fiscal: undefined })
    );
    expect(v.fiscalEstruturado).toBe(false);
    expect(v.inventario.estado).toBe('Concluído');
  });

  it('polling não aplica regressão completo→parcial', () => {
    const dec = decidirPollingFiscal(
      row({
        status: 'OK',
        execucao_id: '42',
        progresso_fiscal: fiscal({ estado: 'completa', confiavel: true }),
      }),
      fiscal({ estado: 'parcial', confiavel: false }),
      'concluido',
      { batchIdAtual: 'lote-1', proximoSeq: 5 }
    );
    expect(dec.acao).toBe('ignorar');
  });
});

describe('UI-01e-D revisão monotônica no Angular', () => {
  function comRev(
    estado: ProgressoFiscalNfse['inventario']['estado'],
    revisao: number,
    extra?: { confiavel?: boolean; emitidas?: number }
  ): ProgressoFiscalNfse {
    return {
      ...fiscal({
        estado,
        confiavel: extra?.confiavel ?? estado === 'completa',
        totais: extra?.emitidas != null ? { emitidas: extra.emitidas, descobertos: extra.emitidas } : undefined,
      }),
      revisao,
    };
  }

  it('revisão maior aplica; igual e menor ignoram', () => {
    const r = row({
      execucao_id: '42',
      progresso_fiscal: comRev('parcial', 1, { confiavel: false }),
    });
    const maior = decidirAplicacaoFiscal(r, comRev('completa', 2), {
      batchIdAtual: 'lote-1',
      proximoSeq: 0,
    }, 'sse');
    expect(maior.acao).toBe('aplicar');

    const base = maior.acao === 'aplicar' ? maior.row : r;
    const igual = decidirAplicacaoFiscal(base, comRev('completa', 2), {
      batchIdAtual: 'lote-1',
      proximoSeq: 1,
    }, 'polling');
    expect(igual.acao).toBe('ignorar');
    if (igual.acao === 'ignorar') expect(igual.motivo).toBe('revisao_duplicata');

    const menor = decidirAplicacaoFiscal(base, comRev('parcial', 1, { confiavel: false }), {
      batchIdAtual: 'lote-1',
      proximoSeq: 2,
    }, 'sse');
    expect(menor.acao).toBe('ignorar');
    if (menor.acao === 'ignorar') expect(menor.motivo).toBe('revisao_atrasada');
  });

  it('revisão maior pode avançar mesmo que C1 considerasse regressão', () => {
    // Backend republicou com revisão maior (fonte de verdade).
    const r = row({
      execucao_id: '42',
      progresso_fiscal: comRev('completa', 3, { confiavel: true }),
    });
    const dec = decidirAplicacaoFiscal(
      r,
      comRev('parcial', 4, { confiavel: false }),
      { batchIdAtual: 'lote-1', proximoSeq: 0 },
      'polling'
    );
    expect(dec.acao).toBe('aplicar');
  });

  it('evento legado sem revisão mantém proteção C1', () => {
    const r = row({
      execucao_id: '42',
      progresso_fiscal: fiscal({ estado: 'completa', confiavel: true }),
    });
    const dec = decidirAplicacaoFiscal(
      r,
      fiscal({ estado: 'parcial', confiavel: false }),
      { batchIdAtual: 'lote-1', proximoSeq: 0 },
      'sse'
    );
    expect(dec.acao).toBe('ignorar');
  });

  it('não compara revisões entre execuções diferentes', () => {
    const r = row({
      execucao_id: '42',
      progresso_fiscal: { ...comRev('completa', 5), execucao_id: '42' },
    });
    const outro = { ...comRev('parcial', 1, { confiavel: false }), execucao_id: '99' };
    const dec = decidirAplicacaoFiscal(r, outro, { batchIdAtual: 'lote-1', proximoSeq: 0 }, 'sse');
    expect(dec.acao).toBe('ignorar');
    if (dec.acao === 'ignorar') expect(dec.motivo).toBe('execucao_divergente');
  });
});
