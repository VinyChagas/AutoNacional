/**
 * Automação do portal NFSe Nacional usando Playwright com certificado A1.
 *
 * Implementa autenticação via certificado digital A1 (.pfx) diretamente
 * no navegador Chromium controlado pelo Playwright, sem exibir popups de seleção.
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { getPlaywrightConfig } from './playwright-config';
import { getLogger } from '../infrastructure/logger';

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
  viewport?: { width: number; height: number };
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

  logger.info('Iniciando Chromium...');
  const browser = await chromium.launch({
    headless,
    args: config.args,
  });

  logger.info('Configurando certificado cliente no contexto...');
  const context = await browser.newContext({
    ignoreHTTPSErrors: ignoreHttpsErrors,
    viewport,
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    acceptDownloads: true,
    clientCertificates: [
      {
        origin: 'https://www.nfse.gov.br',
        pfx: certificado.pfx,
        passphrase: certificado.passphrase,
      },
    ],
  });

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
  } = {}
): Promise<ResultadoAutenticacao> {
  const config = getPlaywrightConfig();
  const timeout = opcoes.timeout ?? config.timeout;
  const logs: string[] = [];

  const log = (msg: string) => {
    logger.info(msg);
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
    });

    browser = resultado.browser;
    context = resultado.context;
    log('Contexto criado com sucesso');

    page = await context.newPage();
    log('Página criada');

    log(`Acessando portal NFSe Nacional: ${BASE_URL}`);
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout });
    log(`Página carregada: ${page.url()}`);

    await page.waitForTimeout(500);

    const currentUrl = page.url();
    const pageTitle = await page.title();
    log(`URL atual: ${currentUrl}`);
    log(`Título da página: ${pageTitle}`);

    const loginSelectors = [
      'button:has-text("Certificado")',
      'a:has-text("Certificado")',
      '#btnCertificado',
      '.btn-certificado',
    ];

    const dashboardSelectors = [
      'text=Dashboard',
      'text=Painel',
      '[href*="Dashboard"]',
      '.dashboard',
      '#dashboard',
    ];

    let loginElement = page.locator('body'); // placeholder, será substituído
    let loginFound = false;
    for (const selector of loginSelectors) {
      try {
        const locator = page.locator(selector);
        if ((await locator.count()) > 0) {
          log(`Elemento de login encontrado: ${selector}`);
          loginElement = locator.nth(0);
          loginFound = true;
          break;
        }
      } catch {
        continue;
      }
    }

    let dashboardElement = page.locator('body'); // placeholder
    let dashboardFound = false;
    for (const selector of dashboardSelectors) {
      try {
        const locator = page.locator(selector);
        if ((await locator.count()) > 0) {
          log(`Elemento de dashboard encontrado: ${selector}`);
          dashboardElement = locator.nth(0);
          dashboardFound = true;
          break;
        }
      } catch {
        continue;
      }
    }

    if (loginFound && !dashboardFound) {
      log('Elemento de login encontrado - tentando autenticar...');
      try {
        await loginElement.click({ timeout: 5000 });
        log('Clique no botão de certificado realizado');

        try {
          await page.waitForLoadState('domcontentloaded', { timeout: 10000 });
          await page.waitForTimeout(500);
          await page.waitForSelector('text=Dashboard', { timeout: 5000, state: 'visible' });
          log('Dashboard detectado após autenticação!');
        } catch {
          try {
            await page.waitForLoadState('load', { timeout: 5000 });
            log('Página carregada completamente');
          } catch {
            /* ignore */
          }
        }
      } catch (e) {
        log(`Erro ao clicar no botão de certificado: ${e}`);
      }
    } else if (dashboardFound) {
      log('Já autenticado - dashboard detectado diretamente!');
    } else {
      log('Não foi possível detectar elementos de login ou dashboard');
    }

    const finalUrl = page.url();
    const finalTitle = await page.title();
    log(`URL final: ${finalUrl}`);
    log(`Título final: ${finalTitle}`);

    const sucesso =
      finalUrl.includes('Dashboard') ||
      !finalUrl.includes('Login') ||
      dashboardFound;

    const mensagem = sucesso ? 'Dashboard acessado com sucesso' : 'Não foi possível confirmar acesso ao dashboard';
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
