/**
 * API-02G — Transparência do motor e competência fiscal na UI.
 * Sem chamadas reais / sem Chromium de automação.
 */
import {
  formatarCompetenciaFiscal,
  mapearCompetenciaFiscal,
  mapearMotor,
  mapearVisaoFiscal,
} from './execution-fiscal-view.model';
import type { ExecutionRow } from './execution-row.model';

function row(partial: Partial<ExecutionRow> & Pick<ExecutionRow, 'metodo' | 'status'>): ExecutionRow {
  return {
    empresa_id: partial.empresa_id ?? 274,
    cnpj: partial.cnpj ?? '19903461000100',
    razao_social: partial.razao_social ?? 'Empresa Teste',
    metodo: partial.metodo,
    motor: partial.motor,
    competencia_fiscal: partial.competencia_fiscal,
    qtd_emitidas: partial.qtd_emitidas ?? 0,
    qtd_recebidas: partial.qtd_recebidas ?? 0,
    qtd_canceladas: partial.qtd_canceladas ?? 0,
    status: partial.status,
    mensagem: partial.mensagem ?? '',
    ultimo_stage: partial.ultimo_stage,
    resultado_final: partial.resultado_final,
    progresso_fiscal: partial.progresso_fiscal,
  };
}

describe('API-02G motor e competência fiscal', () => {
  it('badge ADN a partir do motor real do Backend', () => {
    const m = mapearMotor(row({ metodo: 'CERTIFICADO', status: 'EM_EXECUCAO', motor: 'ADN' }));
    expect(m.motor).toBe('ADN');
    expect(m.rotulo).toBe('ADN');
  });

  it('badge Playwright para usuário/senha', () => {
    const m = mapearMotor(row({ metodo: 'CREDENCIAL', status: 'EM_EXECUCAO', motor: 'PLAYWRIGHT' }));
    expect(m.motor).toBe('PLAYWRIGHT');
    expect(m.rotulo).toBe('Playwright');
  });

  it('API-02K — badge Portal + SEFIN para A1 padrão', () => {
    const m = mapearMotor(
      row({ metodo: 'CERTIFICADO', status: 'EM_EXECUCAO', motor: 'PORTAL_SEFIN' })
    );
    expect(m.motor).toBe('PORTAL_SEFIN');
    expect(m.rotulo).toBe('Portal + SEFIN');
  });

  it('motor ausente até o Backend informar', () => {
    const m = mapearMotor(row({ metodo: 'CERTIFICADO', status: 'FILA' }));
    expect(m.motor).toBeNull();
    expect(m.rotulo).toBeNull();
  });

  it('competência fiscal YYYY-MM → MM/YYYY (não é pasta de downloads)', () => {
    expect(formatarCompetenciaFiscal('2026-09')).toBe('09/2026');
    const c = mapearCompetenciaFiscal(
      row({ metodo: 'CERTIFICADO', status: 'OK', competencia_fiscal: '2026-09' })
    );
    expect(c.competencia).toBe('2026-09');
    expect(c.rotulo).toBe('09/2026');
  });

  it('visão fiscal combina motor ADN + competência + inventário PARCIAL', () => {
    const v = mapearVisaoFiscal(
      row({
        metodo: 'CERTIFICADO',
        status: 'OK',
        motor: 'ADN',
        competencia_fiscal: '2026-09',
        qtd_emitidas: 7,
        resultado_final: 'NOTAS_EMITIDAS',
        progresso_fiscal: {
          versao: 1,
          batch_id: 'b1',
          empresa_id: '274',
          execucao_id: '7604',
          cnpj: '19903461000100',
          inventario: {
            estado: 'parcial',
            completude: 'PARCIAL',
            conclusao_confiavel: false,
            totais: {
              emitidas: 7,
              recebidas: 0,
              canceladas: 0,
              vigentes: 7,
              indeterminadas: 0,
              descobertos: 7,
              paginas: 1,
            },
          },
          validacao: {
            estado: 'parcial',
            origem: 'ADN',
            vigentes: 7,
            canceladas: 0,
            indeterminadas: 0,
            conclusao_confiavel: false,
          },
          recuperacao: { estado: 'nao_executada', conclusao_confiavel: false },
          codigo: null,
          message: null,
          estado_operacional: null,
          veredito_discovery: null,
        },
      })
    );
    expect(v.motor.rotulo).toBe('ADN');
    expect(v.competenciaFiscal.rotulo).toBe('09/2026');
    expect(v.inventario.completude).toBe('PARCIAL');
    expect(v.inventario.contagens.emitidas).toBe(7);
  });

  it('SSE started ADN não deve sugerir Playwright na visão', () => {
    const v = mapearVisaoFiscal(
      row({
        metodo: 'CERTIFICADO',
        status: 'EM_EXECUCAO',
        motor: 'ADN',
        competencia_fiscal: '2026-09',
        ultimo_stage: 'adn_distribuicao',
        mensagem: 'Distribuição ADN (sem navegador)…',
      })
    );
    expect(v.motor.motor).toBe('ADN');
    expect(v.autenticacao.metodo).toBe('CERTIFICADO');
    expect(v.competenciaFiscal.competencia).toBe('2026-09');
  });

  it('polling finished Playwright preserva credenciais + motor', () => {
    const v = mapearVisaoFiscal(
      row({
        metodo: 'CREDENCIAL',
        status: 'OK',
        motor: 'PLAYWRIGHT',
        competencia_fiscal: '2025-09',
        resultado_final: 'SEM_MOVIMENTO',
      })
    );
    expect(v.motor.rotulo).toBe('Playwright');
    expect(v.autenticacao.rotulo).toBe('Credenciais');
    expect(v.competenciaFiscal.rotulo).toBe('09/2025');
  });
});
