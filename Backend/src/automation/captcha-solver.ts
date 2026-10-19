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

import { getLogger } from '../infrastructure/logger';
import {
  TWOCAPTCHA_API_KEY,
  TWOCAPTCHA_API_VERSION,
  CAPTCHA_SOLVE_TIMEOUT_MS,
  CAPTCHA_IS_INVISIBLE,
  TWOCAPTCHA_PROXY_TYPE,
  TWOCAPTCHA_PROXY_ADDRESS,
  TWOCAPTCHA_PROXY_PORT,
  TWOCAPTCHA_PROXY_LOGIN,
  TWOCAPTCHA_PROXY_PASSWORD,
} from '../infrastructure/config';
import { sleep } from '../utils/sleep';
import {
  reportApiRequest,
  reportApiResponse,
  reportTokenRecebido,
  reportCaptchaFalha,
} from './captcha-report';

const logger = getLogger('captcha-solver');

const IN_URL = 'https://2captcha.com/in.php';
const RES_URL = 'https://2captcha.com/res.php';
const CREATE_TASK_URL = 'https://api.2captcha.com/createTask';
const GET_TASK_RESULT_URL = 'https://api.2captcha.com/getTaskResult';

const POLL_INTERVAL_MS = 5000;
const INITIAL_WAIT_MS = 12000;

export class CaptchaError extends Error {
  /** Código tipado da API 2Captcha (ex.: ERROR_CAPTCHA_UNSOLVABLE), quando disponível. */
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'CaptchaError';
    this.code = code || extractCodeFromMessage(message);
  }
}

function extractCodeFromMessage(message: string): string | undefined {
  const m = /ERROR_[A-Z0-9_]+/.exec(message);
  return m?.[0];
}

export function captchaConfigurado(): boolean {
  return Boolean(TWOCAPTCHA_API_KEY && TWOCAPTCHA_API_KEY.trim());
}

function proxyConfigurado(): boolean {
  return Boolean(
    TWOCAPTCHA_PROXY_TYPE &&
      TWOCAPTCHA_PROXY_ADDRESS &&
      TWOCAPTCHA_PROXY_PORT
  );
}

/**
 * Resolve hCaptcha e retorna o token.
 * @param sitekey - websiteKey / sitekey do widget
 * @param pageurl - URL da página (websiteURL)
 * @param options - userAgent e rqdata opcional (enterprisePayload).
 *                 rqdata só é enviado quando houver valor real não vazio.
 *                 Nunca use c.req como substituto; nunca envie "" ou null.
 */
export async function resolverHCaptcha(
  sitekey: string,
  pageurl: string,
  options?: { userAgent?: string; rqdata?: string }
): Promise<string> {
  if (!captchaConfigurado()) {
    throw new CaptchaError(
      'TWOCAPTCHA_API_KEY não configurada no .env',
      'ERROR_CONFIGURATION'
    );
  }

  const rqdata = normalizeRqdata(options?.rqdata);
  const opts = { userAgent: options?.userAgent, rqdata };

  if (TWOCAPTCHA_API_VERSION === 'v1') {
    return resolverV1(sitekey, pageurl, rqdata);
  }
  return resolverV2(sitekey, pageurl, opts);
}

/**
 * Retorna rqdata somente se for string com conteúdo real.
 * Caso contrário undefined — a propriedade deve ser omitida do payload.
 */
function normalizeRqdata(value?: string | null): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

// ============================================================================
// API v2 — createTask / getTaskResult
// ============================================================================

interface CreateTaskResponse {
  errorId: number;
  errorCode?: string;
  errorDescription?: string;
  taskId?: number;
}

interface GetTaskResultResponse {
  errorId: number;
  errorCode?: string;
  errorDescription?: string;
  status?: 'processing' | 'ready';
  solution?: { token?: string; gRecaptchaResponse?: string };
}

async function resolverV2(
  sitekey: string,
  pageurl: string,
  options?: { userAgent?: string; rqdata?: string }
): Promise<string> {
  const taskId = await criarTaskV2(sitekey, pageurl, options);
  logger.info(
    { taskId, hasRqdata: Boolean(normalizeRqdata(options?.rqdata)) },
    'Task criada no 2captcha (v2), aguardando solução…'
  );
  return aguardarSolucaoV2(taskId);
}

async function criarTaskV2(
  sitekey: string,
  pageurl: string,
  options?: { userAgent?: string; rqdata?: string }
): Promise<number> {
  const comProxy = proxyConfigurado();
  const task: Record<string, unknown> = {
    type: comProxy ? 'HCaptchaTask' : 'HCaptchaTaskProxyless',
    websiteURL: pageurl,
    websiteKey: sitekey,
    isInvisible: CAPTCHA_IS_INVISIBLE,
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
    task.proxyType = TWOCAPTCHA_PROXY_TYPE;
    task.proxyAddress = TWOCAPTCHA_PROXY_ADDRESS;
    task.proxyPort = TWOCAPTCHA_PROXY_PORT;
    if (TWOCAPTCHA_PROXY_LOGIN) task.proxyLogin = TWOCAPTCHA_PROXY_LOGIN;
    if (TWOCAPTCHA_PROXY_PASSWORD) task.proxyPassword = TWOCAPTCHA_PROXY_PASSWORD;
  }

  const requestBody = { clientKey: TWOCAPTCHA_API_KEY, task };
  reportApiRequest({
    apiVersion: 'v2',
    endpoint: CREATE_TASK_URL,
    body: requestBody,
  });

  const inicio = Date.now();
  let data: CreateTaskResponse;
  try {
    const resp = await fetch(CREATE_TASK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
    data = (await resp.json()) as CreateTaskResponse;
  } catch (e) {
    const msg = `Falha de rede ao criar task no 2captcha (v2): ${(e as Error).message}`;
    reportCaptchaFalha({ etapa: 'createTask', erro: msg });
    throw new CaptchaError(msg);
  }

  reportApiResponse({
    apiVersion: 'v2',
    endpoint: CREATE_TASK_URL,
    response: data,
    elapsedMs: Date.now() - inicio,
  });

  if (data.errorId && data.errorId !== 0) {
    const msg = `2captcha createTask: ${data.errorCode} — ${data.errorDescription}`;
    reportCaptchaFalha({ etapa: 'createTask', erro: msg });
    throw new CaptchaError(msg);
  }
  if (!data.taskId) {
    const msg = '2captcha createTask não retornou taskId';
    reportCaptchaFalha({ etapa: 'createTask', erro: msg });
    throw new CaptchaError(msg);
  }
  return data.taskId;
}

async function aguardarSolucaoV2(taskId: number): Promise<string> {
  const inicio = Date.now();
  await sleep(INITIAL_WAIT_MS);

  let pollCount = 0;
  while (Date.now() - inicio < CAPTCHA_SOLVE_TIMEOUT_MS) {
    pollCount += 1;
    let data: GetTaskResultResponse;
    const pollInicio = Date.now();
    try {
      const pollBody = { clientKey: TWOCAPTCHA_API_KEY, taskId };
      if (pollCount === 1) {
        reportApiRequest({
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
      data = (await resp.json()) as GetTaskResultResponse;
    } catch (e) {
      logger.debug({ err: e }, 'Erro de rede em getTaskResult (tentando novamente)');
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    const isFinal =
      (data.errorId && data.errorId !== 0) ||
      data.status === 'ready';
    if (isFinal || pollCount === 1) {
      reportApiResponse({
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
      reportCaptchaFalha({ etapa: 'getTaskResult', erro: msg });
      throw new CaptchaError(msg);
    }
    if (data.status === 'ready') {
      const token = data.solution?.token || data.solution?.gRecaptchaResponse;
      if (!token) {
        const msg = '2captcha retornou ready sem token na solução';
        reportCaptchaFalha({ etapa: 'getTaskResult', erro: msg });
        throw new CaptchaError(msg);
      }
      reportTokenRecebido({
        apiVersion: 'v2',
        taskId,
        tokenLength: token.length,
        tokenPrefix: token.slice(0, 12),
      });
      logger.info('Token do hCaptcha recebido do 2captcha (v2)');
      return token;
    }
    await sleep(POLL_INTERVAL_MS);
  }

  const msg = `Timeout aguardando solução do hCaptcha (v2) após ${pollCount} polls`;
  reportCaptchaFalha({ etapa: 'getTaskResult', erro: msg });
  throw new CaptchaError(msg);
}

// ============================================================================
// API v1 — in.php / res.php
// ============================================================================

interface TwoCaptchaV1Response {
  status: number;
  request: string;
}

async function resolverV1(
  sitekey: string,
  pageurl: string,
  rqdata?: string
): Promise<string> {
  const captchaId = await enviarCaptchaV1(sitekey, pageurl, rqdata);
  logger.info(
    { captchaId, hasRqdata: Boolean(rqdata) },
    'Captcha enviado ao 2captcha (v1), aguardando solução…'
  );
  return aguardarSolucaoV1(captchaId);
}

async function enviarCaptchaV1(
  sitekey: string,
  pageurl: string,
  rqdata?: string
): Promise<string> {
  const paramsObj: Record<string, string> = {
    key: TWOCAPTCHA_API_KEY,
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
  reportApiRequest({
    apiVersion: 'v1',
    endpoint: IN_URL,
    body: paramsObj,
  });

  const params = new URLSearchParams(paramsObj);
  const inicio = Date.now();
  let data: TwoCaptchaV1Response;
  try {
    const resp = await fetch(IN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    data = (await resp.json()) as TwoCaptchaV1Response;
  } catch (e) {
    const msg = `Falha de rede ao enviar captcha (v1): ${(e as Error).message}`;
    reportCaptchaFalha({ etapa: 'in.php', erro: msg });
    throw new CaptchaError(msg);
  }

  reportApiResponse({
    apiVersion: 'v1',
    endpoint: IN_URL,
    response: data,
    elapsedMs: Date.now() - inicio,
  });

  if (data.status !== 1) {
    const msg = `2captcha recusou o envio (v1): ${data.request}`;
    reportCaptchaFalha({ etapa: 'in.php', erro: msg });
    throw new CaptchaError(msg);
  }
  return data.request;
}

async function aguardarSolucaoV1(captchaId: string): Promise<string> {
  const inicio = Date.now();
  await sleep(INITIAL_WAIT_MS);

  const params = new URLSearchParams({
    key: TWOCAPTCHA_API_KEY,
    action: 'get',
    id: captchaId,
    json: '1',
  });
  const url = `${RES_URL}?${params.toString()}`;

  let pollCount = 0;
  while (Date.now() - inicio < CAPTCHA_SOLVE_TIMEOUT_MS) {
    pollCount += 1;
    let data: TwoCaptchaV1Response;
    const pollInicio = Date.now();
    try {
      if (pollCount === 1) {
        reportApiRequest({
          apiVersion: 'v1',
          endpoint: RES_URL,
          body: {
            key: TWOCAPTCHA_API_KEY,
            action: 'get',
            id: captchaId,
            json: '1',
          },
        });
      }
      const resp = await fetch(url);
      data = (await resp.json()) as TwoCaptchaV1Response;
    } catch (e) {
      logger.debug({ err: e }, 'Erro de rede em res.php (tentando novamente)');
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    const isFinal = data.status === 1 || data.request !== 'CAPCHA_NOT_READY';
    if (isFinal || pollCount === 1) {
      reportApiResponse({
        apiVersion: 'v1',
        endpoint: RES_URL,
        response: {
          status: data.status,
          request:
            data.status === 1
              ? `(token len=${data.request?.length ?? 0})`
              : data.request,
          pollCount,
        },
        elapsedMs: Date.now() - pollInicio,
      });
    }

    if (data.status === 1) {
      reportTokenRecebido({
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
      reportCaptchaFalha({ etapa: 'res.php', erro: msg });
      throw new CaptchaError(msg);
    }
    await sleep(POLL_INTERVAL_MS);
  }

  const msg = `Timeout aguardando solução do hCaptcha (v1) após ${pollCount} polls`;
  reportCaptchaFalha({ etapa: 'res.php', erro: msg });
  throw new CaptchaError(msg);
}
