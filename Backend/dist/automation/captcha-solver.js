"use strict";
/**
 * Resolução de hCaptcha via 2captcha (API v1 e v2).
 *
 * API v1 (in.php / res.php):
 *   { key, method: 'hcaptcha', sitekey, pageurl, json: 1 }
 *
 * API v2 (createTask / getTaskResult):
 *   Com proxy:    type = HCaptchaTask
 *   Sem proxy:    type = HCaptchaTaskProxyless
 *
 * Versão controlada por TWOCAPTCHA_API_VERSION (padrão: v2).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CaptchaError = void 0;
exports.captchaConfigurado = captchaConfigurado;
exports.resolverHCaptcha = resolverHCaptcha;
const logger_1 = require("../infrastructure/logger");
const config_1 = require("../infrastructure/config");
const sleep_1 = require("../utils/sleep");
const captcha_report_1 = require("./captcha-report");
const logger = (0, logger_1.getLogger)('captcha-solver');
const IN_URL = 'https://2captcha.com/in.php';
const RES_URL = 'https://2captcha.com/res.php';
const CREATE_TASK_URL = 'https://api.2captcha.com/createTask';
const GET_TASK_RESULT_URL = 'https://api.2captcha.com/getTaskResult';
const POLL_INTERVAL_MS = 5000;
const INITIAL_WAIT_MS = 12000;
class CaptchaError extends Error {
    /** Código tipado da API 2Captcha (ex.: ERROR_CAPTCHA_UNSOLVABLE), quando disponível. */
    code;
    constructor(message, code) {
        super(message);
        this.name = 'CaptchaError';
        this.code = code || extractCodeFromMessage(message);
    }
}
exports.CaptchaError = CaptchaError;
function extractCodeFromMessage(message) {
    const m = /ERROR_[A-Z0-9_]+/.exec(message);
    return m?.[0];
}
function captchaConfigurado() {
    return Boolean(config_1.TWOCAPTCHA_API_KEY && config_1.TWOCAPTCHA_API_KEY.trim());
}
function proxyConfigurado() {
    return Boolean(config_1.TWOCAPTCHA_PROXY_TYPE &&
        config_1.TWOCAPTCHA_PROXY_ADDRESS &&
        config_1.TWOCAPTCHA_PROXY_PORT);
}
/**
 * Resolve hCaptcha e retorna o token.
 * @param sitekey - websiteKey / sitekey do widget
 * @param pageurl - URL da página (websiteURL)
 * @param options - userAgent e rqdata opcional (enterprisePayload).
 *                 rqdata só é enviado quando houver valor real não vazio.
 *                 Nunca use c.req como substituto; nunca envie "" ou null.
 */
async function resolverHCaptcha(sitekey, pageurl, options) {
    if (!captchaConfigurado()) {
        throw new CaptchaError('TWOCAPTCHA_API_KEY não configurada no .env', 'ERROR_CONFIGURATION');
    }
    const rqdata = normalizeRqdata(options?.rqdata);
    const opts = { userAgent: options?.userAgent, rqdata };
    if (config_1.TWOCAPTCHA_API_VERSION === 'v1') {
        return resolverV1(sitekey, pageurl, rqdata);
    }
    return resolverV2(sitekey, pageurl, opts);
}
/**
 * Retorna rqdata somente se for string com conteúdo real.
 * Caso contrário undefined — a propriedade deve ser omitida do payload.
 */
function normalizeRqdata(value) {
    if (typeof value !== 'string')
        return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}
async function resolverV2(sitekey, pageurl, options) {
    const taskId = await criarTaskV2(sitekey, pageurl, options);
    logger.info({ taskId, hasRqdata: Boolean(normalizeRqdata(options?.rqdata)) }, 'Task criada no 2captcha (v2), aguardando solução…');
    return aguardarSolucaoV2(taskId);
}
async function criarTaskV2(sitekey, pageurl, options) {
    const comProxy = proxyConfigurado();
    const task = {
        type: comProxy ? 'HCaptchaTask' : 'HCaptchaTaskProxyless',
        websiteURL: pageurl,
        websiteKey: sitekey,
        isInvisible: config_1.CAPTCHA_IS_INVISIBLE,
    };
    if (options?.userAgent) {
        task.userAgent = options.userAgent;
    }
    // rqdata opcional: incluir enterprisePayload somente com valor real (nunca "" / null / c.req)
    const rqdata = normalizeRqdata(options?.rqdata);
    if (rqdata) {
        task.enterprisePayload = { rqdata };
    }
    if (comProxy) {
        task.proxyType = config_1.TWOCAPTCHA_PROXY_TYPE;
        task.proxyAddress = config_1.TWOCAPTCHA_PROXY_ADDRESS;
        task.proxyPort = config_1.TWOCAPTCHA_PROXY_PORT;
        if (config_1.TWOCAPTCHA_PROXY_LOGIN)
            task.proxyLogin = config_1.TWOCAPTCHA_PROXY_LOGIN;
        if (config_1.TWOCAPTCHA_PROXY_PASSWORD)
            task.proxyPassword = config_1.TWOCAPTCHA_PROXY_PASSWORD;
    }
    const requestBody = { clientKey: config_1.TWOCAPTCHA_API_KEY, task };
    (0, captcha_report_1.reportApiRequest)({
        apiVersion: 'v2',
        endpoint: CREATE_TASK_URL,
        body: requestBody,
    });
    const inicio = Date.now();
    let data;
    try {
        const resp = await fetch(CREATE_TASK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
        });
        data = (await resp.json());
    }
    catch (e) {
        const msg = `Falha de rede ao criar task no 2captcha (v2): ${e.message}`;
        (0, captcha_report_1.reportCaptchaFalha)({ etapa: 'createTask', erro: msg });
        throw new CaptchaError(msg);
    }
    (0, captcha_report_1.reportApiResponse)({
        apiVersion: 'v2',
        endpoint: CREATE_TASK_URL,
        response: data,
        elapsedMs: Date.now() - inicio,
    });
    if (data.errorId && data.errorId !== 0) {
        const msg = `2captcha createTask: ${data.errorCode} — ${data.errorDescription}`;
        (0, captcha_report_1.reportCaptchaFalha)({ etapa: 'createTask', erro: msg });
        throw new CaptchaError(msg);
    }
    if (!data.taskId) {
        const msg = '2captcha createTask não retornou taskId';
        (0, captcha_report_1.reportCaptchaFalha)({ etapa: 'createTask', erro: msg });
        throw new CaptchaError(msg);
    }
    return data.taskId;
}
async function aguardarSolucaoV2(taskId) {
    const inicio = Date.now();
    await (0, sleep_1.sleep)(INITIAL_WAIT_MS);
    let pollCount = 0;
    while (Date.now() - inicio < config_1.CAPTCHA_SOLVE_TIMEOUT_MS) {
        pollCount += 1;
        let data;
        const pollInicio = Date.now();
        try {
            const pollBody = { clientKey: config_1.TWOCAPTCHA_API_KEY, taskId };
            if (pollCount === 1) {
                (0, captcha_report_1.reportApiRequest)({
                    apiVersion: 'v2',
                    endpoint: GET_TASK_RESULT_URL,
                    body: pollBody,
                });
            }
            const resp = await fetch(GET_TASK_RESULT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(pollBody),
            });
            data = (await resp.json());
        }
        catch (e) {
            logger.debug({ err: e }, 'Erro de rede em getTaskResult (tentando novamente)');
            await (0, sleep_1.sleep)(POLL_INTERVAL_MS);
            continue;
        }
        const isFinal = (data.errorId && data.errorId !== 0) ||
            data.status === 'ready';
        if (isFinal || pollCount === 1) {
            (0, captcha_report_1.reportApiResponse)({
                apiVersion: 'v2',
                endpoint: GET_TASK_RESULT_URL,
                response: {
                    errorId: data.errorId,
                    errorCode: data.errorCode,
                    errorDescription: data.errorDescription,
                    status: data.status,
                    pollCount,
                    hasToken: Boolean(data.solution?.token || data.solution?.gRecaptchaResponse),
                    tokenLength: (data.solution?.token || data.solution?.gRecaptchaResponse || '').length,
                },
                elapsedMs: Date.now() - pollInicio,
            });
        }
        if (data.errorId && data.errorId !== 0) {
            const msg = `2captcha getTaskResult: ${data.errorCode} — ${data.errorDescription}`;
            (0, captcha_report_1.reportCaptchaFalha)({ etapa: 'getTaskResult', erro: msg });
            throw new CaptchaError(msg);
        }
        if (data.status === 'ready') {
            const token = data.solution?.token || data.solution?.gRecaptchaResponse;
            if (!token) {
                const msg = '2captcha retornou ready sem token na solução';
                (0, captcha_report_1.reportCaptchaFalha)({ etapa: 'getTaskResult', erro: msg });
                throw new CaptchaError(msg);
            }
            (0, captcha_report_1.reportTokenRecebido)({
                apiVersion: 'v2',
                taskId,
                tokenLength: token.length,
                tokenPrefix: token.slice(0, 12),
            });
            logger.info('Token do hCaptcha recebido do 2captcha (v2)');
            return token;
        }
        await (0, sleep_1.sleep)(POLL_INTERVAL_MS);
    }
    const msg = `Timeout aguardando solução do hCaptcha (v2) após ${pollCount} polls`;
    (0, captcha_report_1.reportCaptchaFalha)({ etapa: 'getTaskResult', erro: msg });
    throw new CaptchaError(msg);
}
async function resolverV1(sitekey, pageurl, rqdata) {
    const captchaId = await enviarCaptchaV1(sitekey, pageurl, rqdata);
    logger.info({ captchaId, hasRqdata: Boolean(rqdata) }, 'Captcha enviado ao 2captcha (v1), aguardando solução…');
    return aguardarSolucaoV1(captchaId);
}
async function enviarCaptchaV1(sitekey, pageurl, rqdata) {
    const paramsObj = {
        key: config_1.TWOCAPTCHA_API_KEY,
        method: 'hcaptcha',
        sitekey,
        pageurl,
        json: '1',
    };
    // rqdata opcional — omitir completamente se não houver valor real (nunca "" / null / c.req)
    const rq = normalizeRqdata(rqdata);
    if (rq) {
        paramsObj.data = rq;
        paramsObj.rqdata = rq;
    }
    (0, captcha_report_1.reportApiRequest)({
        apiVersion: 'v1',
        endpoint: IN_URL,
        body: paramsObj,
    });
    const params = new URLSearchParams(paramsObj);
    const inicio = Date.now();
    let data;
    try {
        const resp = await fetch(IN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString(),
        });
        data = (await resp.json());
    }
    catch (e) {
        const msg = `Falha de rede ao enviar captcha (v1): ${e.message}`;
        (0, captcha_report_1.reportCaptchaFalha)({ etapa: 'in.php', erro: msg });
        throw new CaptchaError(msg);
    }
    (0, captcha_report_1.reportApiResponse)({
        apiVersion: 'v1',
        endpoint: IN_URL,
        response: data,
        elapsedMs: Date.now() - inicio,
    });
    if (data.status !== 1) {
        const msg = `2captcha recusou o envio (v1): ${data.request}`;
        (0, captcha_report_1.reportCaptchaFalha)({ etapa: 'in.php', erro: msg });
        throw new CaptchaError(msg);
    }
    return data.request;
}
async function aguardarSolucaoV1(captchaId) {
    const inicio = Date.now();
    await (0, sleep_1.sleep)(INITIAL_WAIT_MS);
    const params = new URLSearchParams({
        key: config_1.TWOCAPTCHA_API_KEY,
        action: 'get',
        id: captchaId,
        json: '1',
    });
    const url = `${RES_URL}?${params.toString()}`;
    let pollCount = 0;
    while (Date.now() - inicio < config_1.CAPTCHA_SOLVE_TIMEOUT_MS) {
        pollCount += 1;
        let data;
        const pollInicio = Date.now();
        try {
            if (pollCount === 1) {
                (0, captcha_report_1.reportApiRequest)({
                    apiVersion: 'v1',
                    endpoint: RES_URL,
                    body: {
                        key: config_1.TWOCAPTCHA_API_KEY,
                        action: 'get',
                        id: captchaId,
                        json: '1',
                    },
                });
            }
            const resp = await fetch(url);
            data = (await resp.json());
        }
        catch (e) {
            logger.debug({ err: e }, 'Erro de rede em res.php (tentando novamente)');
            await (0, sleep_1.sleep)(POLL_INTERVAL_MS);
            continue;
        }
        const isFinal = data.status === 1 || data.request !== 'CAPCHA_NOT_READY';
        if (isFinal || pollCount === 1) {
            (0, captcha_report_1.reportApiResponse)({
                apiVersion: 'v1',
                endpoint: RES_URL,
                response: {
                    status: data.status,
                    request: data.status === 1
                        ? `(token len=${data.request?.length ?? 0})`
                        : data.request,
                    pollCount,
                },
                elapsedMs: Date.now() - pollInicio,
            });
        }
        if (data.status === 1) {
            (0, captcha_report_1.reportTokenRecebido)({
                apiVersion: 'v1',
                taskId: captchaId,
                tokenLength: data.request.length,
                tokenPrefix: data.request.slice(0, 12),
            });
            logger.info('Token do hCaptcha recebido do 2captcha (v1)');
            return data.request;
        }
        if (data.request !== 'CAPCHA_NOT_READY') {
            const msg = `Erro do 2captcha (v1): ${data.request}`;
            (0, captcha_report_1.reportCaptchaFalha)({ etapa: 'res.php', erro: msg });
            throw new CaptchaError(msg);
        }
        await (0, sleep_1.sleep)(POLL_INTERVAL_MS);
    }
    const msg = `Timeout aguardando solução do hCaptcha (v1) após ${pollCount} polls`;
    (0, captcha_report_1.reportCaptchaFalha)({ etapa: 'res.php', erro: msg });
    throw new CaptchaError(msg);
}
//# sourceMappingURL=captcha-solver.js.map