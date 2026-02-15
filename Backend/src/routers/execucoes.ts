/**
 * Router de execuções (histórico).
 * Orquestração real vem na Fase 4.
 */
import { Router, Request, Response } from 'express';
import { getLogger } from '../infrastructure/logger';
import * as repo from '../repositories/execucoes';

const logger = getLogger('execucoes');
const router = Router();

function toResponse(e: {
  id: number;
  empresaId: number;
  cnpj: string | null;
  status: string;
  etapaAtual: string;
  progresso: number;
  periodoInicio: string | null;
  periodoFim: string | null;
  tipo: string;
  mensagem: string | null;
  dataInicio: Date | null;
  dataFim: Date | null;
  mensagemErro: string | null;
  qtdNotasEmitidas: number;
  qtdNotasRecebidas: number;
  resultadoFinal: string | null;
  createdAt: Date;
  atualizadoEm: Date;
}) {
  return {
    id: e.id,
    empresa_id: e.empresaId,
    cnpj: e.cnpj,
    status: e.status,
    etapa_atual: e.etapaAtual,
    progresso: e.progresso,
    periodo_inicio: e.periodoInicio,
    periodo_fim: e.periodoFim,
    tipo: e.tipo,
    mensagem: e.mensagem,
    data_inicio: e.dataInicio?.toISOString() ?? null,
    data_fim: e.dataFim?.toISOString() ?? null,
    mensagem_erro: e.mensagemErro,
    qtd_notas_emitidas: e.qtdNotasEmitidas,
    qtd_notas_recebidas: e.qtdNotasRecebidas,
    resultado_final: e.resultadoFinal,
    created_at: e.createdAt.toISOString(),
    atualizado_em: e.atualizadoEm.toISOString(),
  };
}

// GET / - Listar execuções
router.get('/', async (req: Request, res: Response) => {
  try {
    const skip = parseInt(String(req.query.skip ?? 0), 10);
    const limit = Math.min(parseInt(String(req.query.limit ?? 100), 10), 100);
    const status = req.query.status as string | undefined;
    const empresaId = req.query.empresa_id
      ? parseInt(String(req.query.empresa_id), 10)
      : undefined;

    const execucoes = await repo.listarExecucoes({
      skip,
      limit,
      status: status || undefined,
      empresaId: empresaId && !isNaN(empresaId) ? empresaId : undefined,
    });
    res.json(execucoes.map(toResponse));
  } catch (error) {
    logger.error({ err: error }, 'Erro ao listar execuções');
    res.status(500).json({ detail: 'Erro ao listar execuções' });
  }
});

// GET /:id - Obter execução por ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id ?? ''), 10);
    if (isNaN(id)) {
      res.status(400).json({ detail: 'ID inválido' });
      return;
    }
    const exec = await repo.obterPorId(id);
    if (!exec) {
      res.status(404).json({ detail: 'Execução não encontrada' });
      return;
    }
    res.json(toResponse(exec));
  } catch (error) {
    logger.error({ err: error }, 'Erro ao obter execução');
    res.status(500).json({ detail: 'Erro ao obter execução' });
  }
});

// POST / - Criar execução (início - orquestração real na Fase 4)
router.post('/', async (req: Request, res: Response) => {
  try {
    const empresaId = parseInt(req.body.empresa_id ?? req.body.empresaId, 10);
    if (isNaN(empresaId)) {
      res.status(400).json({ detail: 'empresa_id é obrigatório' });
      return;
    }
    const exec = await repo.criar({
      empresaId,
      cnpj: req.body.cnpj,
      periodoInicio: req.body.periodo_inicio ?? req.body.periodoInicio,
      periodoFim: req.body.periodo_fim ?? req.body.periodoFim,
      tipo: req.body.tipo ?? 'ambas',
    });
    res.status(201).json(toResponse(exec));
  } catch (error) {
    logger.error({ err: error }, 'Erro ao criar execução');
    res.status(500).json({ detail: 'Erro ao criar execução' });
  }
});

export default router;
