/**
 * Inicialização do Socket.IO para a Central Manual de Captchas.
 * Mantém o SSE de execução intacto.
 */

import type { Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { CORS_ORIGINS } from './config';
import { getLogger } from './logger';
import {
  setManualCaptchaSocketServer,
  roomName,
  listPendingByBatch,
  resolveCaptcha,
  skipCaptcha,
  handleRemoteClick,
  handleRemoteRefresh,
  handleRemoteConfirm,
} from '../services/manual-captcha.service';

const logger = getLogger('socket');

export function initSocketIo(httpServer: HttpServer): SocketServer {
  const io = new SocketServer(httpServer, {
    cors: {
      origin: CORS_ORIGINS.length > 0 ? CORS_ORIGINS : ['http://localhost:1234'],
      credentials: true,
      methods: ['GET', 'POST'],
    },
    path: '/socket.io',
    // frames JPEG base64 podem ser grandes
    maxHttpBufferSize: 5e6,
  });

  setManualCaptchaSocketServer(io);

  io.on('connection', (socket) => {
    logger.debug({ socketId: socket.id }, 'Cliente Socket.IO conectado');

    socket.on('captcha:join-batch', (payload: { batchId?: string }, ack?: (r: unknown) => void) => {
      const batchId = typeof payload?.batchId === 'string' ? payload.batchId.trim() : '';
      if (!batchId) {
        ack?.({ ok: false, error: 'INVALID_BATCH' });
        return;
      }
      const room = roomName(batchId);
      void socket.join(room);
      const pending = listPendingByBatch(batchId);
      socket.emit('captcha:batch-state', { batchId, captchas: pending });
      ack?.({ ok: true, pending: pending.length });
      logger.debug({ socketId: socket.id, batchId, pending: pending.length }, 'Socket entrou na sala de captchas');
    });

    socket.on('captcha:leave-batch', (payload: { batchId?: string }, ack?: (r: unknown) => void) => {
      const batchId = typeof payload?.batchId === 'string' ? payload.batchId.trim() : '';
      if (!batchId) {
        ack?.({ ok: false, error: 'INVALID_BATCH' });
        return;
      }
      void socket.leave(roomName(batchId));
      ack?.({ ok: true });
    });

    socket.on(
      'captcha:click',
      (
        payload: {
          batchId?: string;
          captchaId?: string;
          xNorm?: number;
          yNorm?: number;
        },
        ack?: (r: unknown) => void
      ) => {
        void (async () => {
          const result = await handleRemoteClick({
            batchId: String(payload?.batchId ?? ''),
            captchaId: String(payload?.captchaId ?? ''),
            xNorm: Number(payload?.xNorm),
            yNorm: Number(payload?.yNorm),
          });
          ack?.(result);
          if (!result.ok) {
            socket.emit('captcha:error', {
              captchaId: payload?.captchaId,
              error: result.error,
              message: result.message,
            });
          }
        })();
      }
    );

    socket.on(
      'captcha:refresh',
      (
        payload: { batchId?: string; captchaId?: string },
        ack?: (r: unknown) => void
      ) => {
        void (async () => {
          const result = await handleRemoteRefresh({
            batchId: String(payload?.batchId ?? ''),
            captchaId: String(payload?.captchaId ?? ''),
          });
          ack?.(result);
          if (!result.ok) {
            socket.emit('captcha:error', {
              captchaId: payload?.captchaId,
              error: result.error,
              message: result.message,
            });
          }
        })();
      }
    );

    socket.on(
      'captcha:confirm',
      (
        payload: { batchId?: string; captchaId?: string },
        ack?: (r: unknown) => void
      ) => {
        void (async () => {
          const result = await handleRemoteConfirm({
            batchId: String(payload?.batchId ?? ''),
            captchaId: String(payload?.captchaId ?? ''),
          });
          ack?.(result);
          if (!result.ok) {
            socket.emit('captcha:error', {
              captchaId: payload?.captchaId,
              error: result.error,
              message: result.message,
            });
          }
        })();
      }
    );

    socket.on(
      'captcha:resolve',
      (
        payload: {
          batchId?: string;
          captchaId?: string;
          token?: string;
          attemptId?: string;
        },
        ack?: (r: unknown) => void
      ) => {
        const result = resolveCaptcha({
          batchId: String(payload?.batchId ?? ''),
          captchaId: String(payload?.captchaId ?? ''),
          token: String(payload?.token ?? ''),
          attemptId: payload?.attemptId ? String(payload.attemptId) : undefined,
        });
        ack?.(result);
        if (!result.ok) {
          socket.emit('captcha:error', {
            captchaId: payload?.captchaId,
            attemptId: payload?.attemptId,
            error: result.error,
            message: result.message,
          });
        }
      }
    );

    socket.on(
      'captcha:skip',
      (
        payload: { batchId?: string; captchaId?: string },
        ack?: (r: unknown) => void
      ) => {
        const result = skipCaptcha({
          batchId: String(payload?.batchId ?? ''),
          captchaId: String(payload?.captchaId ?? ''),
        });
        ack?.(result);
        if (!result.ok) {
          socket.emit('captcha:error', {
            captchaId: payload?.captchaId,
            error: result.error,
            message: result.message,
          });
        }
      }
    );

    socket.on('disconnect', (reason) => {
      logger.debug({ socketId: socket.id, reason }, 'Cliente Socket.IO desconectado');
    });
  });

  logger.info('Socket.IO inicializado para Central de Captchas (remote_click)');
  return io;
}
