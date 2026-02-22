/**
 * Helpers de resposta padronizada: { success, data } / { success: false, detail }.
 * Usar em rotas unificadas (Empresas, Imports).
 */
import { Response } from 'express';
/**
 * Resposta de sucesso: { success: true, data }
 */
export declare function wrapSuccess<T>(res: Response, data: T, status?: number): Response;
/**
 * Resposta de erro: { success: false, detail } com status HTTP.
 */
export declare function wrapError(res: Response, status: number, detail: string): Response;
//# sourceMappingURL=api-response.d.ts.map