/**
 * UI-01e-C — tipagem, apply, visão estruturada (offline).
 */
import {
  decidirAplicacaoFiscalSse,
  decidirPollingFiscal,
} from './progresso-fiscal-apply';
import { mapearVisaoFiscal } from './execution-fiscal-view.model';
import type { ExecutionRow } from './execution-row.model';
import {
  parseExecutionFiscalStreamEvent,
  parseProgressoFiscalNfse,
  type ProgressoFiscalNfse,
} from './progresso-fiscal.model';

function fiscal(partial: Partial<ProgressoFiscalNfse> & Pick<ProgressoFiscalNfse, 'inventario' | 'validacao'>): ProgressoFiscalNfse {
  return {
    versao: 1,
    batch_id: partial.batch_id ?? 'lote-1',
    empresa_id: partial.empresa_id ?? '7',
    execucao_id: partial.execucao_id ?? '42',
    cnpj: partial.cnpj ?? '12345678000190',
    inventario: partial.inventario,
    validacao: partial.validacao,
    recuperacao: partial.recuperacao ?? { estado: 'nao_executada', conclusao_confiavel: false },
    codigo: partial.codigo ?? null,
    message: partial.message ?? null,
    estado_operacional: partial.estado_operacional ?? 'CONCLUIDA',
    veredito_discovery: partial.veredito_discovery ?? 'PASS',
  };
}

function invCompleto() {
  return {
    estado: 'completa' as const,
    completude: 'COMPLETO' as const,
    conclusao_confiavel: true,
    totais: {
      emitidas: 10,
      recebidas: 5,
      canceladas: 2,
      vigentes: 12,
      indeterminadas: 1,
      descobertos: 15,
      paginas: 2,
    },
  };
}

function valCompleta() {
  return {
    estado: 'completa' as const,
    origem: 'PORTAL' as const,
    vigentes: 12,
    canceladas: 2,
    indeterminadas: 1,
    conclusao_confiavel: true,
  };
}

function row(partial: Partial<ExecutionRow> = {}): ExecutionRow {
  return {
    empresa_id: partial.empresa_id ?? '7',
    cnpj: partial.cnpj ?? '12345678000190',
    razao_social: partial.razao_social ?? 'Empresa',
    metodo: partial.metodo ?? 'CERTIFICADO',
    qtd_emitidas: partial.qtd_emitidas ?? 0,
    qtd_recebidas: partial.qtd_recebidas ?? 0,
    qtd_canceladas: partial.qtd_canceladas ?? 0,
    status: partial.status ?? 'EM_EXECUCAO',
    mensagem: partial.mensagem ?? '',
    execucao_id: partial.execucao_id,
    progresso_fiscal: partial.progresso_fiscal,
    fiscal_seq: partial.fiscal_seq,
    resultado_final: partial.resultado_final,
  };
}

describe('UI-01e-C progresso fiscal Frontend', () => {
  it('1. inventário completo', () => {
    const v = mapearVisaoFiscal(row({ progresso_fiscal: fiscal({ inventario: invCompleto(), validacao: valCompleta() }), status: 'OK' }));
    expect(v.fiscalEstruturado).toBe(true);
    expect(v.inventario.estado).toBe('Completo');
    expect(v.inventario.completude).toBe('COMPLETO');
    expect(v.inventario.contagens.total).toBe(15);
    expect(v.inventario.fonteEstruturada).toBe(true);
  });

  it('1b. origem ADN com inventário PARCIAL (API-01S)', () => {
    const p = fiscal({
      inventario: {
        estado: 'parcial',
        completude: 'PARCIAL',
        conclusao_confiavel: false,
        totais: {
          emitidas: 2,
          recebidas: 1,
          canceladas: 0,
          vigentes: 3,
          indeterminadas: 0,
          descobertos: 3,
          paginas: 1,
        },
      },
      validacao: {
        estado: 'parcial',
        origem: 'ADN',
        vigentes: 3,
        canceladas: 0,
        indeterminadas: 0,
        conclusao_confiavel: false,
      },
      veredito_discovery: null,
      estado_operacional: 'COMPLETO',
      message: 'Distribuição ADN; inventário mensal NÃO comprovado.',
    });
    expect(parseProgressoFiscalNfse(p)).not.toBeNull();
    const v = mapearVisaoFiscal(row({ progresso_fiscal: p, status: 'OK' }));
    expect(v.inventario.completude).toBe('PARCIAL');
    expect(v.inventario.estado).toBe('Parcial');
    expect(v.validacao.exibirContagens).toBe(true);
    expect(v.validacao.vigentes).toBe(3);
  });

  it('2. inventário parcial', () => {
    const p = fiscal({
      inventario: {
        estado: 'parcial',
        completude: 'PARCIAL',
        conclusao_confiavel: false,
        totais: { ...invCompleto().totais, descobertos: 4 },
      },
      validacao: { ...valCompleta(), estado: 'parcial', conclusao_confiavel: false },
      veredito_discovery: 'INCOMPLETO',
      estado_operacional: 'INCOMPLETA',
    });
    const v = mapearVisaoFiscal(row({ progresso_fiscal: p }));
    expect(v.inventario.estado).toBe('Parcial');
    expect(v.validacao.estado).toBe('Parcial');
  });

  it('3. inventário indeterminado', () => {
    const p = fiscal({
      inventario: {
        estado: 'parcial',
        completude: 'INDETERMINADO',
        conclusao_confiavel: false,
        totais: { emitidas: 0, recebidas: 0, canceladas: 0, vigentes: 0, indeterminadas: 2, descobertos: 0, paginas: 1 },
      },
      validacao: { estado: 'parcial', origem: 'PORTAL', vigentes: 0, canceladas: 0, indeterminadas: 2, conclusao_confiavel: false },
    });
    expect(mapearVisaoFiscal(row({ progresso_fiscal: p })).inventario.completude).toBe('INDETERMINADO');
  });

  it('4–5. validação completa vs parcial', () => {
    const completa = mapearVisaoFiscal(row({ progresso_fiscal: fiscal({ inventario: invCompleto(), validacao: valCompleta() }) }));
    expect(completa.validacao.estado).toBe('Completo');
    expect(completa.validacao.vigentes).toBe(12);
    const parcial = mapearVisaoFiscal(
      row({
        progresso_fiscal: fiscal({
          inventario: { ...invCompleto(), estado: 'parcial', completude: 'PARCIAL', conclusao_confiavel: false },
          validacao: { ...valCompleta(), estado: 'completa', conclusao_confiavel: true },
        }),
      })
    );
    // Não declara completa se inventário não confiável.
    expect(parcial.validacao.estado).toBe('Parcial');
  });

  it('6. recuperação não executada', () => {
    const v = mapearVisaoFiscal(row({ progresso_fiscal: fiscal({ inventario: invCompleto(), validacao: valCompleta() }) }));
    expect(v.recuperacao.estado).toBe('Não executada');
    expect(v.recuperacao.exibirProgresso).toBe(false);
  });

  it('7–10. falha, cancelamento, timeout, limite', () => {
    for (const [estado, rotulo] of [
      ['falha', 'Falha'],
      ['cancelada', 'Cancelado'],
      ['timeout', 'Timeout'],
      ['limite', 'Limite atingido'],
    ] as const) {
      const p = fiscal({
        inventario: { ...invCompleto(), estado, conclusao_confiavel: false, completude: 'PARCIAL' },
        validacao: { ...valCompleta(), estado, conclusao_confiavel: false },
      });
      expect(mapearVisaoFiscal(row({ progresso_fiscal: p })).inventario.estado).toBe(rotulo);
    }
  });

  it('11. SSE fiscal válido', () => {
    const ev = parseExecutionFiscalStreamEvent({
      type: 'execution:fiscal',
      batch_id: 'lote-1',
      empresa_id: '7',
      execucao_id: '42',
      cnpj: '12345678000190',
      fiscal: fiscal({ inventario: invCompleto(), validacao: valCompleta() }),
    });
    expect(ev).not.toBeNull();
    const dec = decidirAplicacaoFiscalSse(row(), ev!.batch_id, ev!.empresa_id, ev!.execucao_id, ev!.fiscal, {
      batchIdAtual: 'lote-1',
      proximoSeq: 0,
    });
    expect(dec.acao).toBe('aplicar');
  });

  it('12. SSE de outro lote — ignora', () => {
    const f = fiscal({ inventario: invCompleto(), validacao: valCompleta(), batch_id: 'outro' });
    const dec = decidirAplicacaoFiscalSse(row(), 'outro', '7', '42', f, {
      batchIdAtual: 'lote-1',
      proximoSeq: 1,
    });
    expect(dec.acao).toBe('ignorar');
  });

  it('13. SSE de outra execução — ignora', () => {
    const base = row({
      execucao_id: '42',
      progresso_fiscal: fiscal({ inventario: invCompleto(), validacao: valCompleta() }),
      fiscal_seq: 1,
    });
    const f = fiscal({ inventario: invCompleto(), validacao: valCompleta(), execucao_id: '99' });
    const dec = decidirAplicacaoFiscalSse(base, 'lote-1', '7', '99', f, {
      batchIdAtual: 'lote-1',
      proximoSeq: 1,
    });
    expect(dec.acao).toBe('ignorar');
    if (dec.acao === 'ignorar') {
      expect(dec.motivo).toBe('execucao_divergente');
    }
  });

  it('14. polling fiscal', () => {
    const f = fiscal({ inventario: invCompleto(), validacao: valCompleta() });
    const dec = decidirPollingFiscal(row(), f, 'concluido', { batchIdAtual: 'lote-1', proximoSeq: 0 });
    expect(dec.acao).toBe('aplicar');
  });

  it('15. polling sem fiscal (em andamento) — mantém / ignora limpeza', () => {
    const com = row({
      progresso_fiscal: fiscal({ inventario: invCompleto(), validacao: valCompleta() }),
      status: 'EM_EXECUCAO',
    });
    const dec = decidirPollingFiscal(com, null, 'em_andamento', { batchIdAtual: 'lote-1', proximoSeq: 2 });
    expect(dec.acao).toBe('ignorar');
  });

  it('16–17. snapshot expirado / restart — limpa em status terminal', () => {
    const com = row({
      progresso_fiscal: fiscal({ inventario: invCompleto(), validacao: valCompleta() }),
      status: 'OK',
    });
    const dec = decidirPollingFiscal(com, null, 'concluido', { batchIdAtual: 'lote-1', proximoSeq: 3 });
    expect(dec.acao).toBe('limpar');
    if (dec.acao === 'limpar') {
      expect(dec.row.progresso_fiscal).toBeUndefined();
    }
  });

  it('18. eventos fora de ordem — mesma execução atualiza; outra execução rejeita', () => {
    let r = row();
    const f1 = fiscal({ inventario: invCompleto(), validacao: valCompleta(), execucao_id: '42' });
    const d1 = decidirAplicacaoFiscalSse(r, 'lote-1', '7', '42', f1, { batchIdAtual: 'lote-1', proximoSeq: 0 });
    expect(d1.acao).toBe('aplicar');
    if (d1.acao === 'aplicar') r = d1.row;
    const f2 = {
      ...f1,
      inventario: { ...f1.inventario, totais: { ...f1.inventario.totais, emitidas: 99, descobertos: 104 } },
    };
    const d2 = decidirAplicacaoFiscalSse(r, 'lote-1', '7', '42', f2, {
      batchIdAtual: 'lote-1',
      proximoSeq: d1.proximoSeq,
    });
    expect(d2.acao).toBe('aplicar');
    if (d2.acao === 'aplicar') {
      expect(d2.row.progresso_fiscal!.inventario.totais.emitidas).toBe(99);
      expect(d2.row.fiscal_seq).toBeGreaterThan(r.fiscal_seq ?? 0);
    }
  });

  it('19. execução legada — sem fiscal estruturado (UI-01d)', () => {
    const v = mapearVisaoFiscal(
      row({ status: 'OK', qtd_emitidas: 3, qtd_recebidas: 1, resultado_final: 'NFS_ENCONTRADAS' })
    );
    expect(v.fiscalEstruturado).toBe(false);
    expect(v.inventario.estado).toBe('Concluído');
    expect(v.validacao.estado).toBe('Não disponível');
    expect(v.recuperacao.estado).toBe('Não disponível');
  });

  it('20. CAPTCHA — autenticação preservada com fiscal', () => {
    const v = mapearVisaoFiscal(
      row({
        status: 'AGUARDANDO_CAPTCHA',
        metodo: 'CREDENCIAL',
        progresso_fiscal: fiscal({
          inventario: { ...invCompleto(), estado: 'em_andamento', conclusao_confiavel: false, completude: 'PARCIAL' },
          validacao: { ...valCompleta(), estado: 'parcial', conclusao_confiavel: false },
        }),
      })
    );
    expect(v.autenticacao.aguardandoCaptcha).toBe(true);
    expect(v.autenticacao.rotulo).toBe('Credenciais');
    expect(v.recuperacao.estado).toBe('Não executada');
  });

  it('parse rejeita payload incompleto', () => {
    expect(parseProgressoFiscalNfse({ versao: 1 })).toBeNull();
    expect(parseExecutionFiscalStreamEvent({ type: 'execution:counts' })).toBeNull();
  });

  it('isolamento empresas / lotes no apply', () => {
    const f = fiscal({ inventario: invCompleto(), validacao: valCompleta(), empresa_id: '8' });
    const dec = decidirAplicacaoFiscalSse(row({ empresa_id: '7' }), 'lote-1', '8', '42', f, {
      batchIdAtual: 'lote-1',
      proximoSeq: 0,
    });
    expect(dec.acao).toBe('ignorar');
  });
});
