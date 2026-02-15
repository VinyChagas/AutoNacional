/**
 * Router de empresas.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getLogger } from '../infrastructure/logger';
import * as repo from '../repositories/empresas';

const logger = getLogger('empresas');
const router = Router();

const EmpresaCreateSchema = z.object({
  cnpj: z.string().refine(
    (v) => v.replace(/[.\/\-\s]/g, '').length === 14 && /^\d+$/.test(v.replace(/[.\/\-\s]/g, '')),
    { message: 'CNPJ deve conter 14 dígitos' }
  ),
  razao_social: z.string().min(1).optional(),
  razaoSocial: z.string().min(1).optional(),
  regime: z.string().optional(),
  contabilidade_id: z.number().int().positive().optional().nullable(),
  contabilidadeId: z.number().int().positive().optional().nullable(),
});

function limparCnpj(cnpj: string): string {
  return cnpj.replace(/[.\/\-]/g, '').trim();
}

function toResponse(empresa: { id: number; cnpj: string; razaoSocial: string; regime: string | null; contabilidadeId: number | null; createdAt: Date; updatedAt: Date }) {
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

// GET / - Listar empresas
router.get('/', async (_req: Request, res: Response) => {
  try {
    const skip = parseInt(String(_req.query.skip || 0), 10);
    const limit = Math.min(parseInt(String(_req.query.limit || 100), 10), 100);
    const empresas = await repo.listarEmpresas(skip, limit);
    res.json(empresas.map(toResponse));
  } catch (error) {
    logger.error({ err: error }, 'Erro ao listar empresas');
    res.status(500).json({ detail: 'Erro ao listar empresas' });
  }
});

// GET /contabilidade/:contabilidade_id - Listar por contabilidade (antes de /:id)
router.get('/contabilidade/:contabilidade_id', async (req: Request, res: Response) => {
  try {
    const contabilidadeId = parseInt(String(req.params.contabilidade_id ?? ''), 10);
    if (isNaN(contabilidadeId) || contabilidadeId < 1) {
      res.status(400).json({ detail: 'ID de contabilidade inválido' });
      return;
    }
    const skip = parseInt(String(req.query.skip || 0), 10);
    const limit = Math.min(parseInt(String(req.query.limit || 100), 10), 1000);
    const empresas = await repo.listarEmpresasPorContabilidade(contabilidadeId, skip, limit);
    res.json(empresas.map(toResponse));
  } catch (error) {
    logger.error({ err: error }, 'Erro ao listar empresas por contabilidade');
    res.status(500).json({ detail: 'Erro ao listar empresas' });
  }
});

// GET /cnpj/:cnpj - Obter por CNPJ (antes de /:id para evitar conflito)
router.get('/cnpj/:cnpj', async (req: Request, res: Response) => {
  try {
    const cnpj = limparCnpj(String(req.params.cnpj ?? ''));
    const empresa = await repo.obterEmpresaPorCnpj(cnpj);
    if (!empresa) {
      res.status(404).json({ detail: `Empresa com CNPJ ${cnpj} não encontrada` });
      return;
    }
    res.json(toResponse(empresa));
  } catch (error) {
    logger.error({ err: error }, 'Erro ao obter empresa por CNPJ');
    res.status(500).json({ detail: 'Erro ao obter empresa' });
  }
});

// GET /:empresa_id - Obter por ID
router.get('/:empresa_id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.empresa_id ?? ''), 10);
    if (isNaN(id)) {
      res.status(400).json({ detail: 'ID de empresa inválido' });
      return;
    }
    const empresa = await repo.obterEmpresaPorId(id);
    if (!empresa) {
      res.status(404).json({ detail: `Empresa com ID ${id} não encontrada` });
      return;
    }
    res.json(toResponse(empresa));
  } catch (error) {
    logger.error({ err: error }, 'Erro ao obter empresa');
    res.status(500).json({ detail: 'Erro ao obter empresa' });
  }
});

// POST / - Criar empresa
router.post('/', async (req: Request, res: Response) => {
  try {
    const parsed = EmpresaCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ detail: parsed.error.issues?.[0]?.message ?? 'Dados inválidos' });
      return;
    }
    const { cnpj, razao_social, razaoSocial, regime, contabilidade_id, contabilidadeId } = parsed.data;
    const razaoSocialVal = razao_social ?? razaoSocial;
    if (!razaoSocialVal) {
      res.status(400).json({ detail: 'razao_social é obrigatório' });
      return;
    }
    if (await repo.verificarCnpjTemCertificado(cnpj)) {
      res
        .status(400)
        .json({
          detail: `CNPJ ${cnpj} já possui certificado digital cadastrado. Empresas com certificado não podem ser cadastradas via credenciais.`,
        });
      return;
    }
    const empresa = await repo.criarEmpresa({
      cnpj: limparCnpj(cnpj),
      razaoSocial: razaoSocialVal,
      regime: regime ?? undefined,
      contabilidadeId: contabilidade_id ?? contabilidadeId ?? undefined,
    });
    res.status(201).json(toResponse(empresa));
  } catch (error) {
    logger.error({ err: error }, 'Erro ao criar empresa');
    res.status(500).json({ detail: 'Erro ao criar empresa' });
  }
});

// PUT /:empresa_id - Atualizar empresa
router.put('/:empresa_id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.empresa_id ?? ''), 10);
    if (isNaN(id)) {
      res.status(400).json({ detail: 'ID de empresa inválido' });
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
      res.status(404).json({ detail: `Empresa com ID ${id} não encontrada` });
      return;
    }
    res.json(toResponse(empresa));
  } catch (error) {
    logger.error({ err: error }, 'Erro ao atualizar empresa');
    res.status(500).json({ detail: 'Erro ao atualizar empresa' });
  }
});

// DELETE /:empresa_id - Deletar empresa
router.delete('/:empresa_id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.empresa_id ?? ''), 10);
    if (isNaN(id)) {
      res.status(400).json({ detail: 'ID de empresa inválido' });
      return;
    }
    const empresaAntes = await repo.obterEmpresaPorId(id);
    if (!empresaAntes) {
      res.status(404).json({ detail: `Empresa com ID ${id} não encontrada` });
      return;
    }
    const ok = await repo.deletarEmpresa(id);
    if (!ok) {
      res.status(500).json({ detail: 'Falha ao deletar empresa' });
      return;
    }
    res.status(204).send();
  } catch (error) {
    logger.error({ err: error }, 'Erro ao deletar empresa');
    res.status(500).json({ detail: 'Erro ao deletar empresa' });
  }
});

export default router;
