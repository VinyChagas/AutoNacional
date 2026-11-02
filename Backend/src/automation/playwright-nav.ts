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
import {
  BASE_PORTAL_EMISSOR,
  SELETORES_HOVER_CONSULTAS_NFSE,
  SELETORES_TOGGLE_CONSULTAS_NFSE,
  seletoresSubmenuNotas,
} from './nfse/discovery/portal-selectors';
import type { DirecaoDocumentoFiscal } from './nfse/contracts/documento-fiscal';

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
 * Clique resiliente na navbar do Portal v1.6.
 * O <img> do menu é interceptado pelo <li> da navbarMini
 * ("subtree intercepts pointer events") — retenta com force e, se preciso, JS click.
 */
export async function clicarNavbarResiliente(
  locator: Locator,
  options: { timeout?: number; log?: (msg: string) => void } = {}
): Promise<void> {
  const timeout = options.timeout ?? Math.min(15000, PLAYWRIGHT_TIMEOUT);
  const log = options.log ?? (() => undefined);
  try {
    await locator.click({ timeout });
    return;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const intercepta =
      /intercepts pointer events/i.test(msg) ||
      /Timeout .* exceeded/i.test(msg);
    if (!intercepta) throw err;
    log('Clique interceptado na navbar — retentando com force…');
  }
  try {
    await locator.click({ timeout, force: true });
    return;
  } catch (err) {
    log(
      `Force click falhou (${err instanceof Error ? err.message.slice(0, 80) : String(err)}) — JS click`
    );
  }
  await locator.evaluate((el: HTMLElement) => {
    el.click();
  });
}

/**
 * Aguarda o submenu aparecer (curto). Retorna o locator ou null.
 */
async function aguardarSubmenuBreve(
  tentar: () => Promise<Locator | null>,
  page: Page,
  maxMs: number
): Promise<Locator | null> {
  const inicio = agoraMonotonicoMs();
  for (;;) {
    assertPageUsable(page);
    const submenu = await tentar();
    if (submenu) return submenu;
    if (deltaMonotonicoMs(inicio, agoraMonotonicoMs()) >= maxMs) return null;
    await page.waitForTimeout(80);
  }
}

/**
 * Portal v1.6 — abre o dropdown "Consultas" (hover CSS) e retorna o submenu
 * Emitidas/Recebidas já visível. Não navega; só prepara o alvo do clique.
 *
 * No portal o menu abre ao passar o mouse no <li>; clique sozinho muitas vezes
 * não revela a lista (e o <img> ainda é interceptado pelo <li>).
 */
export async function localizarSubmenuConsultasNfse(
  page: Page,
  tipo: 'Emitidas' | 'Recebidas',
  options: { timeout?: number; log?: (msg: string) => void } = {}
): Promise<Locator> {
  const timeout = options.timeout ?? PLAYWRIGHT_TIMEOUT;
  const log = options.log ?? (() => undefined);
  const direcao: DirecaoDocumentoFiscal =
    tipo === 'Emitidas' ? 'EMITIDA' : 'RECEBIDA';
  const clickTimeout = Math.min(15000, timeout);
  const esperaAposAbertura = Math.min(3000, timeout);

  const tentarSubmenuVisivel = async (): Promise<Locator | null> => {
    if (typeof page.getByRole === 'function') {
      const porRole = page.getByRole('link', { name: `NFS-e ${tipo}` });
      if ((await porRole.count().catch(() => 0)) > 0) {
        const primeiro = porRole.first();
        if (await primeiro.isVisible().catch(() => false)) return primeiro;
      }
    }
    for (const seletor of seletoresSubmenuNotas(direcao)) {
      const loc = page.locator(seletor).first();
      const n = await loc.count().catch(() => 0);
      if (n === 0) continue;
      const visivel = await loc.isVisible().catch(() => false);
      if (visivel) return loc;
    }
    return null;
  };

  const jaAberto = await tentarSubmenuVisivel();
  if (jaAberto) return jaAberto;

  let ultimoErro: unknown;

  // 1) Hover no <li> — comportamento real do Portal v1.6 (CSS :hover)
  for (const seletor of SELETORES_HOVER_CONSULTAS_NFSE) {
    const alvo = page.locator(seletor).first();
    if ((await alvo.count().catch(() => 0)) === 0) continue;
    if (!(await alvo.isVisible().catch(() => false))) continue;
    log(`Abrindo Consultas NFS-e por hover (${seletor})…`);
    try {
      await alvo.hover({ timeout: clickTimeout });
      const submenu = await aguardarSubmenuBreve(
        tentarSubmenuVisivel,
        page,
        esperaAposAbertura
      );
      if (submenu) {
        log(`Submenu NFS-e ${tipo} disponível após hover`);
        return submenu;
      }
      // Reforço: mouseenter + classe open (Bootstrap)
      await alvo
        .evaluate((el: HTMLElement) => {
          el.dispatchEvent(
            new MouseEvent('mouseenter', { bubbles: true, cancelable: true })
          );
          el.dispatchEvent(
            new MouseEvent('mouseover', { bubbles: true, cancelable: true })
          );
          el.classList.add('open', 'show');
          const link = el.querySelector('a');
          link?.classList.add('open', 'show');
          const menu = el.querySelector('ul');
          if (menu instanceof HTMLElement) {
            menu.style.display = 'block';
            menu.classList.add('show', 'in');
          }
        })
        .catch(() => undefined);
      const submenuJs = await aguardarSubmenuBreve(
        tentarSubmenuVisivel,
        page,
        esperaAposAbertura
      );
      if (submenuJs) {
        log(`Submenu NFS-e ${tipo} disponível após mouseenter/open`);
        return submenuJs;
      }
    } catch (err) {
      ultimoErro = err;
      log(
        `Hover falhou (${seletor}): ${
          err instanceof Error ? err.message.slice(0, 120) : String(err)
        }`
      );
    }
  }

  // 2) Fallback: clique no <a>/li (Recorder)
  for (const seletor of SELETORES_TOGGLE_CONSULTAS_NFSE) {
    const toggle = page.locator(seletor).first();
    if ((await toggle.count().catch(() => 0)) === 0) continue;
    if (!(await toggle.isVisible().catch(() => false))) continue;
    log(`Abrindo Consultas NFS-e por clique (${seletor})…`);
    try {
      await clicarNavbarResiliente(toggle, { timeout: clickTimeout, log });
      const submenu = await aguardarSubmenuBreve(
        tentarSubmenuVisivel,
        page,
        esperaAposAbertura
      );
      if (submenu) {
        log(`Submenu NFS-e ${tipo} disponível após clique`);
        return submenu;
      }
    } catch (err) {
      ultimoErro = err;
      log(
        `Clique falhou (${seletor}): ${
          err instanceof Error ? err.message.slice(0, 120) : String(err)
        }`
      );
    }
  }

  throw new Error(
    `Botão Consultas NFS-e (navbar) não abriu o submenu ${tipo}. ${
      ultimoErro instanceof Error ? ultimoErro.message : ''
    }`.trim()
  );
}

/**
 * Portal v1.6 — abre Emitidas/Recebidas por URL direta (estratégia principal).
 * Evita o dropdown da navbar (hover/CSS frágil no Playwright).
 *
 * Ex.: /EmissorNacional/ → /EmissorNacional/Notas/Emitidas
 *      /EmissorNacional/ → /EmissorNacional/Notas/Recebidas
 */
export async function navegarNotasPorUrl(
  page: Page,
  tipo: 'Emitidas' | 'Recebidas',
  options: { timeout?: number; log?: (msg: string) => void } = {}
): Promise<void> {
  const timeout = options.timeout ?? PLAYWRIGHT_TIMEOUT;
  const log = options.log ?? (() => undefined);
  const destino = `${BASE_PORTAL_EMISSOR}/Notas/${tipo}`;
  const urlSubstring = `/Notas/${tipo}`;
  const tipoOposto = tipo === 'Emitidas' ? 'Recebidas' : 'Emitidas';
  const urlSubstringsProibidas = [`/Notas/${tipoOposto}`];

  assertPageUsable(page);
  // Já na rota correta com formulário: não re-navega.
  if (
    page.url().includes(urlSubstring) &&
    (await page.locator('#datainicio').count().catch(() => 0)) > 0
  ) {
    log(`Já em Notas ${tipo}: ${page.url()}`);
    return;
  }

  const inicio = agoraMonotonicoMs();
  log(`Navegando para Notas ${tipo} via URL: ${destino}`);
  await gotoWithRetry(page, destino, {
    timeout,
    waitUntil: 'domcontentloaded',
    retries: 3,
    log,
  });

  const r = await aguardarRotaOuSeletor(page, {
    urlSubstring,
    readySelector: '#datainicio',
    timeout,
    urlSubstringsProibidas,
  });
  loggerTempos.info(
    {
      op: 'abrir_menu',
      tipo,
      via: 'url',
      esperaMs: r.ms,
      gotoMs: deltaMonotonicoMs(inicio, agoraMonotonicoMs()),
      rotaOk: r.rotaOk,
      seletorOk: r.seletorOk,
      timedOut: r.timedOut,
    },
    'Tempo: navegação direta Notas por URL'
  );

  if (!r.rotaOk && !r.seletorOk) {
    throw new Error(
      `Navegação por URL para Notas ${tipo} não confirmada (${destino}). URL atual: ${page.url()}`
    );
  }
  log(`Tela de Notas ${tipo} pronta via URL: ${page.url()}`);
}

/**
 * Abre listagem Emitidas/Recebidas.
 * Estratégia v1.6: URL direta. Menu/hover só como último recurso.
 */
export async function abrirConsultasNfseEAguardar(
  page: Page,
  tipo: 'Emitidas' | 'Recebidas',
  options: { timeout?: number; log?: (msg: string) => void } = {}
): Promise<void> {
  const log = options.log ?? (() => undefined);
  try {
    await navegarNotasPorUrl(page, tipo, options);
    return;
  } catch (errUrl) {
    log(
      `URL direta falhou (${
        errUrl instanceof Error ? errUrl.message.slice(0, 120) : String(errUrl)
      }) — tentando menu navbar`
    );
  }
  const submenu = await localizarSubmenuConsultasNfse(page, tipo, options);
  await clicarMenuNotasEAguardar(page, submenu, tipo, options);
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
    await clicarNavbarResiliente(menu, {
      timeout: Math.min(15000, timeout),
      log,
    });
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
