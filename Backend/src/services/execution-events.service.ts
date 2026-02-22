/**
 * Serviço de eventos SSE para execuções em tempo real.
 * Emite execution:started, execution:stage, execution:counts, execution:finished.
 */
import { Response } from 'express';

export type ExecutionEventType =
  | 'execution:started'
  | 'execution:stage'
  | 'execution:counts'
  | 'execution:finished';

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
}

export type ExecutionEvent =
  | ExecutionEventStarted
  | ExecutionEventStage
  | ExecutionEventCounts
  | ExecutionEventFinished;

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

  const eventType = evento.type.replace('execution:', '') as 'started' | 'stage' | 'counts' | 'finished';
  for (const res of batch.clients) {
    if (!res.writableEnded) {
      emitEvent(res, eventType, evento);
    }
  }
}
