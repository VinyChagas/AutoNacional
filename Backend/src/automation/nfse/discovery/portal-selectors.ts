/**
 * Seletores do Portal Nacional para listagem Emitidas/Recebidas.
 * Preferir href/role estáveis; nth-of-type é fallback frágil.
 *
 * Contrato de pesquisa (GET observado): ?executar=1&busca=&datainicio=&datafim=
 * O parâmetro executar costuma vir do botão submit name="executar" value="1";
 * form.submit() sem esse botão envia só as datas — sintoma da exec 7609.
 */
import type { DirecaoDocumentoFiscal } from '../contracts/documento-fiscal';
import { DIRECAO_PARA_TIPO_NOTA_UI } from '../contracts/documento-fiscal';

/** Viewport mínimo útil para descoberta A1 (não usar slot CAPTCHA compacto). */
export const VIEWPORT_DESCOBERTA_PORTAL_SEFIN = {
  width: 1280,
  height: 900,
} as const;

export function seletoresMenuNotas(direcao: DirecaoDocumentoFiscal): string[] {
  const tipo = DIRECAO_PARA_TIPO_NOTA_UI[direcao];
  const caminho = `/Notas/${tipo}`;
  return [
    `a[href*="${caminho}"]`,
    `a[href*="${caminho.toLowerCase()}"]`,
    `nav a:has-text("${tipo}")`,
    `.sidebar a:has-text("${tipo}")`,
    `li a:has-text("${tipo}")`,
    // Fallback legado (ordem do menu do portal)
    direcao === 'EMITIDA' ? 'li:nth-of-type(3) img' : 'li:nth-of-type(4) img',
  ];
}

/**
 * Ordem: botão/input que carrega name=executar (inclui executar=1 no GET),
 * depois type=submit do form de datas. Evitar button.btn genérico cedo —
 * em Emitidas pode haver outro botão .btn que não submete a pesquisa.
 */
export const SELETORES_BOTAO_FILTRAR_PORTAL = [
  '#searchbar button[name="executar"]',
  '#searchbar input[name="executar"]',
  'form:has(#datainicio) button[name="executar"]',
  'form:has(#datainicio) input[name="executar"]',
  'button[name="executar"][value="1"]',
  'input[type="submit"][name="executar"]',
  '#searchbar button[type="submit"]',
  '#searchbar form button[type="submit"]',
  'form:has(#datainicio) button[type="submit"]',
  '#searchbar button.btn-primary',
  'form:has(#datainicio) button.btn-primary',
  'button:has-text("Pesquisar")',
  'button:has-text("Filtrar")',
  // Últimos recursos (DOM frágil / legado)
  '#searchbar button.btn',
  'xpath=//*[@id="searchbar"]/form/div[2]/div[2]/div[2]/button',
] as const;

export const SELETOR_FORM_FILTRO_PORTAL = [
  '#searchbar form',
  'form:has(#datainicio)',
  'form:has(#datafim)',
] as const;

export type EtapaDescobertaPortal =
  | 'abrir_menu'
  | 'aplicar_filtro'
  | 'confirmar_filtro'
  | 'capturar_pagina'
  | 'paginar'
  | 'extrair_linha';

/** Remove query string sensível demais; mantém path + parâmetros de filtro (datas públicas). */
export function urlDiagnosticoPortal(url: string): string {
  try {
    const u = new URL(url);
    const params = new URLSearchParams();
    for (const chave of ['executar', 'datainicio', 'datafim']) {
      const v = u.searchParams.get(chave);
      if (v) params.set(chave, v);
    }
    const q = params.toString();
    return q ? `${u.pathname}?${q}` : u.pathname;
  } catch {
    return String(url ?? '').slice(0, 200);
  }
}
