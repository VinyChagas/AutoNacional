"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.abrirDashboardNfseComCredencial = abrirDashboardNfseComCredencial;
/**
 * Automação de login por credencial (CNPJ/CPF + senha) no portal NFSe Nacional.
 * Usado na execução de processos para empresas que utilizam credenciais em vez de certificado.
 * Retorna a página autenticada para o fluxo de processamento de notas.
 */
const playwright_1 = require("playwright");
const logger_1 = require("../infrastructure/logger");
const playwright_config_1 = require("./playwright-config");
const playwright_nfse_1 = require("./playwright-nfse");
const logger = (0, logger_1.getLogger)('login-credencial-nfse');
const BASE_URL = 'https://www.nfse.gov.br/EmissorNacional/';
/**
 * Abre o dashboard do portal NFSe Nacional autenticado com credencial (CNPJ/CPF + senha).
 * Retorna page e browser abertos para o fluxo continuar (processar notas).
 * Não fecha o browser - o chamador é responsável por fechar após o uso.
 */
async function abrirDashboardNfseComCredencial(documento, senha, opcoes = {}) {
    const headless = opcoes.headless ?? true;
    const timeout = opcoes.timeout ?? 120000;
    // Fallback de conteúdo — nunca usar resolução Full HD do monitor aqui
    const viewport = opcoes.viewport ?? { width: 769, height: 680 };
    const launchArgs = [
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        ...(opcoes.launchArgs ?? []),
    ];
    const docLimpo = documento.replace(/[.\/\-\s]/g, '');
    const isCpf = docLimpo.length === 11;
    const isCnpj = docLimpo.length === 14;
    if ((!isCpf && !isCnpj) || !senha?.trim()) {
        throw new playwright_nfse_1.NFSeAutenticacaoError('Documento (CPF/CNPJ) ou senha inválidos');
    }
    const logs = [];
    const log = (msg) => {
        logger.debug(msg);
        logs.push(msg);
    };
    let browser;
    let context;
    let page;
    try {
        log('Iniciando automação NFSe com credencial...');
        log('Lançando navegador...');
        browser = await playwright_1.chromium.launch({
            headless,
            args: launchArgs,
        });
        context = await browser.newContext({
            ignoreHTTPSErrors: true,
            viewport,
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
            acceptDownloads: true,
        });
        await (0, playwright_config_1.aplicarZoomPaginaNoContexto)(context);
        page = await context.newPage();
        page.setDefaultTimeout(timeout);
        log('Página criada');
        log(`Acessando portal NFSe Nacional: ${BASE_URL}`);
        await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(1000);
        log(`Página carregada: ${page.url()}`);
        const selectorsDocumento = [
            'input[name="cnpj"]',
            'input[name="usuario"]',
            'input[id="cnpj"]',
            'input[id="usuario"]',
            'input[placeholder*="CNPJ"]',
            'input[placeholder*="CPF"]',
            'input[placeholder*="Usuário"]',
            'input[type="text"]',
        ];
        const selectorsSenha = [
            'input[name="senha"]',
            'input[id="senha"]',
            'input[type="password"]',
            'input[placeholder*="Senha"]',
        ];
        let inputCnpj = null;
        let inputSenha = null;
        for (const sel of selectorsDocumento) {
            const el = page.locator(sel).first();
            if ((await el.count()) > 0) {
                inputCnpj = el;
                break;
            }
        }
        for (const sel of selectorsSenha) {
            const el = page.locator(sel).first();
            if ((await el.count()) > 0) {
                inputSenha = el;
                break;
            }
        }
        if (!inputCnpj || !inputSenha) {
            throw new playwright_nfse_1.NFSeAutenticacaoError('Portal NFSe: campos de documento/senha não encontrados');
        }
        opcoes.onLoginPageReady?.();
        log('Preenchendo credenciais...');
        await inputCnpj.fill(docLimpo, { timeout: 5000 });
        await inputSenha.fill(senha, { timeout: 5000 });
        const btnLogin = page.locator('button:has-text("Entrar"), button:has-text("Acessar"), input[type="submit"], .btn-login, #btnLogin').first();
        if ((await btnLogin.count()) > 0) {
            await btnLogin.click({ timeout: 5000 });
            log('Clique em Entrar realizado');
        }
        await page.waitForTimeout(5000);
        const urlAtual = page.url();
        const textoPagina = await page.locator('body').innerText().catch(() => '');
        const falhaIndicadores = [
            'senha incorreta',
            'credencial inválida',
            'usuário ou senha inválidos',
            'acesso negado',
            'dados incorretos',
            'tente novamente',
        ];
        const temIndicadorFalha = falhaIndicadores.some((t) => textoPagina.toLowerCase().includes(t));
        if (temIndicadorFalha) {
            throw new playwright_nfse_1.NFSeAutenticacaoError('Senha incorreta ou credenciais inválidas');
        }
        const urlLower = urlAtual.toLowerCase();
        const urlIndicaSucesso = urlLower.includes('dashboard') ||
            urlLower.includes('painel') ||
            urlLower.includes('/home') ||
            urlLower.includes('/principal');
        const seletoresSucesso = [
            'text=/dashboard/i',
            'text=/painel/i',
            'text=/emissor nacional/i',
            '[href*="Dashboard"]',
            '[href*="dashboard"]',
            '.dashboard',
            '#dashboard',
        ];
        let conteudoIndicaSucesso = false;
        for (const sel of seletoresSucesso) {
            try {
                const loc = page.locator(sel).first();
                if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) {
                    conteudoIndicaSucesso = true;
                    break;
                }
            }
            catch {
                continue;
            }
        }
        const loginAindaVisivel = await inputCnpj.isVisible().catch(() => false);
        const formSumiu = !loginAindaVisivel;
        const dashboardEncontrado = urlIndicaSucesso || conteudoIndicaSucesso || (formSumiu && !temIndicadorFalha);
        if (!dashboardEncontrado) {
            throw new playwright_nfse_1.NFSeAutenticacaoError('Não foi possível confirmar acesso ao dashboard após login');
        }
        log('Autenticação por credencial bem-sucedida!');
        const tituloPagina = await page.title().catch(() => '');
        return {
            sucesso: true,
            url_atual: urlAtual,
            titulo: tituloPagina,
            mensagem: 'Dashboard acessado com sucesso via credencial',
            logs,
            page,
            context,
            browser,
        };
    }
    catch (e) {
        if (e instanceof playwright_nfse_1.NFSeAutenticacaoError) {
            throw e;
        }
        const err = e;
        const errorMsg = `Erro durante login por credencial NFSe: ${err.message}`;
        logger.error({ err }, errorMsg);
        logs.push(`ERRO: ${errorMsg}`);
        try {
            if (page)
                await page.close().catch(() => { });
            if (context)
                await context.close().catch(() => { });
            if (browser)
                await browser.close().catch(() => { });
        }
        catch {
            /* ignore */
        }
        throw new playwright_nfse_1.NFSeAutenticacaoError(errorMsg);
    }
}
//# sourceMappingURL=login-credencial-nfse.js.map