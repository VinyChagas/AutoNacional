/**
 * Padronização de respostas JSON e helpers.
 */
import { Response } from 'express';
export interface ApiSuccess<T = unknown> {
    success: true;
    data?: T;
    message?: string;
}
export interface ApiError {
    success: false;
    detail: string;
    code?: string;
}
export type ApiResponse<T = unknown> = ApiSuccess<T> | ApiError;
/**
 * Resposta de sucesso padronizada.
 */
export declare function jsonSuccess<T>(res: Response, data?: T, status?: number): Response;
/**
 * Resposta de sucesso com mensagem (ex.: criação).
 */
export declare function jsonCreated<T>(res: Response, data?: T, message?: string): Response;
/**
 * Resposta de erro padronizada.
 */
export declare function jsonError(res: Response, detail: string, status?: number, code?: string): Response;
//# sourceMappingURL=response.d.ts.map