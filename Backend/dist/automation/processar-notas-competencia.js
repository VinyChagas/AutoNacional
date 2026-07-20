"use strict";
/**
 * Automação para processar notas fiscais de uma competência no portal NFSe Nacional.
 *
 * Varredura de notas emitidas e recebidas, com download de XML e DANFS-e (PDF).
 * hCaptcha: 2captcha (automático) com rqdata opcional; retry por operação (novo CAPTCHA);
 * fallback manual somente após esgotar tentativas da operação.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.setDownloadsBasePath = void 0;
exports.setMinActionDelayMs = setMinActionDelayMs;
exports.getMinActionDelayMs = getMinActionDelayMs;
exports.normalizarCompetencia = normalizarCompetencia;
exports.verificarSemRegistros = verificarSemRegistros;
exports.processarTabelaEmitidas = processarTabelaEmitidas;
exports.processarTabelaRecebidas = processarTabelaRecebidas;
exports.preencherDatasEFiltrar = preencherDatasEFiltrar;
const download_manager_1 = require("./download-manager");
Object.defineProperty(exports, "setDownloadsBasePath", { enumerable: true, get: function () { return download_manager_1.setDownloadsBasePath; } });
const logger_1 = require("../infrastructure/logger");
const captcha_solver_1 = require("./captcha-solver");
const captcha_report_1 = require("./captcha-report");
const config_1 = require("../infrastructure/config");
const download_operation_1 = require("./download-operation");
const logger = (0, logger_1.getLogger)('processar-notas');
/** Botão "Confirmar" do modal de validação (hCaptcha). */
const CAPTCHA_SUBMIT_SELECTOR = '#btnSubmitHCaptcha';
/** Intervalo de polling do token h-captcha-response (modo manual). */
const TOKEN_POLL_MS = 1000;
let _minActionDelayMs = 500;
function setMinActionDelayMs(ms) {
    _minActionDelayMs = ms;
}
function getMinActionDelayMs() {
    return _minActionDelayMs;
}
function notificarCaptcha(onCaptchaStage, stage, message) {
    logger.info({ stage }, message);
    try {
        onCaptchaStage?.(stage, message);
    }
    catch {
        /* callback não deve derrubar o fluxo */
    }
}
/** rqdata só com conteúdo real — nunca "" / null / c.req. */
function normalizeRqdata(value) {
    if (typeof value !== 'string')
        return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}
function urlValida(u) {
    return !!u && /^https?:\/\//i.test(u);
}
function sitekeyDoSrc(src) {
    if (!src)
        return null;
    const m = /sitekey=([\w-]+)/i.exec(src);
    return m ? m[1] : null;
}
/**
 * Extrai rqdata do DOM se existir. Não usa c.req. Não exige getcaptcha postData.
 */
async function tentarExtrairRqdataOpcional(page) {
    const script = `(() => {
    var el = document.querySelector('[data-rqdata]');
    if (el) {
      var v = el.getAttribute('data-rqdata');
      if (v && String(v).trim()) return String(v).trim();
    }
    var iframes = document.querySelectorAll('iframe[src*="hcaptcha"]');
    for (var i = 0; i < iframes.length; i++) {
      var src = iframes[i].getAttribute('src') || '';
      var m = src.match(/[?&#]rqdata=([^&]+)/i);
      if (m) {
        try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
      }
    }
    return null;
  })()`;
    for (const frame of page.frames()) {
        try {
            const v = await frame.evaluate(script);
            const n = normalizeRqdata(typeof v === 'string' ? v : null);
            if (n)
                return n;
        }
        catch {
            /* frame destacado */
        }
    }
    return undefined;
}
async function capturarDadosCaptcha(page) {
    const urlPrincipal = page.url();
    let sitekey = null;
    let pageurl = urlPrincipal;
    for (const frame of page.frames()) {
        try {
            const el = frame.locator('[data-sitekey]').first();
            if ((await el.count()) > 0) {
                const sk = (await el.getAttribute('data-sitekey'))?.trim();
                if (sk) {
                    sitekey = sk;
                    const frameUrl = frame.url();
                    pageurl = urlValida(frameUrl) ? frameUrl : urlPrincipal;
                    break;
                }
            }
        }
        catch {
            /* ignore */
        }
    }
    if (!sitekey) {
        for (const frame of page.frames()) {
            try {
                const iframe = frame.locator('iframe[src*="hcaptcha.com"]').first();
                if ((await iframe.count()) > 0) {
                    const sk = sitekeyDoSrc(await iframe.getAttribute('src'));
                    if (sk) {
                        sitekey = sk;
                        const frameUrl = frame.url();
                        pageurl = urlValida(frameUrl) ? frameUrl : urlPrincipal;
                        break;
                    }
                }
            }
            catch {
                /* ignore */
            }
        }
    }
    if (!sitekey)
        return null;
    // rqdata opcional: env override → DOM. Se não houver, omitir (não "" / null / c.req).
    const rqdata = normalizeRqdata(config_1.TWOCAPTCHA_RQDATA) ||
        (await tentarExtrairRqdataOpcional(page));
    if (rqdata) {
        logger.info({ rqdataLen: rqdata.length }, 'rqdata encontrado — será enviado em enterprisePayload');
    }
    else {
        logger.info('rqdata não encontrado — task 2captcha será criada sem enterprisePayload');
    }
    return { sitekey, pageurl, ...(rqdata ? { rqdata } : {}) };
}
async function injetarTokenHCaptcha(page, token) {
    const script = `(() => {
    var tk = ${JSON.stringify(token)};
    var nomes = ['h-captcha-response', 'g-recaptcha-response'];
    for (var i = 0; i < nomes.length; i++) {
      var nome = nomes[i];
      var campo = document.querySelector('textarea[name="' + nome + '"], input[name="' + nome + '"]');
      if (!campo) {
        campo = document.createElement('textarea');
        campo.name = nome;
        campo.style.display = 'none';
        (document.querySelector('form') || document.body).appendChild(campo);
      }
      campo.value = tk;
    }
  })()`;
    await page.evaluate(script);
}
async function resolverCaptchaAutomatico(page, onCaptchaStage) {
    if (!(0, captcha_solver_1.captchaConfigurado)()) {
        throw new captcha_solver_1.CaptchaError('TWOCAPTCHA_API_KEY não configurada', 'ERROR_CONFIGURATION');
    }
    const dados = await capturarDadosCaptcha(page);
    if (!dados) {
        throw new captcha_solver_1.CaptchaError('Não foi possível extrair o sitekey do hCaptcha', 'ERROR_CONFIGURATION');
    }
    let userAgent;
    try {
        userAgent = String(await page.evaluate('navigator.userAgent'));
    }
    catch {
        /* opcional */
    }
    (0, captcha_report_1.reportCaptchaDetectado)({
        sitekey: dados.sitekey,
        pageurl: dados.pageurl,
        userAgent,
        ...(dados.rqdata ? { rqdata: dados.rqdata } : {}),
    });
    notificarCaptcha(onCaptchaStage, 'captcha_resolvendo', 'hCaptcha detectado — solicitando solução ao 2captcha');
    logger.info({
        sitekey: dados.sitekey,
        pageurl: dados.pageurl,
        hasRqdata: Boolean(dados.rqdata),
    }, 'hCaptcha detectado — solicitando solução ao 2captcha');
    let token;
    try {
        token = await (0, captcha_solver_1.resolverHCaptcha)(dados.sitekey, dados.pageurl, {
            userAgent,
            ...(dados.rqdata ? { rqdata: dados.rqdata } : {}),
        });
    }
    catch (e) {
        (0, captcha_report_1.reportCaptchaFalha)({
            etapa: 'resolverHCaptcha',
            erro: e.message,
        });
        throw e;
    }
    try {
        await injetarTokenHCaptcha(page, token);
        const botaoConfirmar = page.locator(CAPTCHA_SUBMIT_SELECTOR);
        await botaoConfirmar.click({ timeout: 15000 });
        (0, captcha_report_1.reportSolucaoSubmetidaNoSite)({
            pageurl: dados.pageurl,
            camposInjetados: ['h-captcha-response', 'g-recaptcha-response'],
            botaoConfirmacao: CAPTCHA_SUBMIT_SELECTOR,
            sucesso: true,
        });
        notificarCaptcha(onCaptchaStage, 'captcha_resolvido', 'Captcha resolvido automaticamente (2captcha)');
        logger.debug('Modal de captcha confirmado (2captcha)');
    }
    catch (e) {
        (0, captcha_report_1.reportSolucaoSubmetidaNoSite)({
            pageurl: dados.pageurl,
            camposInjetados: ['h-captcha-response', 'g-recaptcha-response'],
            botaoConfirmacao: CAPTCHA_SUBMIT_SELECTOR,
            sucesso: false,
            erro: e.message,
        });
        throw e;
    }
}
async function tokenHCaptchaPreenchido(page) {
    const script = `(() => {
    var sel = 'textarea[name="h-captcha-response"], textarea#h-captcha-response, textarea[name="g-recaptcha-response"]';
    var els = document.querySelectorAll(sel);
    for (var i = 0; i < els.length; i++) {
      var v = els[i].value || '';
      if (v.length > 20) return true;
    }
    return false;
  })()`;
    for (const frame of page.frames()) {
        try {
            if (await frame.evaluate(script))
                return true;
        }
        catch {
            /* frame destacado */
        }
    }
    return false;
}
/**
 * Aguarda resolução MANUAL do hCaptcha:
 * 1) detecta modal
 * 2) mantém o navegador aberto
 * 3) espera o usuário resolver (token preenchido e/ou modal fechado)
 * 4) se o token existir e o Confirmar ainda estiver visível, clica para seguir
 */
async function aguardarResolucaoManual(page, onCaptchaStage) {
    const timeoutMs = config_1.CAPTCHA_MANUAL_TIMEOUT_MS;
    notificarCaptcha(onCaptchaStage, 'captcha_aguardando', `Aguardando resolução MANUAL do hCaptcha no navegador (até ${Math.round(timeoutMs / 1000)}s). Resolva o desafio e confirme.`);
    const inicio = Date.now();
    let tokenDetectado = false;
    while (Date.now() - inicio < timeoutMs) {
        const modalVisivel = await page
            .locator(CAPTCHA_SUBMIT_SELECTOR)
            .isVisible()
            .catch(() => false);
        if (!modalVisivel) {
            notificarCaptcha(onCaptchaStage, 'captcha_resolvido', 'Captcha resolvido — modal fechado, prosseguindo');
            return;
        }
        if (!tokenDetectado && (await tokenHCaptchaPreenchido(page))) {
            tokenDetectado = true;
            notificarCaptcha(onCaptchaStage, 'captcha_token_ok', 'Token h-captcha-response detectado — confirmando e prosseguindo');
            try {
                const botao = page.locator(CAPTCHA_SUBMIT_SELECTOR);
                if (await botao.isVisible().catch(() => false)) {
                    await botao.click({ timeout: 10000 });
                }
            }
            catch (e) {
                logger.debug({ err: e }, 'Falha ao clicar Confirmar após token (pode já ter sido clicado pelo usuário)');
            }
            try {
                await page
                    .locator(CAPTCHA_SUBMIT_SELECTOR)
                    .waitFor({ state: 'hidden', timeout: 30000 });
            }
            catch {
                /* download pode já ter disparado */
            }
            notificarCaptcha(onCaptchaStage, 'captcha_resolvido', 'Captcha resolvido — prosseguindo com o download');
            return;
        }
        await page.waitForTimeout(TOKEN_POLL_MS);
    }
    throw new Error(`Timeout aguardando resolução manual do hCaptcha (${Math.round(timeoutMs / 1000)}s)`);
}
/**
 * Normaliza a competência para comparação.
 * Aceita: "MM/AAAA", "MM-AAAA", "MMAAAA"
 */
function normalizarCompetencia(valor) {
    if (!valor || !valor.trim())
        return '';
    const competencia = valor.trim();
    if (competencia.includes('/'))
        return competencia;
    if (competencia.includes('-'))
        return competencia.replace(/-/g, '/');
    if (competencia.length === 6 && /^\d+$/.test(competencia)) {
        return `${competencia.slice(0, 2)}/${competencia.slice(2)}`;
    }
    return competencia;
}
/**
 * Encontra e clica no botão "Próxima" página.
 */
async function clicarBotaoProximaPagina(page) {
    const estrategias = [
        'i.fa-angle-right',
        'a:has(i.fa-angle-right)',
        'xpath=//i[@class="fa fa-angle-right"]',
        'xpath=//a[.//i[contains(@class,"fa-angle-right")]]',
    ];
    for (const selector of estrategias) {
        try {
            const botao = page.locator(selector).nth(0);
            if ((await botao.count()) > 0) {
                const parent = botao.locator('..');
                const liClass = await parent.locator('..').getAttribute('class');
                if (liClass?.toLowerCase().includes('disabled'))
                    return false;
                await botao.click();
                await page.waitForLoadState('networkidle', { timeout: 10000 });
                await page.waitForSelector('table tbody tr', { timeout: 8000 });
                return true;
            }
        }
        catch {
            continue;
        }
    }
    return false;
}
/**
 * Verifica se a página exibe "Nenhum registro encontrado".
 */
async function verificarSemRegistros(page) {
    const selectors = [
        'xpath=/html/body/div[1]/span',
        'span.sem-registros',
        'text=Nenhum registro encontrado',
    ];
    for (const selector of selectors) {
        try {
            const el = page.locator(selector);
            if ((await el.count()) > 0) {
                const texto = selector.startsWith('text=') ? '' : await el.innerText();
                if (selector.startsWith('text=') || (texto && texto.includes('Nenhum registro encontrado'))) {
                    return true;
                }
            }
        }
        catch {
            /* ignore */
        }
    }
    return false;
}
/**
 * Verifica se uma nota está cancelada.
 */
async function verificarNotaCancelada(rowLocator) {
    try {
        const celulas = rowLocator.locator('td');
        for (const colIdx of [4, 5]) {
            const coluna = celulas.nth(colIdx);
            const img = coluna.locator('img');
            if ((await img.count()) > 0) {
                const src = await img.getAttribute('src');
                const title = await img.getAttribute('data-original-title') || await img.getAttribute('title');
                if (src?.toLowerCase().includes('cancelada') || title?.toLowerCase().includes('cancelada')) {
                    return true;
                }
            }
        }
    }
    catch {
        /* ignore */
    }
    return false;
}
/**
 * Verifica se uma nota é válida (não cancelada).
 * Retorna { valida: boolean; cancelada: boolean } para contar canceladas.
 */
async function verificarNotaValida(rowLocator) {
    const cancelada = await verificarNotaCancelada(rowLocator);
    if (cancelada) {
        logger.debug('Nota cancelada detectada. Não será baixada.');
        return { valida: false, cancelada: true };
    }
    return { valida: true, cancelada: false };
}
/**
 * Baixa XML e (opcionalmente) DANFS-e de uma linha da tabela.
 * Cada arquivo é uma operação independente com retry de CAPTCHA no nível da operação.
 */
async function baixarArquivosDaLinha(page, rowLocator, basePath, nomeContabilidade, mesExecucaoExtenso, nomeEmpresa, tipoNota, baixarPdf = true, onCaptchaStage, executionIds, indiceLinha) {
    const { chaveNfse, numeroNota } = await (0, download_operation_1.extrairIdentificadorDaLinha)(rowLocator);
    const prefixo = numeroNota ? `${numeroNota}_` : undefined;
    const execId = executionIds?.executionId ||
        `anon-${nomeEmpresa}-${Date.now()}`;
    const empresaId = executionIds?.empresaId || '0';
    const deps = {
        onStage: onCaptchaStage,
        resolverCaptchaAutomatico: (p) => resolverCaptchaAutomatico(p, onCaptchaStage),
        aguardarResolucaoManual: (p) => aguardarResolucaoManual(p, onCaptchaStage),
    };
    const ctxXml = (0, download_operation_1.criarContextoOperacao)({
        executionId: execId,
        empresaId,
        batchId: executionIds?.batchId,
        tipoNota,
        tipoArquivo: 'xml',
        chaveNfse,
        numeroNota,
        indiceLinhaOriginal: indiceLinha,
        basePath,
        nomeContabilidade,
        mesExecucaoExtenso,
        nomeEmpresa,
        nomeArquivoPrefixo: prefixo,
    });
    try {
        const resXml = await (0, download_operation_1.executarDownloadNotaComRetry)(page, rowLocator, ctxXml, deps);
        if (!resXml.success) {
            logger.warn({ err: resXml.error, chave: chaveNfse }, 'Falha ao baixar XML');
        }
    }
    catch (e) {
        logger.warn({ err: e }, 'Erro ao baixar XML');
    }
    if (!baixarPdf)
        return;
    await page.waitForTimeout(_minActionDelayMs);
    // Relocaliza a linha (DOM pode ter mudado após XML)
    let rowPdf = rowLocator;
    try {
        rowPdf = await (0, download_operation_1.localizarNotaPorIdentificador)(page, {
            ...ctxXml,
            tipoArquivo: 'pdf',
        });
    }
    catch {
        rowPdf = rowLocator;
    }
    const ctxPdf = (0, download_operation_1.criarContextoOperacao)({
        executionId: execId,
        empresaId,
        batchId: executionIds?.batchId,
        tipoNota,
        tipoArquivo: 'pdf',
        chaveNfse,
        numeroNota,
        indiceLinhaOriginal: indiceLinha,
        basePath,
        nomeContabilidade,
        mesExecucaoExtenso,
        nomeEmpresa,
        nomeArquivoPrefixo: prefixo,
    });
    try {
        const resPdf = await (0, download_operation_1.executarDownloadNotaComRetry)(page, rowPdf, ctxPdf, deps);
        if (!resPdf.success) {
            logger.warn({ err: resPdf.error, chave: chaveNfse }, 'Falha ao baixar DANFS-e');
        }
    }
    catch (e) {
        logger.warn({ err: e }, 'Erro ao baixar DANFS-e');
    }
}
/**
 * Processa a tabela de notas emitidas.
 * A pasta usa nomeContabilidade e mesExecucaoExtenso (mês da execução), não a competência da nota.
 */
async function processarTabelaEmitidas(page, basePath, nomeContabilidade, mesExecucaoExtenso, nomeEmpresa, baixarPdf = true, onCaptchaStage, executionIds) {
    if (await verificarSemRegistros(page)) {
        return { qtd_baixadas: 0, qtd_canceladas: 0, sem_registros: true, encontrou_notas: false };
    }
    let qtdBaixadas = 0;
    let qtdCanceladas = 0;
    let encontrouNotas = false;
    while (true) {
        await page.waitForSelector('table tbody tr', { timeout: 10000 });
        const linhas = page.locator('table tbody tr');
        const total = await linhas.count();
        if (total === 0)
            break;
        for (let i = 0; i < total; i++) {
            const linha = linhas.nth(i);
            try {
                encontrouNotas = true;
                const { valida, cancelada } = await verificarNotaValida(linha);
                if (cancelada)
                    qtdCanceladas++;
                if (valida) {
                    await baixarArquivosDaLinha(page, linha, basePath, nomeContabilidade, mesExecucaoExtenso, nomeEmpresa, 'Emitidas', baixarPdf, onCaptchaStage, executionIds, i);
                    qtdBaixadas++;
                }
            }
            catch (e) {
                logger.debug({ err: e }, `Erro ao processar linha ${i + 1}`);
            }
        }
        const mudou = await clicarBotaoProximaPagina(page);
        if (!mudou)
            break;
        await page.waitForTimeout(_minActionDelayMs);
    }
    return { qtd_baixadas: qtdBaixadas, qtd_canceladas: qtdCanceladas, sem_registros: false, encontrou_notas: encontrouNotas };
}
/**
 * Processa a tabela de notas recebidas.
 * A pasta usa nomeContabilidade e mesExecucaoExtenso (mês da execução), não a competência da nota.
 */
async function processarTabelaRecebidas(page, basePath, nomeContabilidade, mesExecucaoExtenso, nomeEmpresa, baixarPdf = true, onCaptchaStage, executionIds) {
    if (await verificarSemRegistros(page)) {
        return { qtd_baixadas: 0, qtd_canceladas: 0, sem_registros: true, encontrou_notas: false };
    }
    let qtdBaixadas = 0;
    let qtdCanceladas = 0;
    let encontrouNotas = false;
    while (true) {
        await page.waitForSelector('table tbody tr', { timeout: 10000 });
        const linhas = page.locator('table tbody tr');
        const total = await linhas.count();
        if (total === 0)
            break;
        for (let i = 0; i < total; i++) {
            const linha = linhas.nth(i);
            try {
                encontrouNotas = true;
                const { valida, cancelada } = await verificarNotaValida(linha);
                if (cancelada)
                    qtdCanceladas++;
                if (valida) {
                    await baixarArquivosDaLinha(page, linha, basePath, nomeContabilidade, mesExecucaoExtenso, nomeEmpresa, 'Recebidas', baixarPdf, onCaptchaStage, executionIds, i);
                    qtdBaixadas++;
                }
            }
            catch (e) {
                logger.debug({ err: e }, `Erro ao processar linha ${i + 1}`);
            }
        }
        const mudou = await clicarBotaoProximaPagina(page);
        if (!mudou)
            break;
        await page.waitForTimeout(_minActionDelayMs);
    }
    return { qtd_baixadas: qtdBaixadas, qtd_canceladas: qtdCanceladas, sem_registros: false, encontrou_notas: encontrouNotas };
}
/**
 * Preenche datas e clica em filtrar.
 */
async function preencherDatasEFiltrar(page, dataInicio, dataFim) {
    const campoInicio = page.locator('xpath=//*[@id="datainicio"]');
    const campoFim = page.locator('xpath=//*[@id="datafim"]');
    await campoInicio.waitFor({ state: 'visible', timeout: 10000 });
    await campoFim.waitFor({ state: 'visible', timeout: 10000 });
    await campoInicio.fill('');
    await campoInicio.fill(dataInicio);
    await campoFim.fill('');
    await campoFim.fill(dataFim);
    await page.waitForTimeout(_minActionDelayMs);
    const botaoFiltrar = page.locator('xpath=//*[@id="searchbar"]/form/div[2]/div[2]/div[2]/button');
    await botaoFiltrar.click();
    await page.waitForLoadState('networkidle', { timeout: 10000 });
    await page.waitForTimeout(_minActionDelayMs * 2);
}
//# sourceMappingURL=processar-notas-competencia.js.map