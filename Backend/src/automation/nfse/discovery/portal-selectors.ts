/**
 * Seletores do Portal Nacional para listagem Emitidas/Recebidas.
 * Preferir href/role estáveis; nth-of-type é fallback frágil.
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

/** Botão Pesquisar/Filtrar da barra de datas — XPath absoluto é frágil entre Emitidas/Recebidas. */
export const SELETORES_BOTAO_FILTRAR_PORTAL = [
  '#searchbar button[type="submit"]',
  '#searchbar form button[type="submit"]',
  '#searchbar button.btn-primary',
  '#searchbar button.btn',
  'form:has(#datainicio) button[type="submit"]',
  'form:has(#datainicio) button.btn-primary',
  'button:has-text("Pesquisar")',
  'button:has-text("Filtrar")',
  // Último recurso: XPath histórico (pode divergir no DOM de Emitidas)
  'xpath=//*[@id="searchbar"]/form/div[2]/div[2]/div[2]/button',
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
