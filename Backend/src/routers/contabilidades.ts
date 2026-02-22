/**
 * Router de contabilidades.
 * Rotas de contabilidades.
 */
import { Router, Request, Response } from 'express';
import { getLogger } from '../infrastructure/logger';
import * as repo from '../repositories/contabilidades';

const logger = getLogger('contabilidades');
const router = Router();

function limparCnpj(cnpj: string): string {
  return cnpj.replace(/[.\/\-\s]/g, '').trim();
}

function toResponse(
  item: Awaited<ReturnType<typeof repo.obterPorId>> & {
    certificados_vinculados?: number;
    empresas_vinculadas_count?: number;
  }
) {
  if (!item) return null;
  return {
    id: item.id,
    nome_contabilidade: item.nomeContabilidade,
    cnpj: item.cnpj,
    email: item.email,
    telefone: item.telefone,
    responsavel: item.responsavel,
    data_cadastro: item.dataCadastro?.toISOString?.() ?? null,
    certificados_vinculados: item.certificados_vinculados ?? 0,
    empresas_vinculadas_count: item.empresas_vinculadas_count ?? 0,
  };
}

// POST / - Criar contabilidade
router.post('/', async (req: Request, res: Response) => {
  try {
    const cnpj = limparCnpj(req.body.cnpj ?? '');
    if (cnpj.length !== 14 || !/^\d+$/.test(cnpj)) {
      res.status(400).json({ detail: 'CNPJ deve conter exatamente 14 dígitos' });
      return;
    }
    const nome = String(req.body.nome_contabilidade ?? req.body.nomeContabilidade ?? '').trim();
    if (!nome) {
      res.status(400).json({ detail: 'nome_contabilidade é obrigatório' });
      return;
    }

    const existente = await repo.obterPorCnpj(cnpj);
    if (existente) {
      res.status(400).json({ detail: 'Já existe contabilidade com este CNPJ' });
      return;
    }

    const cont = await repo.criar({
      nomeContabilidade: nome,
      cnpj,
      email: req.body.email,
      telefone: req.body.telefone,
      responsavel: req.body.responsavel,
    });

    const [vinculados, empresasCount] = await Promise.all([
      repo.obterTotalVinculados(cont.id),
      repo.contarEmpresas(cont.id),
    ]);
    res.status(201).json(toResponse({ ...cont, certificados_vinculados: vinculados, empresas_vinculadas_count: empresasCount }));
  } catch (error) {
    logger.error({ err: error }, 'Erro ao criar contabilidade');
    res.status(500).json({ detail: 'Erro ao criar contabilidade' });
  }
});

// GET / - Listar contabilidades
router.get('/', async (req: Request, res: Response) => {
  try {
    const skip = Math.max(0, parseInt(String(req.query.skip ?? 0), 10));
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? 100), 10)));

    const contabilidades = await repo.listarContabilidades(skip, limit);
    const ids = contabilidades.map((c) => c.id);
    const [vinculadosMap, empresasMap] = await Promise.all([
      repo.obterTotalVinculadosPorIds(ids),
      repo.obterEmpresasVinculadasPorIds(ids),
    ]);

    const items = contabilidades.map((c) =>
      toResponse({
        ...c,
        certificados_vinculados: vinculadosMap[c.id] ?? 0,
        empresas_vinculadas_count: empresasMap[c.id] ?? 0,
      })
    );

    res.json({
      contabilidades: items,
      total: items.length,
    });
  } catch (error) {
    logger.error({ err: error }, 'Erro ao listar contabilidades');
    res.status(500).json({ detail: 'Erro ao listar contabilidades' });
  }
});

// GET /:contabilidade_id - Obter por ID
router.get('/:contabilidade_id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.contabilidade_id ?? ''), 10);
    if (isNaN(id) || id < 1) {
      res.status(400).json({ detail: 'ID inválido' });
      return;
    }

    const cont = await repo.obterPorId(id);
    if (!cont) {
      res.status(404).json({ detail: 'Contabilidade não encontrada' });
      return;
    }

    const [vinculados, empresasCount] = await Promise.all([
      repo.obterTotalVinculados(cont.id),
      repo.contarEmpresas(cont.id),
    ]);
    res.json(toResponse({ ...cont, certificados_vinculados: vinculados, empresas_vinculadas_count: empresasCount }));
  } catch (error) {
    logger.error({ err: error }, 'Erro ao obter contabilidade');
    res.status(500).json({ detail: 'Erro ao obter contabilidade' });
  }
});

// PUT /:contabilidade_id - Atualizar
router.put('/:contabilidade_id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.contabilidade_id ?? ''), 10);
    if (isNaN(id) || id < 1) {
      res.status(400).json({ detail: 'ID inválido' });
      return;
    }

    const data: Record<string, unknown> = {};
    if (req.body.nome_contabilidade != null) data.nomeContabilidade = req.body.nome_contabilidade;
    if (req.body.nomeContabilidade != null) data.nomeContabilidade = req.body.nomeContabilidade;
    if (req.body.email != null) data.email = req.body.email;
    if (req.body.telefone != null) data.telefone = req.body.telefone;
    if (req.body.responsavel != null) data.responsavel = req.body.responsavel;

    if (Object.keys(data).length === 0) {
      res.status(400).json({ detail: 'Nenhuma alteração informada' });
      return;
    }

    const cont = await repo.atualizar(id, data as Parameters<typeof repo.atualizar>[1]);
    if (!cont) {
      res.status(404).json({ detail: 'Contabilidade não encontrada após atualização' });
      return;
    }

    const [vinculados, empresasCount] = await Promise.all([
      repo.obterTotalVinculados(cont.id),
      repo.contarEmpresas(cont.id),
    ]);
    res.json(toResponse({ ...cont, certificados_vinculados: vinculados, empresas_vinculadas_count: empresasCount }));
  } catch (error) {
    logger.error({ err: error }, 'Erro ao atualizar contabilidade');
    res.status(500).json({ detail: 'Erro ao atualizar contabilidade' });
  }
});

// DELETE /:contabilidade_id - Excluir
router.delete('/:contabilidade_id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.contabilidade_id ?? ''), 10);
    if (isNaN(id) || id < 1) {
      res.status(400).json({ detail: 'ID inválido' });
      return;
    }

    const exists = await repo.obterPorId(id);
    if (!exists) {
      res.status(404).json({ detail: 'Contabilidade não encontrada' });
      return;
    }

    await repo.deletar(id);
    res.status(204).send();
  } catch (error) {
    logger.error({ err: error }, 'Erro ao excluir contabilidade');
    res.status(500).json({ detail: 'Erro ao excluir contabilidade' });
  }
});

export default router;
