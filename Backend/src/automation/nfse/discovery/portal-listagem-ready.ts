/**
 * API-02W — condições verificáveis da listagem Portal (sem networkidle).
 * Pronto = URL com executar=1 + período, e (linhas OU mensagem de vazio).
 */
import type { Page } from 'playwright';
import type { PeriodoConsultaPortal } from '../contracts/periodo';
import { urlConfirmaPesquisa } from './discovery-validation';
import { textoIndicaSemRegistros } from './pagination';

export const SELETOR_LINHAS_LISTAGEM_PORTAL = 'table tbody tr';

const TEXTO_LISTA_VAZIA =
  /nenhum registro encontrado|nenhuma nota encontrada|n[aã]o h[aá] registros/i;

export type ResultadoConteudoListagem = 'linhas' | 'vazio' | 'timeout';

/** True se a URL já comprova pesquisa aplicada (executar=1 + datas). */
export function pesquisaPortalConfirmadaNaUrl(
  url: string,
  periodo: PeriodoConsultaPortal
): boolean {
  return urlConfirmaPesquisa(url, periodo);
}

/**
 * Aguarda URL de pesquisa confirmada. Se já confirmada, retorna imediatamente.
 * Timeout máximo permanece como proteção — não reduz o limite de segurança.
 */
export async function aguardarPesquisaPortalNaUrl(
  page: Page,
  periodo: PeriodoConsultaPortal,
  timeoutMs: number
): Promise<boolean> {
  if (pesquisaPortalConfirmadaNaUrl(page.url(), periodo)) return true;
  try {
    await page.waitForURL((u) => urlConfirmaPesquisa(u.href, periodo), {
      timeout: timeoutMs,
    });
    return true;
  } catch {
    return pesquisaPortalConfirmadaNaUrl(page.url(), periodo);
  }
}

/**
 * Aguarda resultado da consulta: linhas na tabela OU mensagem de lista vazia.
 * Não usa networkidle. Não avança enquanto nenhum dos dois existir (até o timeout).
 */
export async function aguardarConteudoListagemPortal(
  page: Page,
  timeoutMs: number
): Promise<ResultadoConteudoListagem> {
  const linhas = page.locator(SELETOR_LINHAS_LISTAGEM_PORTAL);
  const vazia = page.getByText(TEXTO_LISTA_VAZIA).first();

  // Já pronto?
  const n0 = await linhas.count().catch(() => 0);
  if (n0 > 0) return 'linhas';
  const body0 = await page.locator('body').innerText().catch(() => '');
  if (textoIndicaSemRegistros(body0) || TEXTO_LISTA_VAZIA.test(body0)) return 'vazio';

  try {
    await Promise.race([
      linhas.first().waitFor({ state: 'attached', timeout: timeoutMs }),
      vazia.waitFor({ state: 'visible', timeout: timeoutMs }),
    ]);
  } catch {
    const n = await linhas.count().catch(() => 0);
    if (n > 0) return 'linhas';
    const body = await page.locator('body').innerText().catch(() => '');
    if (textoIndicaSemRegistros(body) || TEXTO_LISTA_VAZIA.test(body)) return 'vazio';
    return 'timeout';
  }

  const n = await linhas.count().catch(() => 0);
  if (n > 0) return 'linhas';
  const body = await page.locator('body').innerText().catch(() => '');
  if (textoIndicaSemRegistros(body) || TEXTO_LISTA_VAZIA.test(body) || n === 0) {
    return 'vazio';
  }
  return 'linhas';
}

/**
 * Após filtro: confirma URL e conteúdo. Evita estabilização repetida se já pronto.
 */
export async function aguardarListagemPortalPronta(
  page: Page,
  periodo: PeriodoConsultaPortal,
  timeoutMs: number
): Promise<{ urlOk: boolean; conteudo: ResultadoConteudoListagem }> {
  const urlOk = await aguardarPesquisaPortalNaUrl(page, periodo, timeoutMs);
  if (!urlOk) {
    return { urlOk: false, conteudo: 'timeout' };
  }
  const conteudo = await aguardarConteudoListagemPortal(page, timeoutMs);
  return { urlOk: true, conteudo };
}
