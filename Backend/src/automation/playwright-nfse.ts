/**
 * Automação do portal NFSe Nacional usando Playwright com certificado A1.
 *
 * Implementa autenticação via certificado digital A1 (.pfx) diretamente
 * no navegador Chromium controlado pelo Playwright, sem exibir popups de seleção.
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright';
import {
  getPlaywrightConfig,
  aplicarZoomPaginaNoContexto,
} from './playwright-config';
import {
  assertPageUsable,
  gotoWithRetry,
  isTargetClosedError,
  safePageTitle,
} from './playwright-nav';
import { getLogger } from '../infrastructure/logger';
import { PLAYWRIGHT_TIMEOUT } from '../infrastructure/config';

const logger = getLogger('playwright-nfse');

const BASE_URL = 'https://www.nfse.gov.br/EmissorNacional/';

export class NFSeAutenticacaoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NFSeAutenticacaoError';
  }
}

export interface CertificadoEmMemoria {
  /** Conteúdo do arquivo PFX em Buffer */
  pfx: Buffer;
  /** Senha do certificado */
  passphrase: string;
}

export interface ResultadoAutenticacao {
  sucesso: boolean;
  url_atual: string;
  titulo: string;
  mensagem: string;
  logs: string[];
  page?: Page;
  context?: BrowserContext;
  browser?: Browser;
}

export interface OpcoesContexto {
  headless?: boolean;
  ignoreHttpsErrors?: boolean;
  /** Viewport da página (tamanho do conteúdo — NÃO a resolução do monitor). */
  viewport?: { width: number; height: number };
  /** Args extras do Chromium (ex.: --window-size / --window-position do slot). */
  launchArgs?: string[];
  /** Chamado quando a tela de login está pronta (após page.goto, antes do clique) */
  onLoginPageReady?: () => void;
}

/**
 * Cria um contexto do navegador Chromium configurado para usar certificado A1.
 *
 * Aceita certificado via parâmetro (para testes) ou via loader (CertificateService).
 */
export async function criarContextoComCertificado(
  certificado: CertificadoEmMemoria,
  opcoes: OpcoesContexto = {}
): Promise<{ browser: Browser; context: BrowserContext }> {
  const config = getPlaywrightConfig();

  const headless = opcoes.headless ?? config.headless;
  const ignoreHttpsErrors = opcoes.ignoreHttpsErrors ?? true;
  const viewport = opcoes.viewport ?? config.viewport;
  const launchArgs = [...config.args, ...(opcoes.launchArgs ?? [])];

  logger.debug(
    {
      headless,
      viewport,
      windowArgs: opcoes.launchArgs,
    },
    'Iniciando Chromium…'
  );
  const browser = await chromium.launch({
    headless,
    args: launchArgs,
  });

  logger.debug('Configurando certificado cliente no contexto...');
  const context = await browser.newContext({
    ignoreHTTPSErrors: ignoreHttpsErrors,
    viewport,
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    acceptDownloads: true,
    // O login por certificado faz o handshake mTLS em certificado.nfse.gov.br,
    // que é um subdomínio diferente de www.nfse.gov.br. É preciso registrar o
    // certificado para AMBAS as origins, senão o IIS retorna 403 Forbidden ao
    // navegar para o domínio de autenticação.
    clientCertificates: [
      {
        origin: 'https://www.nfse.gov.br',
        pfx: certificado.pfx,
        passphrase: certificado.passphrase,
      },
      {
        origin: 'https://certificado.nfse.gov.br',
        pfx: certificado.pfx,
        passphrase: certificado.passphrase,
      },
    ],
  });

  await aplicarZoomPaginaNoContexto(context);

  return { browser, context };
}

/**
 * Abre o dashboard do portal NFSe Nacional autenticado com certificado A1.
 *
 * @param certificado - Certificado PFX e senha (pode vir do CertificateService)
 * @param opcoes - headless, timeout, viewport
 */
export async function abrirDashboardNfse(
  certificado: CertificadoEmMemoria,
  opcoes: {
    headless?: boolean;
    timeout?: number;
    viewport?: { width: number; height: number };
    launchArgs?: string[];
    onLoginPageReady?: () => void;
  } = {}
): Promise<ResultadoAutenticacao> {
  const config = getPlaywrightConfig();
  const timeout = opcoes.timeout ?? config.timeout;
  const logs: string[] = [];

  const log = (msg: string) => {
    logger.debug(msg);
    logs.push(msg);
  };

  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  try {
    log('Iniciando automação NFSe...');
    log('Criando contexto do navegador com certificado A1...');

    const resultado = await criarContextoComCertificado(certificado, {
      headless: opcoes.headless ?? config.headless,
      ignoreHttpsErrors: true,
      viewport: opcoes.viewport ?? config.viewport,
      launchArgs: opcoes.launchArgs,
    });

    browser = resultado.browser;
    context = resultado.context;
    log('Contexto criado com sucesso');

    page = await context.newPage();
    page.setDefaultTimeout(timeout);
    log('Página criada');

    const navTimeout = PLAYWRIGHT_TIMEOUT;
    log(`Acessando portal NFSe Nacional: ${BASE_URL}`);
    await gotoWithRetry(page, BASE_URL, {
      timeout: navTimeout,
      waitUntil: 'domcontentloaded',
      log,
    });
    assertPageUsable(page);
    log(`Página carregada: ${page.url()}`);

    const loginSelectors = [
      'button:has-text("Certificado")',
      'a:has-text("Certificado")',
      '#btnCertificado',
      '.btn-certificado',
    ];

    // Sinais de sessão já autenticada (Dashboard, Meus dados, menus de notas…)
    const autenticadoSelectors = [
      'text=Dashboard',
      'text=Painel',
      'text=Meus dados',
      '[href*="Dashboard"]',
      '[href*="MeusDados"]',
      '[href*="Meus-Dados"]',
      '.dashboard',
      '#dashboard',
      'li:nth-of-type(3) img',
      '#datainicio',
    ];

    // Aguarda renderização (viewport compacto / vários browsers em paralelo)
    try {
      await Promise.race([
        page.waitForSelector(loginSelectors.join(', '), {
          timeout: Math.min(15000, navTimeout),
          state: 'visible',
        }),
        page.waitForSelector(autenticadoSelectors.join(', '), {
          timeout: Math.min(15000, navTimeout),
          state: 'visible',
        }),
      ]);
    } catch {
      if (!page.isClosed()) {
        await page.waitForTimeout(1000).catch(() => undefined);
      }
    }

    assertPageUsable(page);
    const currentUrl = page.url();
    const pageTitle = await safePageTitle(page);
    log(`URL atual: ${currentUrl}`);
    log(`Título da página: ${pageTitle}`);

    let loginElement = page.locator('body'); // placeholder, será substituído
    let loginFound = false;
    for (const selector of loginSelectors) {
      try {
        assertPageUsable(page);
        const locator = page.locator(selector);
        if ((await locator.count()) > 0 && (await locator.first().isVisible().catch(() => false))) {
          log(`Elemento de login encontrado: ${selector}`);
          loginElement = locator.nth(0);
          loginFound = true;
          break;
        }
      } catch (e) {
        if (isTargetClosedError(e)) throw e;
        continue;
      }
    }

    let autenticadoFound = false;
    for (const selector of autenticadoSelectors) {
      try {
        assertPageUsable(page);
        const locator = page.locator(selector);
        if ((await locator.count()) > 0 && (await locator.first().isVisible().catch(() => false))) {
          log(`Sessão autenticada detectada: ${selector}`);
          autenticadoFound = true;
          break;
        }
      } catch (e) {
        if (isTargetClosedError(e)) throw e;
        continue;
      }
    }

    // Fallback: botão pode estar fora da área visível na janela compacta
    if (!loginFound && !autenticadoFound) {
      assertPageUsable(page);
      await page.evaluate('window.scrollTo(0, 0)').catch(() => undefined);
      for (const selector of loginSelectors) {
        try {
          assertPageUsable(page);
          const locator = page.locator(selector);
          if ((await locator.count()) > 0) {
            await locator.first().scrollIntoViewIfNeeded().catch(() => undefined);
            if (await locator.first().isVisible().catch(() => false)) {
              loginElement = locator.nth(0);
              loginFound = true;
              log(`Elemento de login encontrado após scroll: ${selector}`);
              break;
            }
          }
        } catch (e) {
          if (isTargetClosedError(e)) throw e;
          continue;
        }
      }
    }

    if (loginFound && !autenticadoFound) {
      assertPageUsable(page);
      opcoes.onLoginPageReady?.();
      log('Elemento de login encontrado - tentando autenticar...');
      try {
        await loginElement.click({ timeout: 5000 });
        log('Clique no botão de certificado realizado');

        try {
          await Promise.race([
            page.waitForURL(
              /Dashboard|dashboard|MeusDados|Meus-Dados|EmissorNacional\/(?!Login)/i,
              { timeout: navTimeout }
            ),
            page.waitForSelector(autenticadoSelectors.join(', '), {
              timeout: navTimeout,
              state: 'visible',
            }),
          ]);
          log('Sessão autenticada detectada após clique no certificado');
          autenticadoFound = true;
        } catch {
          try {
            await page.waitForLoadState('domcontentloaded', { timeout: 10000 });
            log('Página carregada após clique no certificado');
          } catch {
            /* ignore */
          }
        }
      } catch (e) {
        log(`Erro ao clicar no botão de certificado: ${e}`);
      }
    } else if (autenticadoFound) {
      log('Já autenticado — área logada detectada diretamente!');
    } else {
      log('Não foi possível detectar elementos de login ou área autenticada');
    }

    assertPageUsable(page);
    const finalUrl = page.url();
    const finalTitle = await safePageTitle(page);
    log(`URL final: ${finalUrl}`);
    log(`Título final: ${finalTitle}`);

    // Reavalia sinais na página final (ex.: caiu em "Meus dados")
    if (!autenticadoFound) {
      for (const selector of autenticadoSelectors) {
        try {
          const locator = page.locator(selector);
          if (
            (await locator.count()) > 0 &&
            (await locator.first().isVisible().catch(() => false))
          ) {
            autenticadoFound = true;
            log(`Sessão autenticada confirmada na página final: ${selector}`);
            break;
          }
        } catch (e) {
          if (isTargetClosedError(e)) throw e;
        }
      }
    }

    const bodyText = await page
      .locator('body')
      .innerText()
      .catch(() => '');
    const textoIndicaAutenticado =
      /meus\s+dados/i.test(bodyText) ||
      /dashboard/i.test(bodyText) ||
      /notas\s+emitidas/i.test(bodyText) ||
      /notas\s+recebidas/i.test(bodyText);

    const urlLower = finalUrl.toLowerCase();
    const urlIndicaAutenticado =
      urlLower.includes('dashboard') ||
      urlLower.includes('meusdados') ||
      urlLower.includes('meus-dados') ||
      urlLower.includes('meus_dados') ||
      (!urlLower.includes('login') && urlLower.includes('emisornacional'));

    const sucesso =
      autenticadoFound || textoIndicaAutenticado || urlIndicaAutenticado;

    const mensagem = sucesso
      ? 'Dashboard acessado com sucesso'
      : 'Não foi possível confirmar acesso ao dashboard';
    if (sucesso) {
      log('Autenticação bem-sucedida!');
    } else {
      log('Possível falha na autenticação');
    }

    return {
      sucesso,
      url_atual: finalUrl,
      titulo: finalTitle,
      mensagem,
      logs,
      page,
      context,
      browser,
    };
  } catch (e) {
    const err = e as Error;
    const errorMsg = `Erro durante automação NFSe: ${err.message}`;
    logger.error({ err }, errorMsg);
    logs.push(`ERRO: ${errorMsg}`);

    try {
      if (page) await page.close().catch(() => {});
      if (context) await context.close().catch(() => {});
      if (browser) await browser.close().catch(() => {});
      log('Recursos liberados após erro');
    } catch (cleanupErr) {
      logger.warn({ err: cleanupErr }, 'Erro ao limpar recursos');
    }

    throw new NFSeAutenticacaoError(errorMsg);
  }
}
