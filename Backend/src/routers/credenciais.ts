/**
 * Router de credenciais.
 */
import { Router, Request, Response } from 'express';
import { getLogger } from '../infrastructure/logger';
import * as credenciaisRepo from '../repositories/credenciais';

const logger = getLogger('credenciais');
const router = Router();

function toResponse(c: {
  id: number;
  empresaId: number;
  tipo: string;
  usuario: string;
  status: string;
  ultimoTesteEm: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: c.id,
    empresa_id: c.empresaId,
    tipo: c.tipo,
    usuario: c.usuario,
    status: c.status,
    ultimo_teste_em: c.ultimoTesteEm?.toISOString() ?? null,
    created_at: c.createdAt.toISOString(),
    updated_at: c.updatedAt.toISOString(),
  };
}

// GET /empresa/:empresa_id
router.get('/empresa/:empresa_id', async (req: Request, res: Response) => {
  try {
    const empresaId = parseInt(String(req.params.empresa_id ?? ''), 10);
    if (isNaN(empresaId)) {
      res.status(400).json({ detail: 'ID de empresa inválido' });
      return;
    }
    const credenciais = await credenciaisRepo.listarPorEmpresa(empresaId);
    res.json({ credenciais: credenciais.map(toResponse), total: credenciais.length });
  } catch (error) {
    logger.error({ err: error }, 'Erro ao listar credenciais');
    res.status(500).json({ detail: 'Erro ao obter credenciais' });
  }
});

// POST / - Criar ou atualizar
router.post('/', async (req: Request, res: Response) => {
  try {
    const empresaId = parseInt(req.body.empresa_id ?? req.body.empresaId, 10);
    if (isNaN(empresaId)) {
      res.status(400).json({ detail: 'empresa_id é obrigatório e deve ser número' });
      return;
    }
    const tipoLogin = (req.body.tipo_login ?? req.body.tipoLogin ?? 'cnpj').toLowerCase();
    const tipo = tipoLogin === 'cpf' ? 'CPF_SENHA' : 'CNPJ_SENHA';
    const usuario = String(req.body.usuario ?? '').replace(/[.\/\-\s]/g, '');
    const senha = String(req.body.senha ?? '');

    if (!usuario || !senha) {
      res.status(400).json({ detail: 'usuario e senha são obrigatórios' });
      return;
    }

    const credencial = await credenciaisRepo.criarOuAtualizar(
      empresaId,
      tipo,
      usuario,
      senha
    );
    res.status(201).json(toResponse(credencial));
  } catch (error) {
    logger.error({ err: error }, 'Erro ao criar/atualizar credencial');
    res.status(500).json({ detail: 'Erro ao criar credencial' });
  }
});

// PUT /:credencial_id/status
router.put('/:credencial_id/status', async (req: Request, res: Response) => {
  try {
    const credencialId = parseInt(String(req.params.credencial_id ?? ''), 10);
    const status = req.query.status ?? req.body.status ?? 'NAO_TESTADO';
    if (isNaN(credencialId)) {
      res.status(400).json({ detail: 'ID inválido' });
      return;
    }
    const credencial = await credenciaisRepo.atualizarStatus(
      credencialId,
      String(status)
    );
    if (!credencial) {
      res.status(404).json({ detail: 'Credencial não encontrada' });
      return;
    }
    res.json(toResponse(credencial));
  } catch (error) {
    logger.error({ err: error }, 'Erro ao atualizar status');
    res.status(500).json({ detail: 'Erro ao atualizar status' });
  }
});

// PUT /:credencial_id - Atualizar senha
router.put('/:credencial_id', async (req: Request, res: Response) => {
  try {
    const credencialId = parseInt(String(req.params.credencial_id ?? ''), 10);
    const senha = req.body.senha;
    if (isNaN(credencialId)) {
      res.status(400).json({ detail: 'ID inválido' });
      return;
    }
    if (!senha) {
      res.status(400).json({ detail: 'senha é obrigatória' });
      return;
    }
    const credencial = await credenciaisRepo.atualizarCredencial(
      credencialId,
      senha
    );
    if (!credencial) {
      res.status(404).json({ detail: 'Credencial não encontrada' });
      return;
    }
    res.json(toResponse(credencial));
  } catch (error) {
    logger.error({ err: error }, 'Erro ao atualizar credencial');
    res.status(500).json({ detail: 'Erro ao atualizar credencial' });
  }
});

// DELETE /:credencial_id
router.delete('/:credencial_id', async (req: Request, res: Response) => {
  try {
    const credencialId = parseInt(String(req.params.credencial_id ?? ''), 10);
    if (isNaN(credencialId)) {
      res.status(400).json({ detail: 'ID inválido' });
      return;
    }
    const ok = await credenciaisRepo.deletarCredencial(credencialId);
    if (!ok) {
      res.status(404).json({ detail: 'Credencial não encontrada' });
      return;
    }
    res.status(204).send();
  } catch (error) {
    logger.error({ err: error }, 'Erro ao deletar credencial');
    res.status(500).json({ detail: 'Erro ao deletar credencial' });
  }
});

// POST /:credencial_id/obter-senha - Requer senha admin
router.post('/:credencial_id/obter-senha', async (req: Request, res: Response) => {
  try {
    const credencialId = parseInt(String(req.params.credencial_id ?? ''), 10);
    const senhaAdmin = req.body.senha_admin;
    if (isNaN(credencialId)) {
      res.status(400).json({ detail: 'ID inválido' });
      return;
    }
    if (senhaAdmin !== 'Admin123@') {
      res.status(401).json({ detail: 'Senha de administrador incorreta' });
      return;
    }
    const credencial = await credenciaisRepo.obterPorId(credencialId);
    if (!credencial) {
      res.status(404).json({ detail: 'Credencial não encontrada' });
      return;
    }
    const senha = credenciaisRepo.descriptografarSenha(credencial);
    res.json({ senha });
  } catch (error) {
    logger.error({ err: error }, 'Erro ao obter senha');
    res.status(500).json({ detail: 'Erro ao obter senha' });
  }
});

export default router;
