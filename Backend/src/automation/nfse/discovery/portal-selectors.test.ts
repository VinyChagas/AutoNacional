import { describe, expect, it } from 'vitest';
import {
  SELETORES_BOTAO_FILTRAR_PORTAL,
  SELETOR_FORM_FILTRO_PORTAL,
  VIEWPORT_DESCOBERTA_PORTAL_SEFIN,
  seletoresMenuNotas,
  urlDiagnosticoPortal,
} from './portal-selectors';

describe('portal-selectors (API-02M/02O)', () => {
  it('viewport de descoberta é maior que o slot CAPTCHA compacto', () => {
    expect(VIEWPORT_DESCOBERTA_PORTAL_SEFIN.width).toBeGreaterThanOrEqual(1280);
    expect(VIEWPORT_DESCOBERTA_PORTAL_SEFIN.height).toBeGreaterThanOrEqual(900);
  });

  it('menu Emitidas/Recebidas prioriza href estável antes do nth-of-type', () => {
    const emitidas = seletoresMenuNotas('EMITIDA');
    const recebidas = seletoresMenuNotas('RECEBIDA');
    expect(emitidas[0]).toContain('/Notas/Emitidas');
    expect(recebidas[0]).toContain('/Notas/Recebidas');
    expect(emitidas[emitidas.length - 1]).toContain('nth-of-type(3)');
    expect(recebidas[recebidas.length - 1]).toContain('nth-of-type(4)');
  });

  it('botão filtrar prioriza name=executar antes de button.btn genérico', () => {
    const idxExecutar = SELETORES_BOTAO_FILTRAR_PORTAL.findIndex((s) =>
      s.includes('name="executar"')
    );
    const idxBtnGenerico = SELETORES_BOTAO_FILTRAR_PORTAL.findIndex((s) => s === '#searchbar button.btn');
    expect(idxExecutar).toBeGreaterThanOrEqual(0);
    expect(idxBtnGenerico).toBeGreaterThan(idxExecutar);
    expect(SELETORES_BOTAO_FILTRAR_PORTAL[0]).toContain('name="executar"');
  });

  it('form do filtro não depende de XPath absoluto', () => {
    expect(SELETOR_FORM_FILTRO_PORTAL[0]).toBe('#searchbar form');
    expect(SELETOR_FORM_FILTRO_PORTAL.some((s) => s.includes('#datainicio'))).toBe(true);
  });

  it('urlDiagnosticoPortal preserva path e datas públicas sem query sensível', () => {
    const bruto =
      'https://www.nfse.gov.br/EmissorNacional/Notas/Emitidas?executar=1&datainicio=01%2F09%2F2026&datafim=30%2F09%2F2026&token=segredo';
    const limpa = urlDiagnosticoPortal(bruto);
    expect(limpa).toContain('/Notas/Emitidas');
    expect(limpa).toContain('executar=1');
    expect(limpa).toContain('datainicio=');
    expect(limpa).not.toContain('token');
    expect(limpa).not.toContain('segredo');
  });

  it('urlDiagnosticoPortal mostra datas sem executar (diagnóstico 7609)', () => {
    const limpa = urlDiagnosticoPortal(
      'https://www.nfse.gov.br/EmissorNacional/Notas/Emitidas?datainicio=01%2F09%2F2026&datafim=30%2F09%2F2026'
    );
    expect(limpa).toContain('datainicio=');
    expect(limpa).not.toContain('executar=');
  });
});
