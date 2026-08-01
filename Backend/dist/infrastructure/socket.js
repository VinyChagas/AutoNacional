"use strict";
/**
 * Inicialização do Socket.IO para a Central Manual de Captchas.
 * Mantém o SSE de execução intacto.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.initSocketIo = initSocketIo;
const socket_io_1 = require("socket.io");
const config_1 = require("./config");
const logger_1 = require("./logger");
const manual_captcha_service_1 = require("../services/manual-captcha.service");
const logger = (0, logger_1.getLogger)('socket');
function initSocketIo(httpServer) {
    const io = new socket_io_1.Server(httpServer, {
        cors: {
            origin: config_1.CORS_ORIGINS.length > 0 ? config_1.CORS_ORIGINS : ['http://localhost:1234'],
            credentials: true,
            methods: ['GET', 'POST'],
        },
        path: '/socket.io',
        // frames JPEG base64 podem ser grandes
        maxHttpBufferSize: 5e6,
    });
    (0, manual_captcha_service_1.setManualCaptchaSocketServer)(io);
    io.on('connection', (socket) => {
        logger.debug({ socketId: socket.id }, 'Cliente Socket.IO conectado');
        socket.on('captcha:join-batch', (payload, ack) => {
            const batchId = typeof payload?.batchId === 'string' ? payload.batchId.trim() : '';
            if (!batchId) {
                ack?.({ ok: false, error: 'INVALID_BATCH' });
                return;
            }
            const room = (0, manual_captcha_service_1.roomName)(batchId);
            void socket.join(room);
            const pending = (0, manual_captcha_service_1.listPendingByBatch)(batchId);
            socket.emit('captcha:batch-state', { batchId, captchas: pending });
            ack?.({ ok: true, pending: pending.length });
            logger.debug({ socketId: socket.id, batchId, pending: pending.length }, 'Socket entrou na sala de captchas');
        });
        socket.on('captcha:leave-batch', (payload, ack) => {
            const batchId = typeof payload?.batchId === 'string' ? payload.batchId.trim() : '';
            if (!batchId) {
                ack?.({ ok: false, error: 'INVALID_BATCH' });
                return;
            }
            void socket.leave((0, manual_captcha_service_1.roomName)(batchId));
            ack?.({ ok: true });
        });
        socket.on('captcha:click', (payload, ack) => {
            void (async () => {
                const result = await (0, manual_captcha_service_1.handleRemoteClick)({
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
        });
        socket.on('captcha:refresh', (payload, ack) => {
            void (async () => {
                const result = await (0, manual_captcha_service_1.handleRemoteRefresh)({
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
        });
        socket.on('captcha:confirm', (payload, ack) => {
            void (async () => {
                const result = await (0, manual_captcha_service_1.handleRemoteConfirm)({
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
        });
        socket.on('captcha:resolve', (payload, ack) => {
            const result = (0, manual_captcha_service_1.resolveCaptcha)({
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
        });
        socket.on('captcha:skip', (payload, ack) => {
            const result = (0, manual_captcha_service_1.skipCaptcha)({
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
        });
        socket.on('disconnect', (reason) => {
            logger.debug({ socketId: socket.id, reason }, 'Cliente Socket.IO desconectado');
        });
    });
    logger.info('Socket.IO inicializado para Central de Captchas (remote_click)');
    return io;
}
//# sourceMappingURL=socket.js.map