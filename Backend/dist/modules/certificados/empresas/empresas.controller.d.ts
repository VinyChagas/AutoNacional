/**
 * Controller de empresas - trata request/response.
 */
import { Request, Response } from 'express';
export declare function listar(req: Request, res: Response): Promise<void>;
export declare function obterPorId(req: Request, res: Response): Promise<void>;
export declare function listarPorContabilidade(req: Request, res: Response): Promise<void>;
export declare function obterPorCnpj(req: Request, res: Response): Promise<void>;
export declare function cadastroCertificado(req: Request, res: Response): Promise<void>;
export declare function excluirEmMassa(req: Request, res: Response): Promise<void>;
export declare function summary(req: Request, res: Response): Promise<void>;
export declare function cadastroCredencial(req: Request, res: Response): Promise<void>;
//# sourceMappingURL=empresas.controller.d.ts.map