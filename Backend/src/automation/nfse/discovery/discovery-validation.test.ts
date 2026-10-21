import { describe, expect, it } from 'vitest';
import { criarPeriodoConsultaPortal } from '../contracts/periodo';
import {
  confirmarFiltroAplicado,
  montarUrlPesquisaPortal,
  urlConfirmaPesquisa,
  urlTemPeriodoSemExecutar,
} from './discovery-validation';
import type { LeituraFiltroPortal } from './types';

const PERIODO = criarPeriodoConsultaPortal('01/09/2026', '30/09/2026');

function leitura(parcial: Partial<LeituraFiltroPortal> = {}): LeituraFiltroPortal {
  return {
    url: 'https://www.nfse.gov.br/EmissorNacional/Notas/Emitidas?executar=1&datainicio=01%2F09%2F2026&datafim=30%2F09%2F2026',
    dataInicio: PERIODO.inicio,
    dataFim: PERIODO.fim,
    semRegistros: true,
    quantidadeLinhas: 0,
    temTabela: true,
    ...parcial,
  };
}

describe('discovery-validation — submissão do filtro (API-02O)', () => {
  it('não confirma pesquisa só porque datainicio/datafim estão na URL', () => {
    const urlSoDatas =
      'https://www.nfse.gov.br/EmissorNacional/Notas/Emitidas?datainicio=01%2F09%2F2026&datafim=30%2F09%2F2026';
    expect(urlConfirmaPesquisa(urlSoDatas, PERIODO)).toBe(false);
    expect(urlTemPeriodoSemExecutar(urlSoDatas, PERIODO)).toBe(true);
  });

  it('confirma pesquisa só com executar=1 e o período', () => {
    const urlOk =
      'https://www.nfse.gov.br/EmissorNacional/Notas/Emitidas?executar=1&busca=&datainicio=01%2F09%2F2026&datafim=30%2F09%2F2026';
    expect(urlConfirmaPesquisa(urlOk, PERIODO)).toBe(true);
    expect(urlTemPeriodoSemExecutar(urlOk, PERIODO)).toBe(false);
  });

  it('rejeita filtro quando há datas na URL sem executar=1 (caso 7609)', () => {
    const resultado = confirmarFiltroAplicado(
      leitura({
        url: 'https://www.nfse.gov.br/EmissorNacional/Notas/Emitidas?datainicio=01%2F09%2F2026&datafim=30%2F09%2F2026',
        quantidadeLinhas: 0,
        semRegistros: false,
        temTabela: true,
      }),
      PERIODO,
      'EMITIDA'
    );
    expect(resultado.ok).toBe(false);
    expect(resultado.erros.some((e) => /executar=1/.test(e))).toBe(true);
  });

  it('aceita submissão bem-sucedida com executar=1 e listagem vazia confirmada', () => {
    const resultado = confirmarFiltroAplicado(leitura(), PERIODO, 'EMITIDA');
    expect(resultado.ok).toBe(true);
  });

  it('montarUrlPesquisaPortal preserva path Emitidas/Recebidas e força executar=1', () => {
    const emitidas = montarUrlPesquisaPortal(
      'https://www.nfse.gov.br/EmissorNacional/Notas/Emitidas?datainicio=01%2F09%2F2026&datafim=30%2F09%2F2026',
      PERIODO
    );
    const recebidas = montarUrlPesquisaPortal(
      'https://www.nfse.gov.br/EmissorNacional/Notas/Recebidas',
      PERIODO
    );
    expect(emitidas).toContain('/Notas/Emitidas?');
    expect(recebidas).toContain('/Notas/Recebidas?');
    expect(urlConfirmaPesquisa(emitidas, PERIODO)).toBe(true);
    expect(urlConfirmaPesquisa(recebidas, PERIODO)).toBe(true);
    expect(emitidas).not.toContain('token');
  });

  it('montarUrlPesquisaPortal falha fora da listagem (navegação inválida)', () => {
    expect(() =>
      montarUrlPesquisaPortal('https://www.nfse.gov.br/EmissorNacional/Dashboard', PERIODO)
    ).toThrow(/listagem/i);
  });

  it('diferencia Emitidas e Recebidas no path da URL montada', () => {
    const e = montarUrlPesquisaPortal(
      'https://www.nfse.gov.br/EmissorNacional/Notas/Emitidas',
      PERIODO
    );
    const r = montarUrlPesquisaPortal(
      'https://www.nfse.gov.br/EmissorNacional/Notas/Recebidas',
      PERIODO
    );
    expect(e).toContain('Emitidas');
    expect(r).toContain('Recebidas');
    expect(e).not.toContain('Recebidas');
    expect(r).not.toContain('Emitidas');
  });
});
