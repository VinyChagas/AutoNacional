/**
 * Helpers de resposta padronizada: { success, data } / { success: false, detail }.
 * Usar em rotas unificadas (Empresas, Imports).
 */
import { Response } from 'express';
import { jsonSuccess, jsonError } from '../middleware/response';

/**
 * Resposta de sucesso: { success: true, data }
 */
export function wrapSuccess<T>(res: Response, data: T, status = 200): Response {
  return jsonSuccess(res, data, status);
}

/**
 * Resposta de erro: { success: false, detail } com status HTTP.
 */
export function wrapError(res: Response, status: number, detail: string): Response {
  return jsonError(res, detail, status);
}
