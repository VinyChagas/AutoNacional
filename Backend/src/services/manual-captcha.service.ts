/**
 * Serviço em memória para desafios hCaptcha da Central Manual.
 * Modo atual: remote_click (screenshot + cliques no Playwright).
 * Mantém resolveCaptcha(token) para compatibilidade/testes.
 */

import { randomUUID } from 'crypto';
import type { Server as SocketServer } from 'socket.io';
import { getLogger } from '../infrastructure/logger';
import {
  MANUAL_CAPTCHA_TIMEOUT_MS,
  CAPTCHA_DEBUG,
} from '../infrastructure/config';
import type {
  CaptchaRequest,
  ManualCaptchaRequest,
  ManualCaptchaResult,
} from '../automation/captcha/types';
import {
  fingerprintToken,
  payloadFingerprint,
  recordTokenHash,
  appendEvidence,
  isCaptchaDebug,
} from '../automation/captcha-diagnostic';

const logger = getLogger('manual-captcha');

const MAX_TOKEN_LENGTH = 8000;

export type ManualCaptchaAck =
  | {
      ok: true;
      captchaId: string;
      attemptId: string;
      tokenLength: number;
      tokenHash: string;
      receivedAt: string;
    }
  | { ok: false; error: string; message?: string };

export interface CaptchaFramePayload {
  captchaId: string;
  attemptId: string;
  batchId: string;
  seq: number;
  mime: 'image/jpeg' | 'image/png';
  base64: string;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
  capturedAt: string;
}

export interface RemoteCaptchaHandlers {
  onClick: (input: {
    xNorm: number;
    yNorm: number;
  }) => Promise<{
    ok: boolean;
    modalClosed?: boolean;
    error?: string;
    message?: string;
  }>;
  onRefresh: () => Promise<{
    ok: boolean;
    error?: string;
    message?: string;
  }>;
  onConfirm: () => Promise<{
    ok: boolean;
    modalClosed?: boolean;
    error?: string;
    message?: string;
  }>;
}

interface PendingManualCaptcha {
  request: ManualCaptchaRequest;
  resolve: (result: ManualCaptchaResult) => void;
  timeout: NodeJS.Timeout;
  settled: boolean;
  handlers?: RemoteCaptchaHandlers;
  actionBusy: boolean;
}

type EmitFn = (batchId: string, event: string, payload: unknown) => void;

let ioEmit: EmitFn | null = null;
let socketServer: SocketServer | null = null;

const pending = new Map<string, PendingManualCaptcha>();
const byBatch = new Map<string, Set<string>>();
const byExecution = new Map<string, Set<string>>();

export function setManualCaptchaSocketServer(io: SocketServer): void {
  socketServer = io;
  ioEmit = (batchId, event, payload) => {
    io.to(roomName(batchId)).emit(event, payload);
  };
}

export function roomName(batchId: string): string {
  return `captcha-batch:${batchId}`;
}

function indexAdd(batchId: string, executionId: string, captchaId: string): void {
  let batchSet = byBatch.get(batchId);
  if (!batchSet) {
    batchSet = new Set();
    byBatch.set(batchId, batchSet);
  }
  batchSet.add(captchaId);

  let execSet = byExecution.get(executionId);
  if (!execSet) {
    execSet = new Set();
    byExecution.set(executionId, execSet);
  }
  execSet.add(captchaId);
}

function indexRemove(batchId: string, executionId: string, captchaId: string): void {
  const batchSet = byBatch.get(batchId);
  if (batchSet) {
    batchSet.delete(captchaId);
    if (batchSet.size === 0) byBatch.delete(batchId);
  }
  const execSet = byExecution.get(executionId);
  if (execSet) {
    execSet.delete(captchaId);
    if (execSet.size === 0) byExecution.delete(executionId);
  }
}

function settle(
  captchaId: string,
  result: ManualCaptchaResult,
  emitEvent?: string
): boolean {
  const entry = pending.get(captchaId);
  if (!entry || entry.settled) return false;

  entry.settled = true;
  clearTimeout(entry.timeout);
  pending.delete(captchaId);
  indexRemove(entry.request.batchId, entry.request.executionId, captchaId);

  try {
    entry.resolve(result);
  } catch (err) {
    logger.error({ err, captchaId }, 'Erro ao resolver Promise do captcha manual');
  }

  if (emitEvent && ioEmit) {
    ioEmit(entry.request.batchId, emitEvent, {
      captchaId,
      attemptId: entry.request.attemptId,
      batchId: entry.request.batchId,
      executionId: entry.request.executionId,
      empresaId: entry.request.empresaId,
      status: result.status,
    });
  }

  return true;
}

function buildRequest(input: CaptchaRequest): ManualCaptchaRequest {
  const timeoutSeconds =
    input.timeoutSeconds ??
    Math.max(1, Math.round(MANUAL_CAPTCHA_TIMEOUT_MS / 1000));
  const captchaId = randomUUID();
  const attemptId = input.attemptId || randomUUID();
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + timeoutSeconds * 1000);

  const fingerprint = payloadFingerprint({
    captchaId,
    attemptId,
    siteKey: input.siteKey,
    pageUrl: input.pageUrl,
    rqdata: input.rqdata,
    action: input.action,
  });

  return {
    captchaId,
    attemptId,
    batchId: input.batchId,
    executionId: input.executionId,
    empresaId: input.empresaId,
    empresaNome: input.empresaNome,
    cnpj: input.cnpj,
    siteKey: input.siteKey,
    pageUrl: input.pageUrl,
    interactionMode: 'remote_click',
    ...(input.rqdata ? { rqdata: input.rqdata } : {}),
    ...(input.action ? { action: input.action } : {}),
    ...(input.userAgent ? { userAgent: input.userAgent } : {}),
    ...(input.callbackName ? { callbackName: input.callbackName } : {}),
    payloadFingerprint: fingerprint,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    timeoutSeconds,
    ...(CAPTCHA_DEBUG ? { debug: true } : {}),
  };
}

/**
 * Inicia sessão remota (screenshot + cliques). Retorna Promise + ids.
 */
export function beginRemoteCaptcha(
  input: CaptchaRequest,
  handlers: RemoteCaptchaHandlers
): {
  captchaId: string;
  attemptId: string;
  promise: Promise<ManualCaptchaResult>;
} {
  const request = buildRequest(input);
  const { captchaId, attemptId, timeoutSeconds } = request;

  if (isCaptchaDebug()) {
    logger.info(
      {
        evento: 'remote_captcha_created',
        captchaId,
        attemptId,
        batchId: request.batchId,
        executionId: request.executionId,
      },
      '[CAPTCHA_DEBUG] Sessão remote_click criada'
    );
  }

  const promise = new Promise<ManualCaptchaResult>((resolve) => {
    const timeout = setTimeout(() => {
      const ok = settle(
        captchaId,
        { status: 'TIMEOUT', captchaId, attemptId },
        'captcha:expired'
      );
      if (ok) {
        logger.info(
          {
            evento: 'manual_captcha_timeout',
            batchId: request.batchId,
            executionId: request.executionId,
            captchaId,
            attemptId,
            timeoutSeconds,
          },
          'Captcha manual (remote_click) expirou'
        );
      }
    }, timeoutSeconds * 1000);

    pending.set(captchaId, {
      request,
      resolve,
      timeout,
      settled: false,
      handlers,
      actionBusy: false,
    });
    indexAdd(request.batchId, request.executionId, captchaId);

    logger.info(
      {
        evento: 'manual_captcha_created',
        mode: 'remote_click',
        batchId: request.batchId,
        executionId: request.executionId,
        empresaId: request.empresaId,
        captchaId,
        attemptId,
        timeoutSeconds,
      },
      'Captcha manual remote_click criado'
    );

    if (ioEmit) {
      ioEmit(request.batchId, 'captcha:created', request);
    } else {
      logger.warn(
        { captchaId, batchId: request.batchId },
        'Socket.IO não inicializado — desafio criado sem broadcast'
      );
    }
  });

  return { captchaId, attemptId, promise };
}

export function publishCaptchaFrame(
  captchaId: string,
  frame: CaptchaFramePayload
): boolean {
  const entry = pending.get(captchaId);
  if (!entry || entry.settled) return false;
  if (entry.request.batchId !== frame.batchId) return false;

  entry.request.latestFrame = {
    seq: frame.seq,
    mime: frame.mime,
    base64: frame.base64,
    width: frame.width,
    height: frame.height,
    viewportWidth: frame.viewportWidth,
    viewportHeight: frame.viewportHeight,
    capturedAt: frame.capturedAt,
  };

  if (ioEmit) {
    ioEmit(entry.request.batchId, 'captcha:frame', frame);
  }
  return true;
}

export function completeRemoteCaptcha(
  captchaId: string,
  resolvedBy: 'remote_click' | 'confirm' = 'remote_click'
): boolean {
  const entry = pending.get(captchaId);
  if (!entry || entry.settled) return false;

  const resolvedAt = new Date().toISOString();
  const ok = settle(
    captchaId,
    {
      status: 'RESOLVED',
      captchaId,
      attemptId: entry.request.attemptId,
      resolvedAt,
      resolvedBy,
    },
    'captcha:resolved'
  );

  if (ok) {
    logger.info(
      {
        evento: 'manual_captcha_resolved',
        mode: 'remote_click',
        resolvedBy,
        batchId: entry.request.batchId,
        executionId: entry.request.executionId,
        captchaId,
        attemptId: entry.request.attemptId,
      },
      'Captcha remote_click concluído'
    );
  }
  return ok;
}

function validatePending(
  batchId: string,
  captchaId: string
):
  | { ok: true; entry: PendingManualCaptcha }
  | { ok: false; ack: ManualCaptchaAck } {
  if (!captchaId || !batchId) {
    return {
      ok: false,
      ack: {
        ok: false,
        error: 'INVALID_PAYLOAD',
        message: 'batchId e captchaId são obrigatórios',
      },
    };
  }
  const entry = pending.get(captchaId);
  if (!entry) {
    return {
      ok: false,
      ack: {
        ok: false,
        error: 'CAPTCHA_NOT_FOUND',
        message: 'Captcha inexistente ou já finalizado',
      },
    };
  }
  if (entry.settled) {
    return {
      ok: false,
      ack: {
        ok: false,
        error: 'CAPTCHA_ALREADY_SETTLED',
        message: 'Captcha já foi resolvido',
      },
    };
  }
  if (entry.request.batchId !== batchId) {
    return {
      ok: false,
      ack: {
        ok: false,
        error: 'BATCH_MISMATCH',
        message: 'Captcha não pertence a este lote',
      },
    };
  }
  if (new Date(entry.request.expiresAt).getTime() < Date.now()) {
    settle(
      captchaId,
      {
        status: 'TIMEOUT',
        captchaId,
        attemptId: entry.request.attemptId,
      },
      'captcha:expired'
    );
    return {
      ok: false,
      ack: { ok: false, error: 'CAPTCHA_EXPIRED', message: 'Captcha expirado' },
    };
  }
  return { ok: true, entry };
}

export async function handleRemoteClick(input: {
  batchId: string;
  captchaId: string;
  xNorm: number;
  yNorm: number;
}): Promise<ManualCaptchaAck> {
  const checked = validatePending(input.batchId, input.captchaId);
  if (!checked.ok) return checked.ack;

  const { entry } = checked;
  if (!entry.handlers?.onClick) {
    return {
      ok: false,
      error: 'NO_HANDLERS',
      message: 'Sessão sem handlers de clique',
    };
  }
  if (entry.actionBusy) {
    return { ok: false, error: 'BUSY', message: 'Ação em andamento' };
  }

  const xNorm = Number(input.xNorm);
  const yNorm = Number(input.yNorm);
  if (
    !Number.isFinite(xNorm) ||
    !Number.isFinite(yNorm) ||
    xNorm < 0 ||
    xNorm > 1 ||
    yNorm < 0 ||
    yNorm > 1
  ) {
    return {
      ok: false,
      error: 'INVALID_COORDS',
      message: 'Coordenadas normalizadas inválidas (0..1)',
    };
  }

  entry.actionBusy = true;
  try {
    const result = await entry.handlers.onClick({ xNorm, yNorm });
    if (!result.ok) {
      return {
        ok: false,
        error: result.error || 'CLICK_FAILED',
        message: result.message,
      };
    }
    // Republica frame após o clique
    await entry.handlers.onRefresh().catch(() => undefined);

    if (result.modalClosed) {
      completeRemoteCaptcha(input.captchaId, 'remote_click');
    }

    return {
      ok: true,
      captchaId: input.captchaId,
      attemptId: entry.request.attemptId,
      tokenLength: 0,
      tokenHash: '',
      receivedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      ok: false,
      error: 'CLICK_FAILED',
      message: (err as Error).message,
    };
  } finally {
    entry.actionBusy = false;
  }
}

export async function handleRemoteRefresh(input: {
  batchId: string;
  captchaId: string;
}): Promise<ManualCaptchaAck> {
  const checked = validatePending(input.batchId, input.captchaId);
  if (!checked.ok) return checked.ack;

  const { entry } = checked;
  if (!entry.handlers?.onRefresh) {
    return { ok: false, error: 'NO_HANDLERS', message: 'Sem handler de refresh' };
  }
  if (entry.actionBusy) {
    return { ok: false, error: 'BUSY', message: 'Ação em andamento' };
  }

  entry.actionBusy = true;
  try {
    const result = await entry.handlers.onRefresh();
    if (!result.ok) {
      return {
        ok: false,
        error: result.error || 'REFRESH_FAILED',
        message: result.message,
      };
    }
    return {
      ok: true,
      captchaId: input.captchaId,
      attemptId: entry.request.attemptId,
      tokenLength: 0,
      tokenHash: '',
      receivedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      ok: false,
      error: 'REFRESH_FAILED',
      message: (err as Error).message,
    };
  } finally {
    entry.actionBusy = false;
  }
}

export async function handleRemoteConfirm(input: {
  batchId: string;
  captchaId: string;
}): Promise<ManualCaptchaAck> {
  const checked = validatePending(input.batchId, input.captchaId);
  if (!checked.ok) return checked.ack;

  const { entry } = checked;
  if (!entry.handlers?.onConfirm) {
    return { ok: false, error: 'NO_HANDLERS', message: 'Sem handler de confirm' };
  }
  if (entry.actionBusy) {
    return { ok: false, error: 'BUSY', message: 'Ação em andamento' };
  }

  entry.actionBusy = true;
  try {
    const result = await entry.handlers.onConfirm();
    if (!result.ok) {
      return {
        ok: false,
        error: result.error || 'CONFIRM_FAILED',
        message: result.message,
      };
    }
    await entry.handlers.onRefresh().catch(() => undefined);

    if (result.modalClosed) {
      completeRemoteCaptcha(input.captchaId, 'confirm');
    }

    return {
      ok: true,
      captchaId: input.captchaId,
      attemptId: entry.request.attemptId,
      tokenLength: 0,
      tokenHash: '',
      receivedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      ok: false,
      error: 'CONFIRM_FAILED',
      message: (err as Error).message,
    };
  } finally {
    entry.actionBusy = false;
  }
}

/**
 * Cria desafio legado (token). Preferir beginRemoteCaptcha no fluxo MANUAL.
 */
export function requestCaptcha(
  input: CaptchaRequest
): Promise<ManualCaptchaResult> {
  const request = buildRequest(input);
  // modo legado marca interactionMode token (testes)
  request.interactionMode = 'token';
  const { captchaId, attemptId, timeoutSeconds } = request;

  if (isCaptchaDebug()) {
    appendEvidence(
      attemptId,
      `payload_published fingerprint=${request.payloadFingerprint} siteKeyLen=${request.siteKey.length}`
    );
  }

  return new Promise<ManualCaptchaResult>((resolve) => {
    const timeout = setTimeout(() => {
      settle(
        captchaId,
        { status: 'TIMEOUT', captchaId, attemptId },
        'captcha:expired'
      );
    }, timeoutSeconds * 1000);

    pending.set(captchaId, {
      request,
      resolve,
      timeout,
      settled: false,
      actionBusy: false,
    });
    indexAdd(request.batchId, request.executionId, captchaId);

    if (ioEmit) {
      ioEmit(request.batchId, 'captcha:created', request);
    }

    logger.info(
      {
        evento: 'manual_captcha_created',
        mode: 'token',
        captchaId,
        attemptId,
        batchId: request.batchId,
      },
      'Captcha manual (token) criado'
    );
  });
}

export function resolveCaptcha(input: {
  batchId: string;
  captchaId: string;
  token: string;
  attemptId?: string;
}): ManualCaptchaAck {
  const { batchId, captchaId } = input;
  const token = typeof input.token === 'string' ? input.token.trim() : '';

  if (!captchaId || !batchId) {
    return { ok: false, error: 'INVALID_PAYLOAD', message: 'batchId e captchaId são obrigatórios' };
  }
  if (!token) {
    return { ok: false, error: 'EMPTY_TOKEN', message: 'Token vazio' };
  }
  if (token.length > MAX_TOKEN_LENGTH) {
    return { ok: false, error: 'TOKEN_TOO_LONG', message: 'Token excede o tamanho máximo' };
  }

  const entry = pending.get(captchaId);
  if (!entry) {
    return { ok: false, error: 'CAPTCHA_NOT_FOUND', message: 'Captcha inexistente ou já finalizado' };
  }
  if (entry.settled) {
    return { ok: false, error: 'CAPTCHA_ALREADY_SETTLED', message: 'Captcha já foi resolvido' };
  }
  if (entry.request.batchId !== batchId) {
    return { ok: false, error: 'BATCH_MISMATCH', message: 'Captcha não pertence a este lote' };
  }
  if (
    input.attemptId &&
    entry.request.attemptId &&
    input.attemptId !== entry.request.attemptId
  ) {
    return {
      ok: false,
      error: 'ATTEMPT_MISMATCH',
      message: 'attemptId não corresponde ao desafio pendente',
    };
  }
  if (new Date(entry.request.expiresAt).getTime() < Date.now()) {
    settle(
      captchaId,
      {
        status: 'TIMEOUT',
        captchaId,
        attemptId: entry.request.attemptId,
      },
      'captcha:expired'
    );
    return { ok: false, error: 'CAPTCHA_EXPIRED', message: 'Captcha expirado' };
  }

  const resolvedAt = new Date().toISOString();
  const fp = fingerprintToken(token);
  recordTokenHash(entry.request.attemptId, 'socket', token);
  recordTokenHash(entry.request.attemptId, 'service', token);

  const ok = settle(
    captchaId,
    {
      status: 'RESOLVED',
      captchaId,
      attemptId: entry.request.attemptId,
      token,
      resolvedAt,
      resolvedBy: 'token',
    },
    'captcha:resolved'
  );

  if (!ok) {
    return { ok: false, error: 'CAPTCHA_ALREADY_SETTLED', message: 'Captcha já foi resolvido' };
  }

  return {
    ok: true,
    captchaId,
    attemptId: entry.request.attemptId,
    tokenLength: fp.tokenLength,
    tokenHash: fp.tokenHash,
    receivedAt: resolvedAt,
  };
}

export function skipCaptcha(input: {
  batchId: string;
  captchaId: string;
}): ManualCaptchaAck {
  const checked = validatePending(input.batchId, input.captchaId);
  // skip permite mesmo se expired acabou de settle? validatePending settles expired
  if (!checked.ok) {
    // se não encontrado, retorno direto; se expired, também
    return checked.ack;
  }

  const { entry } = checked;
  const ok = settle(
    input.captchaId,
    {
      status: 'SKIPPED',
      captchaId: input.captchaId,
      attemptId: entry.request.attemptId,
    },
    'captcha:removed'
  );
  if (!ok) {
    return { ok: false, error: 'CAPTCHA_ALREADY_SETTLED', message: 'Captcha já finalizado' };
  }

  logger.info(
    {
      evento: 'manual_captcha_skipped',
      batchId: input.batchId,
      captchaId: input.captchaId,
      attemptId: entry.request.attemptId,
    },
    'Captcha manual pulado'
  );

  return {
    ok: true,
    captchaId: input.captchaId,
    attemptId: entry.request.attemptId,
    tokenLength: 0,
    tokenHash: '',
    receivedAt: new Date().toISOString(),
  };
}

export function cancelByExecution(executionId: string, reason?: string): void {
  const ids = [...(byExecution.get(executionId) ?? [])];
  for (const captchaId of ids) {
    const entry = pending.get(captchaId);
    settle(
      captchaId,
      {
        status: 'CANCELLED',
        captchaId,
        attemptId: entry?.request.attemptId || '',
        reason: reason || 'execution_finished',
      },
      'captcha:removed'
    );
  }
  if (ids.length > 0) {
    logger.info(
      {
        evento: 'manual_captcha_cancelled',
        executionId,
        count: ids.length,
        reason: reason || 'execution_finished',
      },
      'Captchas cancelados por execução'
    );
  }
}

export function cancelByBatch(batchId: string, reason?: string): void {
  const ids = [...(byBatch.get(batchId) ?? [])];
  for (const captchaId of ids) {
    const entry = pending.get(captchaId);
    settle(
      captchaId,
      {
        status: 'CANCELLED',
        captchaId,
        attemptId: entry?.request.attemptId || '',
        reason: reason || 'batch_finished',
      },
      'captcha:removed'
    );
  }
}

/** Snapshot dos desafios pendentes (inclui latestFrame se houver). */
export function listPendingByBatch(batchId: string): ManualCaptchaRequest[] {
  const ids = byBatch.get(batchId);
  if (!ids) return [];
  const out: ManualCaptchaRequest[] = [];
  for (const id of ids) {
    const entry = pending.get(id);
    if (entry && !entry.settled) out.push(entry.request);
  }
  return out;
}

export function __getPendingCountForTests(): number {
  return pending.size;
}

export function __resetManualCaptchaStateForTests(): void {
  for (const [, entry] of pending) {
    clearTimeout(entry.timeout);
    if (!entry.settled) {
      entry.settled = true;
      entry.resolve({
        status: 'CANCELLED',
        captchaId: entry.request.captchaId,
        attemptId: entry.request.attemptId,
        reason: 'test_reset',
      });
    }
  }
  pending.clear();
  byBatch.clear();
  byExecution.clear();
}

export function getSocketServer(): SocketServer | null {
  return socketServer;
}
