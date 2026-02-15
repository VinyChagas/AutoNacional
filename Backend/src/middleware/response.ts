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
export function jsonSuccess<T>(res: Response, data?: T, status = 200): Response {
  const body: ApiSuccess<T> = { success: true };
  if (data !== undefined) body.data = data;
  return res.status(status).json(body);
}

/**
 * Resposta de sucesso com mensagem (ex.: criação).
 */
export function jsonCreated<T>(
  res: Response,
  data?: T,
  message?: string
): Response {
  const body: ApiSuccess<T> = { success: true };
  if (data !== undefined) body.data = data;
  if (message) body.message = message;
  return res.status(201).json(body);
}

/**
 * Resposta de erro padronizada.
 */
export function jsonError(
  res: Response,
  detail: string,
  status = 400,
  code?: string
): Response {
  const body: ApiError = { success: false, detail };
  if (code) body.code = code;
  return res.status(status).json(body);
}
