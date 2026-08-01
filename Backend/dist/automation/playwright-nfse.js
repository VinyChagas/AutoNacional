"use strict";
/**
 * Automação do portal NFSe Nacional usando Playwright com certificado A1.
 *
 * Implementa autenticação via certificado digital A1 (.pfx) diretamente
 * no navegador Chromium controlado pelo Playwright, sem exibir popups de seleção.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.NFSeAutenticacaoError = void 0;
exports.criarContextoComCertificado = criarContextoComCertificado;
exports.abrirDashboardNfse = abrirDashboardNfse;
const playwright_1 = require("playwright");
const playwright_config_1 = require("./playwright-config");
const logger_1 = require("../infrastructure/logger");
const logger = (0, logger_1.getLogger)('playwright-nfse');
const BASE_URL = 'https://www.nfse.gov.br/EmissorNacional/';
class NFSeAutenticacaoError extends Error {
    constructor(message) {
        super(message);
        this.name = 'NFSeAutenticacaoError';
    }
}
exports.NFSeAutenticacaoError = NFSeAutenticacaoError;
/**
 * Cria um contexto do navegador Chromium configurado para usar certificado A1.
 *
 * Aceita certificado via parâmetro (para testes) ou via loader (CertificateService).
 */
async function criarContextoComCertificado(certificado, opcoes = {}) {
    const config = (0, playwright_config_1.getPlaywrightConfig)();
    const headless = opcoes.headless ?? config.headless;
    const ignoreHttpsErrors = opcoes.ignoreHttpsErrors ?? true;
    const viewport = opcoes.viewport ?? config.viewport;
    const launchArgs = [...config.args, ...(opcoes.launchArgs ?? [])];
    logger.debug({
        headless,
        viewport,
        windowArgs: opcoes.launchArgs,
    }, 'Iniciando Chromium…');
    const browser = await playwright_1.chromium.launch({
        headless,
        args: launchArgs,
    });
    logger.debug('Configurando certificado cliente no contexto...');
    const context = await browser.newContext({
        ignoreHTTPSErrors: ignoreHttpsErrors,
        viewport,
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
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
    await (0, playwright_config_1.aplicarZoomPaginaNoContexto)(context);
    return { browser, context };
}
/**
 * Abre o dashboard do portal NFSe Nacional autenticado com certificado A1.
 *
 * @param certificado - Certificado PFX e senha (pode vir do CertificateService)
 * @param opcoes - headless, timeout, viewport
 */
async function abrirDashboardNfse(certificado, opcoes = {}) {
    const config = (0, playwright_config_1.getPlaywrightConfig)();
    const timeout = opcoes.timeout ?? config.timeout;
    const logs = [];
    const log = (msg) => {
        logger.debug(msg);
        logs.push(msg);
    };
    let browser;
    let context;
    let page;
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
        log('Página criada');
        log(`Acessando portal NFSe Nacional: ${BASE_URL}`);
        await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout });
        log(`Página carregada: ${page.url()}`);
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
        // Aguarda renderização (viewport compacto / vários browsers em paralelo)
        try {
            await Promise.race([
                page.waitForSelector(loginSelectors.join(', '), {
                    timeout: 15000,
                    state: 'visible',
                }),
                page.waitForSelector(dashboardSelectors.join(', '), {
                    timeout: 15000,
                    state: 'visible',
                }),
            ]);
        }
        catch {
            await page.waitForTimeout(1000);
        }
        const currentUrl = page.url();
        const pageTitle = await page.title();
        log(`URL atual: ${currentUrl}`);
        log(`Título da página: ${pageTitle}`);
        let loginElement = page.locator('body'); // placeholder, será substituído
        let loginFound = false;
        for (const selector of loginSelectors) {
            try {
                const locator = page.locator(selector);
                if ((await locator.count()) > 0 && (await locator.first().isVisible().catch(() => false))) {
                    log(`Elemento de login encontrado: ${selector}`);
                    loginElement = locator.nth(0);
                    loginFound = true;
                    break;
                }
            }
            catch {
                continue;
            }
        }
        let dashboardElement = page.locator('body'); // placeholder
        let dashboardFound = false;
        for (const selector of dashboardSelectors) {
            try {
                const locator = page.locator(selector);
                if ((await locator.count()) > 0 && (await locator.first().isVisible().catch(() => false))) {
                    log(`Elemento de dashboard encontrado: ${selector}`);
                    dashboardElement = locator.nth(0);
                    dashboardFound = true;
                    break;
                }
            }
            catch {
                continue;
            }
        }
        // Fallback: botão pode estar fora da área visível na janela compacta
        if (!loginFound && !dashboardFound) {
            await page.evaluate('window.scrollTo(0, 0)').catch(() => undefined);
            for (const selector of loginSelectors) {
                try {
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
                }
                catch {
                    continue;
                }
            }
        }
        if (loginFound && !dashboardFound) {
            opcoes.onLoginPageReady?.();
            log('Elemento de login encontrado - tentando autenticar...');
            try {
                await loginElement.click({ timeout: 5000 });
                log('Clique no botão de certificado realizado');
                try {
                    await page.waitForLoadState('domcontentloaded', { timeout: 10000 });
                    await page.waitForTimeout(500);
                    await page.waitForSelector('text=Dashboard', { timeout: 5000, state: 'visible' });
                    log('Dashboard detectado após autenticação!');
                }
                catch {
                    try {
                        await page.waitForLoadState('load', { timeout: 5000 });
                        log('Página carregada completamente');
                    }
                    catch {
                        /* ignore */
                    }
                }
            }
            catch (e) {
                log(`Erro ao clicar no botão de certificado: ${e}`);
            }
        }
        else if (dashboardFound) {
            log('Já autenticado - dashboard detectado diretamente!');
        }
        else {
            log('Não foi possível detectar elementos de login ou dashboard');
        }
        const finalUrl = page.url();
        const finalTitle = await page.title();
        log(`URL final: ${finalUrl}`);
        log(`Título final: ${finalTitle}`);
        const sucesso = finalUrl.includes('Dashboard') ||
            !finalUrl.includes('Login') ||
            dashboardFound;
        const mensagem = sucesso ? 'Dashboard acessado com sucesso' : 'Não foi possível confirmar acesso ao dashboard';
        if (sucesso) {
            log('Autenticação bem-sucedida!');
        }
        else {
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
    }
    catch (e) {
        const err = e;
        const errorMsg = `Erro durante automação NFSe: ${err.message}`;
        logger.error({ err }, errorMsg);
        logs.push(`ERRO: ${errorMsg}`);
        try {
            if (page)
                await page.close().catch(() => { });
            if (context)
                await context.close().catch(() => { });
            if (browser)
                await browser.close().catch(() => { });
            log('Recursos liberados após erro');
        }
        catch (cleanupErr) {
            logger.warn({ err: cleanupErr }, 'Erro ao limpar recursos');
        }
        throw new NFSeAutenticacaoError(errorMsg);
    }
}
//# sourceMappingURL=playwright-nfse.js.map