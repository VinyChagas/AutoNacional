/**
 * Middleware de tratamento de erros global.
 * Padroniza respostas de erro e log.
 */
import { Request, Response, NextFunction } from 'express';
import { jsonError } from './response';
import { getLogger } from '../infrastructure/logger';

const logger = getLogger('error-handler');

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly message: string,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

/**
 * Middleware: captura erros e retorna JSON padronizado.
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (isAppError(err)) {
    logger.warn({ statusCode: err.statusCode, message: err.message }, 'AppError');
    jsonError(res, err.message, err.statusCode, err.code);
    return;
  }

  if (err && typeof err === 'object' && 'code' in err) {
    const multerErr = err as { code?: string; field?: string };
    if (multerErr.code === 'LIMIT_FILE_SIZE') {
      jsonError(res, 'Arquivo muito grande. Limite: 10MB', 413, 'LIMIT_FILE_SIZE');
      return;
    }
    if (multerErr.code === 'LIMIT_FILE_COUNT') {
      jsonError(res, 'Quantidade de arquivos excedida', 413, 'LIMIT_FILE_COUNT');
      return;
    }
    if (multerErr.code === 'LIMIT_UNEXPECTED_FILE') {
      jsonError(
        res,
        `Campo de arquivo inesperado: ${multerErr.field || '?'}`,
        400,
        'LIMIT_UNEXPECTED_FILE'
      );
      return;
    }
  }

  logger.error({ err }, 'Erro não tratado');
  const message =
    process.env.NODE_ENV === 'production'
      ? 'Erro interno do servidor'
      : (err as Error)?.message || 'Erro desconhecido';
  jsonError(res, message, 500, 'INTERNAL_ERROR');
}

/**
 * Wrapper para rotas async - repassa erros ao errorHandler.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
