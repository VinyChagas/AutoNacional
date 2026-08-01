"use strict";
/**
 * Tratamento MANUAL de hCaptcha no navegador Playwright (Portal Nacional NFSe).
 *
 * A janela já deve estar no slot visual desde o launch (captcha-window-manager).
 * Este handler NÃO redimensiona, NÃO reposiciona e NÃO restaura a janela.
 *
 * Fluxo:
 * 1) Aguarda o modal
 * 2) Espera 2,5s (animação)
 * 3) Tab → 0,5s → Tab → 0,5s → Enter — abre o desafio
 * 4) Usuário resolve no navegador visível
 * 5) Detecta token legítimo em h-captcha-response
 * 6) Clica em Confirmar (#btnSubmitHCaptcha)
 *
 * Não resolve, não injeta e não contorna o captcha.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOKEN_POLL_INTERVAL_MS = exports.KEYBOARD_STEP_DELAY_MS = exports.MODAL_ANIMATION_DELAY_MS = void 0;
exports.obterCandidatosBotaoConfirmar = obterCandidatosBotaoConfirmar;
exports.tokenHCaptchaPreenchido = tokenHCaptchaPreenchido;
exports.abrirDesafioComTeclado = abrirDesafioComTeclado;
exports.clicarBotaoConfirmarHCaptcha = clicarBotaoConfirmarHCaptcha;
exports.tratarHCaptchaManual = tratarHCaptchaManual;
const logger_1 = require("../infrastructure/logger");
const config_1 = require("../infrastructure/config");
const hcaptcha_page_1 = require("./hcaptcha-page");
const logger = (0, logger_1.getLogger)('hcaptcha-manual-handler');
/** Delay após o modal aparecer, antes das teclas (animação). */
exports.MODAL_ANIMATION_DELAY_MS = 2500;
/** Intervalo entre Tab → Tab → Enter. */
exports.KEYBOARD_STEP_DELAY_MS = 500;
/** Intervalo padrão de polling do token. */
exports.TOKEN_POLL_INTERVAL_MS = 1000;
/** Comprimento mínimo considerado token hCaptcha válido. */
const TOKEN_MIN_LENGTH = 20;
/** Seletores do Confirmar: ID → XPath por id → XPath absoluto (último fallback). */
function obterCandidatosBotaoConfirmar(page) {
    return [
        {
            name: hcaptcha_page_1.CAPTCHA_SUBMIT_SELECTOR,
            get: () => page.locator(hcaptcha_page_1.CAPTCHA_SUBMIT_SELECTOR),
        },
        {
            name: 'xpath=//*[@id="btnSubmitHCaptcha"]',
            get: () => page.locator('xpath=//*[@id="btnSubmitHCaptcha"]'),
        },
        {
            name: 'xpath-absoluto',
            get: () => page.locator('xpath=/html/body/div[4]/div/div/div[2]/form/div/div/div/div[2]/button[1]'),
        },
    ];
}
function notificar(opcoes, stage, message, contexto) {
    logger.info({
        stage,
        executionId: contexto.executionId,
        empresaId: contexto.empresaId,
        batchId: contexto.batchId,
        operationId: contexto.operationId,
        tipoArquivo: contexto.tipoArquivo,
    }, message);
    try {
        opcoes?.onStage?.(stage, message);
    }
    catch {
        /* callback não deve derrubar o fluxo */
    }
}
/**
 * Verifica se há token legítimo em h-captcha-response / g-recaptcha-response
 * na página principal ou em frames.
 */
async function tokenHCaptchaPreenchido(page) {
    const script = `(() => {
    var sel = 'textarea[name="h-captcha-response"], textarea#h-captcha-response, textarea[name="g-recaptcha-response"]';
    var els = document.querySelectorAll(sel);
    for (var i = 0; i < els.length; i++) {
      var v = els[i].value || '';
      if (v.length > ${TOKEN_MIN_LENGTH}) return true;
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
async function modalCaptchaVisivel(page) {
    return page
        .locator(hcaptcha_page_1.CAPTCHA_SUBMIT_SELECTOR)
        .isVisible()
        .catch(() => false);
}
async function aguardarModalVisivel(page, timeoutMs) {
    try {
        await page
            .locator(hcaptcha_page_1.CAPTCHA_SUBMIT_SELECTOR)
            .waitFor({ state: 'visible', timeout: timeoutMs });
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Abre o desafio hCaptcha com Tab × 2 + Enter (após delay da animação).
 * Intervalo de meio segundo entre cada tecla.
 */
async function abrirDesafioComTeclado(page, delayMs = exports.MODAL_ANIMATION_DELAY_MS, stepDelayMs = exports.KEYBOARD_STEP_DELAY_MS) {
    await page.waitForTimeout(delayMs);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(stepDelayMs);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(stepDelayMs);
    await page.keyboard.press('Enter');
}
/**
 * Clica em Confirmar priorizando #btnSubmitHCaptcha.
 */
async function clicarBotaoConfirmarHCaptcha(page) {
    const candidates = obterCandidatosBotaoConfirmar(page);
    for (const c of candidates) {
        const locator = c.get();
        const exists = (await locator.count().catch(() => 0)) > 0;
        if (!exists)
            continue;
        const button = locator.last();
        const visible = await button.isVisible().catch(() => false);
        const enabled = await button.isEnabled().catch(() => false);
        if (!visible || !enabled)
            continue;
        await button.scrollIntoViewIfNeeded().catch(() => undefined);
        await button.click({ timeout: 15000 });
        return c.name;
    }
    throw new Error('Botão Confirmar (#btnSubmitHCaptcha) não encontrado ou não utilizável');
}
async function aguardarModalFechar(page, timeoutMs) {
    try {
        await page
            .locator(hcaptcha_page_1.CAPTCHA_SUBMIT_SELECTOR)
            .waitFor({ state: 'hidden', timeout: timeoutMs });
        return true;
    }
    catch {
        return !(await modalCaptchaVisivel(page));
    }
}
/**
 * Trata o modal de hCaptcha de forma estritamente MANUAL no navegador.
 * Não altera tamanho/posição da janela (já fixada no slot desde o launch).
 */
async function tratarHCaptchaManual(page, contexto, opcoes) {
    const timeoutMs = opcoes?.timeoutMs ?? config_1.CAPTCHA_MANUAL_TIMEOUT_MS;
    const animationDelayMs = opcoes?.modalAnimationDelayMs ?? exports.MODAL_ANIMATION_DELAY_MS;
    const keyboardStepDelayMs = opcoes?.keyboardStepDelayMs ?? exports.KEYBOARD_STEP_DELAY_MS;
    const pollIntervalMs = opcoes?.pollIntervalMs ?? exports.TOKEN_POLL_INTERVAL_MS;
    const detectTimeoutMs = opcoes?.detectTimeoutMs ?? 8000;
    const inicio = Date.now();
    let visivel = opcoes?.modalJaVisivel
        ? await modalCaptchaVisivel(page)
        : false;
    if (!visivel) {
        notificar(opcoes, 'captcha_detectando', 'Aguardando modal de hCaptcha aparecer…', contexto);
        visivel = await aguardarModalVisivel(page, detectTimeoutMs);
    }
    if (!visivel) {
        return {
            status: 'MODAL_NOT_FOUND',
            tokenDetected: false,
            modalClosed: true,
            reason: 'Modal de hCaptcha não apareceu',
        };
    }
    notificar(opcoes, 'captcha_detectado', 'Modal de hCaptcha detectado — abrindo desafio (Tab/Enter)', contexto);
    try {
        await abrirDesafioComTeclado(page, animationDelayMs, keyboardStepDelayMs);
        notificar(opcoes, 'captcha_desafio_aberto', 'Desafio aberto — resolva o hCaptcha manualmente no navegador', contexto);
    }
    catch (e) {
        logger.warn({ err: e, executionId: contexto.executionId }, 'Falha ao enviar Tab/Enter para abrir o desafio (seguindo com polling)');
    }
    notificar(opcoes, 'captcha_aguardando', `Aguardando resolução MANUAL do hCaptcha (até ${Math.round(timeoutMs / 1000)}s)`, contexto);
    let tokenDetected = false;
    while (Date.now() - inicio < timeoutMs) {
        const aindaVisivel = await modalCaptchaVisivel(page);
        if (!aindaVisivel) {
            notificar(opcoes, 'captcha_resolvido', 'Captcha resolvido — modal fechado, prosseguindo', contexto);
            return {
                status: 'RESOLVED',
                tokenDetected,
                modalClosed: true,
            };
        }
        if (!tokenDetected && (await tokenHCaptchaPreenchido(page))) {
            tokenDetected = true;
            notificar(opcoes, 'captcha_token_ok', 'Token h-captcha-response detectado — clicando em Confirmar', contexto);
            try {
                const selectorUsado = await clicarBotaoConfirmarHCaptcha(page);
                logger.info({ selector: selectorUsado, executionId: contexto.executionId }, 'Botão Confirmar do hCaptcha acionado');
            }
            catch (e) {
                const reason = e instanceof Error
                    ? e.message
                    : 'Falha ao clicar em Confirmar após token';
                logger.warn({ err: e }, reason);
                if (!(await modalCaptchaVisivel(page))) {
                    notificar(opcoes, 'captcha_resolvido', 'Captcha resolvido — modal fechado após token', contexto);
                    return {
                        status: 'RESOLVED',
                        tokenDetected: true,
                        modalClosed: true,
                    };
                }
                return {
                    status: 'CONFIRM_FAILED',
                    tokenDetected: true,
                    modalClosed: false,
                    reason,
                };
            }
            const restante = Math.max(5000, timeoutMs - (Date.now() - inicio));
            const fechou = await aguardarModalFechar(page, Math.min(30000, restante));
            if (fechou) {
                notificar(opcoes, 'captcha_resolvido', 'Captcha resolvido — Confirmar aceito, prosseguindo com o download', contexto);
                return {
                    status: 'RESOLVED',
                    tokenDetected: true,
                    modalClosed: true,
                };
            }
            if (!(await modalCaptchaVisivel(page))) {
                return {
                    status: 'RESOLVED',
                    tokenDetected: true,
                    modalClosed: true,
                };
            }
        }
        await page.waitForTimeout(pollIntervalMs);
    }
    const reason = `Timeout aguardando resolução manual do hCaptcha (${Math.round(timeoutMs / 1000)}s)`;
    notificar(opcoes, 'captcha_timeout', reason, contexto);
    return {
        status: 'TIMEOUT',
        tokenDetected,
        modalClosed: !(await modalCaptchaVisivel(page)),
        reason,
    };
}
//# sourceMappingURL=hcaptcha-manual-handler.js.map