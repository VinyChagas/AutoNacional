/**
 * Helpers de navegação resiliente para automação Playwright (NFSe).
 *
 * - Retry de page.goto em falhas transitórias de rede
 * - Detecção de página/browser fechados para abort limpo
 * - Espera de menus/rotas sem depender de networkidle
 */
import type { Locator, Page, Response } from 'playwright';
import { PLAYWRIGHT_TIMEOUT } from '../infrastructure/config';
import { getLogger } from '../infrastructure/logger';
import {
  agoraMonotonicoMs,
  deltaMonotonicoMs,
} from './nfse/orchestration/metricas-operacionais';

const loggerTempos = getLogger('nfse-discovery-timing');

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
 * Espera documento parseado (domcontentloaded).
 * API-02W — sem networkidle (portais com analytics quase nunca ficam idle).
 * Listagens Portal usam condições verificáveis em portal-listagem-ready.
 */
export async function aguardarEstabilizarPagina(
  page: Page,
  timeout = Math.min(PLAYWRIGHT_TIMEOUT, 20000)
): Promise<void> {
  assertPageUsable(page);
  try {
    await page.waitForLoadState('domcontentloaded', { timeout });
  } catch {
    /* ignore — timeout máximo permanece como proteção */
  }
}

export interface ResultadoRotaOuSeletor {
  /** Como a espera terminou. */
  via: 'imediato' | 'rota' | 'seletor' | 'timeout';
  /** URL já contém a rota alvo. */
  rotaOk: boolean;
  /** Seletor de prontidão (#datainicio) presente no DOM. */
  seletorOk: boolean;
  /** Duração monotônica da espera (ms). */
  ms: number;
  /** Estourou o timeout máximo sem confirmar rota nem seletor. */
  timedOut: boolean;
}

/**
 * Aguarda a rota alvo OU o seletor de prontidão (#datainicio), o que vier primeiro.
 *
 * API-02Y — Causa raiz do timeout de ~60s/navegação:
 *   O modelo anterior corria `page.waitForURL(urlGlob)` contra
 *   `ready.waitFor({ state: 'visible' })`. Quando a navegação já havia ocorrido
 *   (ou a URL final trazia query string que o glob `** /Notas/Tipo` não casa) o
 *   `waitForURL` ficava aguardando a PRÓXIMA navegação — que nunca vinha — e o
 *   `state: 'visible'` podia não resolver para um input renderizado porém ainda
 *   sem layout. Resultado: a corrida só terminava no timeout máximo (60s) mesmo
 *   com a navegação bem-sucedida. Repetido por direção (navegação + retentativa)
 *   produzia os ~120s observados.
 *
 * Correção: resolver pela CONDIÇÃO REAL via polling curto — rota presente na URL
 * (substring, casa com query string) OU seletor de filtro anexado ao DOM —
 * retornando no instante em que qualquer uma é verdadeira. O timeout máximo
 * permanece como proteção apenas para falhas reais.
 *
 * API-02Z — a presença de #datainicio NÃO confirma prontidão quando a URL
 * pertence a uma direção incorreta (`urlSubstringsProibidas`). Isso evita falso
 * positivo: estar em /Notas/Emitidas (com #datainicio) não pode confirmar uma
 * navegação solicitada para /Notas/Recebidas e vice-versa.
 */
export async function aguardarRotaOuSeletor(
  page: Page,
  options: {
    urlSubstring: string;
    readySelector: string;
    timeout?: number;
    intervaloMs?: number;
    /** Substrings de rotas de outras direções que invalidam o seletor. */
    urlSubstringsProibidas?: string[];
  }
): Promise<ResultadoRotaOuSeletor> {
  const timeout = options.timeout ?? PLAYWRIGHT_TIMEOUT;
  const intervaloMs = options.intervaloMs ?? 100;
  const proibidas = options.urlSubstringsProibidas ?? [];
  assertPageUsable(page);

  const inicio = agoraMonotonicoMs();
  const ready = page.locator(options.readySelector).first();
  const naRota = () => page.url().includes(options.urlSubstring);
  const emRotaProibida = () => proibidas.some((s) => page.url().includes(s));
  const seletorPresente = async () => (await ready.count().catch(() => 0)) > 0;

  // Rota já correta e formulário presente: sucesso imediato, sem aguardar navegação.
  if (naRota() && (await seletorPresente())) {
    return {
      via: 'imediato',
      rotaOk: true,
      seletorOk: true,
      ms: deltaMonotonicoMs(inicio, agoraMonotonicoMs()),
      timedOut: false,
    };
  }

  // Poll por condição verificável: rota correta OU #datainicio no DOM —
  // mas o seletor só conta se a URL NÃO estiver em rota de direção incorreta.
  for (;;) {
    assertPageUsable(page);
    const rotaOk = naRota();
    const seletorOk = (await seletorPresente()) && !emRotaProibida();
    if (rotaOk || seletorOk) {
      return {
        via: rotaOk ? 'rota' : 'seletor',
        rotaOk,
        seletorOk,
        ms: deltaMonotonicoMs(inicio, agoraMonotonicoMs()),
        timedOut: false,
      };
    }
    if (deltaMonotonicoMs(inicio, agoraMonotonicoMs()) >= timeout) {
      return {
        via: 'timeout',
        rotaOk,
        seletorOk,
        ms: deltaMonotonicoMs(inicio, agoraMonotonicoMs()),
        timedOut: true,
      };
    }
    await page.waitForTimeout(intervaloMs);
  }
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
  const tipoOposto = tipo === 'Emitidas' ? 'Recebidas' : 'Emitidas';
  const urlSubstringsProibidas = [`/Notas/${tipoOposto}`];
  const readySelector = '#datainicio';
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    assertPageUsable(page);
    log(`Abrindo Notas ${tipo} (tentativa ${attempt}/${maxAttempts})…`);

    const inicioClick = agoraMonotonicoMs();
    await menu.click({ timeout: Math.min(15000, timeout) });
    const clickMs = deltaMonotonicoMs(inicioClick, agoraMonotonicoMs());

    try {
      const r = await aguardarRotaOuSeletor(page, {
        urlSubstring,
        readySelector,
        timeout,
        urlSubstringsProibidas,
      });
      loggerTempos.info(
        {
          op: 'abrir_menu',
          tipo,
          tentativa: attempt,
          clickMs,
          esperaMs: r.ms,
          via: r.via,
          rotaOk: r.rotaOk,
          seletorOk: r.seletorOk,
          timedOut: r.timedOut,
        },
        'Tempo: clique no menu + confirmação de rota'
      );
      if (r.rotaOk || r.seletorOk) {
        log(`Tela de Notas ${tipo} pronta: ${page.url()}`);
        return;
      }
      // Timeout real (nem rota nem seletor): retenta ou falha.
      if (attempt === maxAttempts) {
        throw new Error(
          `Navegação para Notas ${tipo} não confirmada após ${r.ms}ms (via=${r.via}).`
        );
      }
      log(`Navegação para Notas ${tipo} incompleta — retentando clique`);
      await new Promise((rr) => setTimeout(rr, 1500));
    } catch (err) {
      if (isTargetClosedError(err) || attempt === maxAttempts) {
        throw err;
      }
      const msg = err instanceof Error ? err.message : String(err);
      log(
        `Navegação para Notas ${tipo} incompleta (${msg.slice(0, 100)}) — retentando clique`
      );
      await new Promise((rr) => setTimeout(rr, 1500));
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
