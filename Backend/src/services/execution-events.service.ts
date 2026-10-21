/**
 * Serviço de eventos SSE para execuções em tempo real.
 * Emite started, stage, counts, finished, login_ready e fiscal (UI-01e-B).
 * Formato dos eventos legados permanece inalterado.
 */
import { Response } from 'express';
import type { ProgressoFiscalNfse } from '../automation/nfse/progresso-fiscal';

export type ExecutionEventType =
  | 'execution:started'
  | 'execution:stage'
  | 'execution:counts'
  | 'execution:finished'
  | 'execution:fiscal';

export interface ExecutionEventStarted {
  type: 'execution:started';
  empresa_id: string;
  cnpj: string;
  razao_social?: string;
  metodo: 'CERTIFICADO' | 'CREDENCIAL';
}

export interface ExecutionEventStage {
  type: 'execution:stage';
  empresa_id: string;
  stage: string;
  message: string;
}

export interface ExecutionEventCounts {
  type: 'execution:counts';
  empresa_id: string;
  qtd_emitidas: number;
  qtd_recebidas: number;
  qtd_canceladas?: number;
}

export interface ExecutionEventFinished {
  type: 'execution:finished';
  empresa_id: string;
  status: 'OK' | 'ERRO';
  message?: string;
  qtd_emitidas?: number;
  qtd_recebidas?: number;
  qtd_canceladas?: number;
  resultado_final?: string;
}

export interface ExecutionEventLoginReady {
  type: 'execution:login_ready';
  empresa_id: string;
  message: string;
}

/** Progresso fiscal estruturado — mesmo canal SSE; só com batchId real. */
export interface ExecutionEventFiscal {
  type: 'execution:fiscal';
  batch_id: string;
  empresa_id: string;
  execucao_id: string;
  cnpj: string;
  fiscal: ProgressoFiscalNfse;
}

export type ExecutionEvent =
  | ExecutionEventStarted
  | ExecutionEventStage
  | ExecutionEventCounts
  | ExecutionEventFinished
  | ExecutionEventLoginReady
  | ExecutionEventFiscal;

interface BatchClients {
  clients: Set<Response>;
}

const batchClients = new Map<string, BatchClients>();
const PING_INTERVAL_MS = 15000;

function emitEvent(res: Response, event: string, data: object): void {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    /* client disconnected */
  }
}

export function registrarClienteSSE(batchId: string, res: Response): void {
  let batch = batchClients.get(batchId);
  if (!batch) {
    batch = { clients: new Set() };
    batchClients.set(batchId, batch);
  }
  batch.clients.add(res);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  res.on('close', () => {
    batch?.clients.delete(res);
    if (batch && batch.clients.size === 0) {
      batchClients.delete(batchId);
    }
  });

  const pingInterval = setInterval(() => {
    if (res.writableEnded) {
      clearInterval(pingInterval);
      return;
    }
    try {
      res.write(': ping\n\n');
    } catch {
      clearInterval(pingInterval);
    }
  }, PING_INTERVAL_MS);

  res.on('close', () => clearInterval(pingInterval));
}

export function emitirEventoExecucao(batchId: string | undefined, evento: ExecutionEvent): void {
  if (!batchId) return;
  const batch = batchClients.get(batchId);
  if (!batch) return;

  const eventType = evento.type.replace('execution:', '') as
    | 'started'
    | 'stage'
    | 'counts'
    | 'finished'
    | 'login_ready'
    | 'fiscal';
  for (const res of batch.clients) {
    if (!res.writableEnded) {
      emitEvent(res, eventType, evento);
    }
  }
}

/**
 * Emite `execution:fiscal` somente com batchId real e associação lote/empresa/execução.
 * Sem batchId (ex.: homologação admin UDS) → não emite SSE artificial.
 */
export function emitirProgressoFiscalSeAssociado(params: {
  batchId: string | undefined | null;
  empresaId: string;
  execucaoId: string;
  cnpj: string;
  fiscal: ProgressoFiscalNfse;
}): boolean {
  const batchId = params.batchId?.trim();
  if (!batchId) return false;
  if (!params.empresaId || !params.execucaoId) return false;
  if (params.fiscal.batch_id !== null && params.fiscal.batch_id !== batchId) return false;
  if (params.fiscal.empresa_id !== params.empresaId) return false;
  if (params.fiscal.execucao_id !== params.execucaoId) return false;

  emitirEventoExecucao(batchId, {
    type: 'execution:fiscal',
    batch_id: batchId,
    empresa_id: params.empresaId,
    execucao_id: params.execucaoId,
    cnpj: params.cnpj,
    fiscal: { ...params.fiscal, batch_id: batchId },
  });
  return true;
}
