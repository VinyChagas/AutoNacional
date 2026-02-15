"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppError = void 0;
exports.isAppError = isAppError;
exports.errorHandler = errorHandler;
exports.asyncHandler = asyncHandler;
const response_1 = require("./response");
const logger_1 = require("../infrastructure/logger");
const logger = (0, logger_1.getLogger)('error-handler');
class AppError extends Error {
    statusCode;
    message;
    code;
    constructor(statusCode, message, code) {
        super(message);
        this.statusCode = statusCode;
        this.message = message;
        this.code = code;
        this.name = 'AppError';
    }
}
exports.AppError = AppError;
function isAppError(err) {
    return err instanceof AppError;
}
/**
 * Middleware: captura erros e retorna JSON padronizado.
 */
function errorHandler(err, _req, res, _next) {
    if (isAppError(err)) {
        logger.warn({ statusCode: err.statusCode, message: err.message }, 'AppError');
        (0, response_1.jsonError)(res, err.message, err.statusCode, err.code);
        return;
    }
    if (err && typeof err === 'object' && 'code' in err) {
        const multerErr = err;
        if (multerErr.code === 'LIMIT_FILE_SIZE') {
            (0, response_1.jsonError)(res, 'Arquivo muito grande. Limite: 10MB', 413, 'LIMIT_FILE_SIZE');
            return;
        }
        if (multerErr.code === 'LIMIT_FILE_COUNT') {
            (0, response_1.jsonError)(res, 'Quantidade de arquivos excedida', 413, 'LIMIT_FILE_COUNT');
            return;
        }
        if (multerErr.code === 'LIMIT_UNEXPECTED_FILE') {
            (0, response_1.jsonError)(res, `Campo de arquivo inesperado: ${multerErr.field || '?'}`, 400, 'LIMIT_UNEXPECTED_FILE');
            return;
        }
    }
    logger.error({ err }, 'Erro não tratado');
    const message = process.env.NODE_ENV === 'production'
        ? 'Erro interno do servidor'
        : err?.message || 'Erro desconhecido';
    (0, response_1.jsonError)(res, message, 500, 'INTERNAL_ERROR');
}
/**
 * Wrapper para rotas async - repassa erros ao errorHandler.
 */
function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}
//# sourceMappingURL=error-handler.js.map