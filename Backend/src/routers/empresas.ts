/**
 * Router legado de empresas: CRUD básico (POST criar, PUT atualizar, DELETE excluir).
 * Listagem e detalhes ficam no módulo unificado (empresas.routes).
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getLogger } from '../infrastructure/logger';
import { asyncHandler } from '../middleware/error-handler';
import { jsonSuccess, jsonError, jsonCreated } from '../middleware/response';
import * as repo from '../repositories/empresas';
import { normalizeCnpj } from '../utils/cnpj';

const logger = getLogger('empresas');
const router = Router();

const EmpresaCreateSchema = z.object({
  cnpj: z.string().refine(
    (v) => normalizeCnpj(v).length === 14 && /^\d+$/.test(normalizeCnpj(v)),
    { message: 'CNPJ deve conter 14 dígitos' }
  ),
  razao_social: z.string().min(1).optional(),
  razaoSocial: z.string().min(1).optional(),
  regime: z.string().optional(),
  contabilidade_id: z.number().int().positive().optional().nullable(),
  contabilidadeId: z.number().int().positive().optional().nullable(),
});

function toResponse(empresa: {
  id: number;
  cnpj: string;
  razaoSocial: string;
  regime: string | null;
  contabilidadeId: number | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: String(empresa.id),
    cnpj: empresa.cnpj,
    razao_social: empresa.razaoSocial,
    regime: empresa.regime,
    contabilidade_id: empresa.contabilidadeId,
    created_at: empresa.createdAt.toISOString(),
    updated_at: empresa.updatedAt.toISOString(),
  };
}

// POST / - Criar empresa (legado)
router.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = EmpresaCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      jsonError(res, parsed.error.issues?.[0]?.message ?? 'Dados inválidos', 400);
      return;
    }
    const { cnpj, razao_social, razaoSocial, regime, contabilidade_id, contabilidadeId } =
      parsed.data;
    const razaoSocialVal = razao_social ?? razaoSocial;
    if (!razaoSocialVal) {
      jsonError(res, 'razao_social é obrigatório', 400);
      return;
    }
    if (await repo.verificarCnpjTemCertificado(cnpj)) {
      jsonError(
        res,
        `CNPJ ${cnpj} já possui certificado digital cadastrado. Empresas com certificado não podem ser cadastradas via credenciais.`,
        400
      );
      return;
    }
    const empresa = await repo.criarEmpresa({
      cnpj: normalizeCnpj(cnpj),
      razaoSocial: razaoSocialVal,
      regime: regime ?? undefined,
      contabilidadeId: contabilidade_id ?? contabilidadeId ?? undefined,
    });
    jsonCreated(res, toResponse(empresa), 'Empresa criada');
  })
);

// PUT /:id - Atualizar empresa (legado)
router.put(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id ?? ''), 10);
    if (isNaN(id) || id < 1) {
      jsonError(res, 'ID de empresa inválido', 400);
      return;
    }
    const data: { razaoSocial?: string; regime?: string; contabilidadeId?: number } = {};
    if (req.body.razao_social != null) data.razaoSocial = req.body.razao_social;
    if (req.body.razaoSocial != null) data.razaoSocial = req.body.razaoSocial;
    if (req.body.regime != null) data.regime = req.body.regime;
    if (req.body.contabilidade_id != null) data.contabilidadeId = req.body.contabilidade_id;
    if (req.body.contabilidadeId != null) data.contabilidadeId = req.body.contabilidadeId;

    const empresa = await repo.atualizarEmpresa(id, data);
    if (!empresa) {
      jsonError(res, `Empresa com ID ${id} não encontrada`, 404);
      return;
    }
    jsonSuccess(res, toResponse(empresa));
  })
);

// DELETE /:id - Deletar empresa individual (legado) → 204 No Content
router.delete(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id ?? ''), 10);
    if (isNaN(id) || id < 1) {
      jsonError(res, 'ID de empresa inválido', 400);
      return;
    }
    const empresaAntes = await repo.obterEmpresaPorId(id);
    if (!empresaAntes) {
      jsonError(res, `Empresa com ID ${id} não encontrada`, 404);
      return;
    }
    const ok = await repo.deletarEmpresa(id);
    if (!ok) {
      jsonError(res, 'Falha ao deletar empresa', 500);
      return;
    }
    res.status(204).send();
  })
);

export default router;
