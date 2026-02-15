/**
 * Middleware de tratamento de erros global.
 * Padroniza respostas de erro e log.
 */
import { Request, Response, NextFunction } from 'express';
export declare class AppError extends Error {
    readonly statusCode: number;
    readonly message: string;
    readonly code?: string | undefined;
    constructor(statusCode: number, message: string, code?: string | undefined);
}
export declare function isAppError(err: unknown): err is AppError;
/**
 * Middleware: captura erros e retorna JSON padronizado.
 */
export declare function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void;
/**
 * Wrapper para rotas async - repassa erros ao errorHandler.
 */
export declare function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>): (req: Request, res: Response, next: NextFunction) => void;
//# sourceMappingURL=error-handler.d.ts.map