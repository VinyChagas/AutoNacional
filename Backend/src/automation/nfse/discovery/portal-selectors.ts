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

/** Base do Portal Nacional (Emissor). Rota de Notas reaproveita a sessão vigente. */
export const BASE_PORTAL_EMISSOR = 'https://www.nfse.gov.br/EmissorNacional';

/** URL absoluta da listagem da direção (sem query) para recuperação de rota. */
export function urlNotasPortal(direcao: DirecaoDocumentoFiscal): string {
  return `${BASE_PORTAL_EMISSOR}/Notas/${DIRECAO_PARA_TIPO_NOTA_UI[direcao]}`;
}

/**
 * Portal v1.6 — item "Consultas" na navbar.
 * O dropdown abre principalmente por CSS :hover no <li> (passar o mouse);
 * clique no <img> é interceptado pelo <li> da navbarMini.
 *
 * Preferir hover no <li>; clique no <a> só como fallback.
 */
export const SELETORES_HOVER_CONSULTAS_NFSE = [
  '#navbar > ul > li:nth-child(3)',
  'xpath=//*[@id="navbar"]/ul/li[3]',
  '#navbar ul > li:nth-child(3)',
] as const;

export const SELETORES_TOGGLE_CONSULTAS_NFSE = [
  ...SELETORES_HOVER_CONSULTAS_NFSE,
  '#navbar > ul > li:nth-child(3) > a',
  'xpath=//*[@id="navbar"]/ul/li[3]/a',
  '#navbar ul li:nth-child(3) > a',
  '#navbar ul li.open > a',
  // img por último — interceptado pelo <li>
  'xpath=//*[@id="navbar"]/ul/li[3]/a/div/img',
  '#navbar > ul > li:nth-child(3) > a > div > img',
] as const;

/** Texto visível do temporizador de sessão (Portal v1.6) — só referência/detecção. */
export const TEXTO_TEMPO_RESTANTE_SESSAO = 'Tempo restante da sessão';

/**
 * Submenus após abrir Consultas (Portal v1.6).
 * Gravado: Emitidas = li[3]/ul/li[2]/a → /Notas/Emitidas
 *          Recebidas = li[3]/ul/li[3]/a → /Notas/Recebidas
 * Ordem do dropdown: [Consultas (rótulo)] [NFS-e Emitidas] [NFS-e Recebidas] [Rascunhos]
 */
export function seletoresSubmenuNotas(direcao: DirecaoDocumentoFiscal): string[] {
  const tipo = DIRECAO_PARA_TIPO_NOTA_UI[direcao];
  const rotulo = `NFS-e ${tipo}`;
  const caminho = `/Notas/${tipo}`;
  const porIndice =
    direcao === 'EMITIDA'
      ? [
          'li.open li:nth-of-type(2) > a',
          '#navbar > ul > li:nth-child(3) > ul > li:nth-child(2) > a',
          'xpath=//*[@id="navbar"]/ul/li[3]/ul/li[2]/a',
        ]
      : [
          'li.open > ul > li:nth-of-type(3) > a',
          '#navbar > ul > li:nth-child(3) > ul > li:nth-child(3) > a',
          'xpath=//*[@id="navbar"]/ul/li[3]/ul/li[3]/a',
        ];
  return [
    // Semânticos (Chrome Recorder: aria/text)
    `a[aria-label="${rotulo}"]`,
    `#navbar a:has-text("${rotulo}")`,
    `li.open a:has-text("${rotulo}")`,
    `text=${rotulo}`,
    // Estrutura gravada + href
    `#navbar > ul > li:nth-child(3) > ul a[href*="${caminho}"]`,
    ...porIndice,
    `#navbar a[href*="${caminho}"]`,
    `a[href*="${caminho}"]`,
  ];
}

/** @deprecated Preferir abrirConsultasNfseEAguardar — alias dos submenus v1.6. */
export function seletoresMenuNotas(direcao: DirecaoDocumentoFiscal): string[] {
  return seletoresSubmenuNotas(direcao);
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
