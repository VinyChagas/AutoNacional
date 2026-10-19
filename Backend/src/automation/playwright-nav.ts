/**
 * Helpers de navegação resiliente para automação Playwright (NFSe).
 *
 * - Retry de page.goto em falhas transitórias de rede
 * - Detecção de página/browser fechados para abort limpo
 * - Espera de menus/rotas sem depender de networkidle
 */
import type { Locator, Page, Response } from 'playwright';
import { PLAYWRIGHT_TIMEOUT } from '../infrastructure/config';

export class PageClosedError extends Error {
  constructor(
    message = 'Target page, context or browser has been closed'
  ) {
    super(message);
    this.name = 'PageClosedError';
  }
}

const RETRYABLE_NAVIGATION_PATTERNS = [
  /net::ERR_ABORTED/i,
  /net::ERR_TIMED_OUT/i,
  /net::ERR_CONNECTION_/i,
  /net::ERR_NAME_NOT_RESOLVED/i,
  /net::ERR_NETWORK_CHANGED/i,
  /net::ERR_INTERNET_DISCONNECTED/i,
  /Navigation interrupted/i,
  /Timeout\s*\d+ms\s*exceeded/i,
  /page\.goto:.*Timeout/i,
];

const TARGET_CLOSED_PATTERNS = [
  /Target page, context or browser has been closed/i,
  /Target closed/i,
  /browser has been closed/i,
  /browser has been disconnected/i,
  /Execution context was destroyed/i,
];

export function isTargetClosedError(error: unknown): boolean {
  if (error instanceof PageClosedError) return true;
  const msg = error instanceof Error ? error.message : String(error);
  return TARGET_CLOSED_PATTERNS.some((p) => p.test(msg));
}

export function isRetryableNavigationError(error: unknown): boolean {
  if (isTargetClosedError(error)) return false;
  const msg = error instanceof Error ? error.message : String(error);
  return RETRYABLE_NAVIGATION_PATTERNS.some((p) => p.test(msg));
}

/** Lança PageClosedError se a página ou o browser não estiverem utilizáveis. */
export function assertPageUsable(page: Page): void {
  if (page.isClosed()) {
    throw new PageClosedError();
  }
  const browser = page.context().browser();
  if (browser && !browser.isConnected()) {
    throw new PageClosedError('Browser has been disconnected');
  }
}

export async function safePageTitle(page: Page): Promise<string> {
  if (page.isClosed()) return '';
  return page.title().catch(() => '');
}

/**
 * Espera a página estabilizar sem falhar em networkidle
 * (portais com polling/analytics raramente ficam idle).
 */
export async function aguardarEstabilizarPagina(
  page: Page,
  timeout = Math.min(PLAYWRIGHT_TIMEOUT, 20000)
): Promise<void> {
  assertPageUsable(page);
  try {
    await page.waitForLoadState('domcontentloaded', { timeout });
  } catch {
    /* ignore */
  }
  try {
    await page.waitForLoadState('networkidle', {
      timeout: Math.min(5000, timeout),
    });
  } catch {
    /* best-effort — não falha a execução */
  }
}

/**
 * Aguarda URL alvo OU seletor de conteúdo pronto (o que vier primeiro).
 */
export async function aguardarRotaOuSeletor(
  page: Page,
  options: {
    urlGlob: string;
    urlSubstring: string;
    readySelector: string;
    timeout?: number;
  }
): Promise<void> {
  const timeout = options.timeout ?? PLAYWRIGHT_TIMEOUT;
  assertPageUsable(page);

  const jaNaRota = page.url().includes(options.urlSubstring);
  const ready = page.locator(options.readySelector).first();

  if (jaNaRota) {
    await ready
      .waitFor({ state: 'visible', timeout: Math.min(15000, timeout) })
      .catch(() => undefined);
    await aguardarEstabilizarPagina(page, Math.min(10000, timeout));
    return;
  }

  try {
    await Promise.race([
      page.waitForURL(options.urlGlob, { timeout }),
      ready.waitFor({ state: 'visible', timeout }),
    ]);
  } catch (err) {
    if (isTargetClosedError(err)) throw err;
    const urlOk = page.url().includes(options.urlSubstring);
    const selOk = await ready.isVisible().catch(() => false);
    if (!urlOk && !selOk) {
      throw err;
    }
  }

  await aguardarEstabilizarPagina(page, Math.min(10000, timeout));
}

/**
 * Clica no menu Emitidas/Recebidas e espera a tela de filtro (#datainicio).
 * Retenta o clique 1 vez se a navegação falhar sob carga.
 */
export async function clicarMenuNotasEAguardar(
  page: Page,
  menu: Locator,
  tipo: 'Emitidas' | 'Recebidas',
  options: { timeout?: number; log?: (msg: string) => void } = {}
): Promise<void> {
  const timeout = options.timeout ?? PLAYWRIGHT_TIMEOUT;
  const log = options.log ?? (() => undefined);
  const urlSubstring = `/Notas/${tipo}`;
  const urlGlob = `**/Notas/${tipo}`;
  const readySelector = '#datainicio';
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    assertPageUsable(page);
    log(`Abrindo Notas ${tipo} (tentativa ${attempt}/${maxAttempts})…`);
    await menu.click({ timeout: Math.min(15000, timeout) });
    try {
      await aguardarRotaOuSeletor(page, {
        urlGlob,
        urlSubstring,
        readySelector,
        timeout,
      });
      log(`Tela de Notas ${tipo} pronta: ${page.url()}`);
      return;
    } catch (err) {
      if (isTargetClosedError(err) || attempt === maxAttempts) {
        throw err;
      }
      const msg = err instanceof Error ? err.message : String(err);
      log(
        `Navegação para Notas ${tipo} incompleta (${msg.slice(0, 100)}) — retentando clique`
      );
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

export type GotoWithRetryOptions = {
  /** Timeout por tentativa (default: PLAYWRIGHT_TIMEOUT). */
  timeout?: number;
  /** Tentativas totais incluindo a primeira (default: 3). */
  retries?: number;
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
  /** Backoff base em ms; multiplica pelo número da tentativa. */
  backoffMs?: number;
  log?: (msg: string) => void;
};

/**
 * page.goto com retry para ERR_ABORTED / ERR_TIMED_OUT / timeouts de navegação.
 * Não retenta se a página/browser já foi fechado.
 */
export async function gotoWithRetry(
  page: Page,
  url: string,
  options: GotoWithRetryOptions = {}
): Promise<Response | null> {
  const timeout = options.timeout ?? PLAYWRIGHT_TIMEOUT;
  const retries = Math.max(1, options.retries ?? 3);
  const waitUntil = options.waitUntil ?? 'domcontentloaded';
  const backoffMs = options.backoffMs ?? 1500;
  const log = options.log ?? (() => undefined);

  let lastError: unknown;

  for (let attempt = 1; attempt <= retries; attempt++) {
    assertPageUsable(page);
    try {
      log(
        `Navegando para ${url} (tentativa ${attempt}/${retries}, timeout=${timeout}ms)`
      );
      return await page.goto(url, { waitUntil, timeout });
    } catch (err) {
      lastError = err;
      if (isTargetClosedError(err) || page.isClosed()) {
        throw err instanceof PageClosedError
          ? err
          : new PageClosedError(
              err instanceof Error ? err.message : String(err)
            );
      }
      if (!isRetryableNavigationError(err) || attempt === retries) {
        throw err;
      }
      const delay = backoffMs * attempt;
      const msg = err instanceof Error ? err.message : String(err);
      log(
        `Falha transitória no goto (${msg.slice(0, 120)}) — nova tentativa em ${delay}ms`
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError ?? 'gotoWithRetry falhou'));
}
