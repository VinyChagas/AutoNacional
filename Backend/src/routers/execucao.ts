/**
 * Router de execução orquestrada (playwright + processar_notas).
 * Rotas de execução de automação.
 */
import { randomUUID } from 'crypto';
import { Router, Request, Response } from 'express';
import { getLogger } from '../infrastructure/logger';
import * as empresasRepo from '../repositories/empresas';
import * as certificadosRepo from '../repositories/certificados';
import { adicionarExecucao, obterStatus } from '../services/execution-service';
import { registrarClienteSSE } from '../services/execution-events.service';
import { criarBatch } from '../services/automation-metrics.service';
import {
  obterSummaryExecucao,
  listarEmpresasAptas,
} from '../services/execution-summary.service';

const logger = getLogger('execucao');
const router = Router({ mergeParams: true });

// GET /companies/summary?contabilidade_id=XXX - Antes de /:empresa_id
router.get('/companies/summary', async (req: Request, res: Response) => {
  try {
    const raw = req.query.contabilidade_id ?? req.query.contabilidadeId;
    const contabilidadeId = parseInt(String(raw ?? ''), 10);
    if (isNaN(contabilidadeId) || contabilidadeId < 1) {
      res.status(400).json({ detail: 'contabilidade_id é obrigatório e deve ser um número positivo' });
      return;
    }
    const summary = await obterSummaryExecucao(contabilidadeId);
    res.json(summary);
  } catch (error) {
    logger.error({ err: error }, 'Erro ao obter summary de execução');
    res.status(500).json({ detail: 'Erro ao obter resumo de empresas para execução' });
  }
});

// GET /companies?contabilidade_id=XXX - Apenas empresas aptas (OPERACIONAL + ATENCAO)
router.get('/companies', async (req: Request, res: Response) => {
  try {
    const raw = req.query.contabilidade_id ?? req.query.contabilidadeId;
    const contabilidadeId = parseInt(String(raw ?? ''), 10);
    if (isNaN(contabilidadeId) || contabilidadeId < 1) {
      res.status(400).json({ detail: 'contabilidade_id é obrigatório e deve ser um número positivo' });
      return;
    }
    const aptas = await listarEmpresasAptas(contabilidadeId);
    res.json({ empresas: aptas });
  } catch (error) {
    logger.error({ err: error }, 'Erro ao listar empresas aptas');
    res.status(500).json({ detail: 'Erro ao listar empresas aptas para execução' });
  }
});

function limparCnpj(v: string): string {
  return v.replace(/[.\/\-\s]/g, '').trim();
}

const DATA_REGEX = /^\d{2}\/\d{2}\/\d{4}$/;

/**
 * POST /api/execucao/multiplas
 * Inicia execuções para múltiplas empresas.
 * Retorna batch_id (uuid) criado no início para rastreio.
 * batch_id é associado internamente a cada execução iniciada.
 *
 * Exemplo de resposta:
 * { success: true, batch_id: "uuid", started: 5, erros: 0, execucoes: [...], detalhes_erros: [] }
 */
// POST /api/execucao/multiplas - DEVE vir antes de /:empresa_id
router.post('/multiplas', async (req: Request, res: Response) => {
  try {
    const batchId = randomUUID();
    const body = req.body as {
      empresas?: Array<{ empresa_id: string; cnpj: string; tipo_autenticacao?: string }>;
      dataInicio?: string;
      dataFim?: string;
      tipo?: string;
      headless?: boolean;
      contabilidade_id?: number | null;
    };
    const empresas = body.empresas || [];
    const dataInicio = body.dataInicio;
    const dataFim = body.dataFim;
    const tipo = body.tipo || 'ambas';
    const headless = body.headless ?? false;
    const contabilidadeId = body.contabilidade_id != null && body.contabilidade_id > 0 ? body.contabilidade_id : null;

    if (empresas.length === 0) {
      res.status(400).json({ detail: 'Lista de empresas não pode estar vazia' });
      return;
    }
    if (!dataInicio || !dataFim || !DATA_REGEX.test(dataInicio) || !DATA_REGEX.test(dataFim)) {
      res.status(400).json({
        detail: 'dataInicio e dataFim obrigatórios no formato DD/MM/YYYY',
      });
      return;
    }

    const resultados: Array<Record<string, unknown>> = [];
    const erros: Array<{ empresa_id: string; cnpj: string; erro: string }> = [];

    for (const emp of empresas) {
      const cnpjLimpo = limparCnpj(emp.cnpj);
      if (cnpjLimpo.length !== 14) {
        erros.push({ empresa_id: emp.empresa_id, cnpj: emp.cnpj, erro: 'CNPJ inválido' });
        continue;
      }
      try {
        // empresa_id pode vir como ID numérico ou CNPJ (14 dígitos)
        const empresaIdRaw = emp.empresa_id;
        const parsed = parseInt(empresaIdRaw, 10);
        const isCnpjFormat = empresaIdRaw && String(empresaIdRaw).replace(/\D/g, '').length === 14;
        let empresaId: number;

        if (isCnpjFormat || isNaN(parsed) || parsed > 2147483647) {
          let empresaByCnpj = await empresasRepo.obterEmpresaPorCnpj(cnpjLimpo);
          if (!empresaByCnpj) {
            const cert = await certificadosRepo.obterPorCnpj(cnpjLimpo);
            if (cert) {
              empresaByCnpj = await empresasRepo.criarEmpresa({
                cnpj: cnpjLimpo,
                razaoSocial: `Empresa ${cnpjLimpo}`,
                contabilidadeId: cert.contabilidadeId ?? undefined,
              });
            }
          }
          empresaId = empresaByCnpj?.id ?? 0;
          if (empresaId === 0) {
            erros.push({
              empresa_id: emp.empresa_id,
              cnpj: emp.cnpj,
              erro: 'Empresa não encontrada. Cadastre a empresa ou importe o certificado primeiro.',
            });
            continue;
          }
        } else {
          empresaId = parsed;
          const existe = await empresasRepo.obterEmpresaPorId(empresaId);
          if (!existe) {
            erros.push({
              empresa_id: emp.empresa_id,
              cnpj: emp.cnpj,
              erro: 'Empresa não encontrada',
            });
            continue;
          }
        }
        const tipoAuth =
          emp.tipo_autenticacao === 'credenciais' ? 'credenciais' : 'certificado';

        await adicionarExecucao(
          empresaId,
          cnpjLimpo,
          dataInicio,
          dataFim,
          tipo,
          headless,
          undefined,
          batchId,
          tipoAuth
        );
        const status = obterStatus(String(empresaId));
        resultados.push({
          empresa_id: String(empresaId),
          cnpj: cnpjLimpo,
          status: status?.status || 'pendente',
          etapa_atual: status?.etapa_atual || 'inicio',
          progresso: status?.progresso ?? 0,
          logs: status?.logs || [],
        });
      } catch (e) {
        erros.push({
          empresa_id: emp.empresa_id,
          cnpj: emp.cnpj,
          erro: (e as Error).message,
        });
      }
    }

    const started = resultados.length;
    if (started > 0 && dataInicio && DATA_REGEX.test(dataInicio)) {
      const comp = `${dataInicio.slice(6, 10)}-${dataInicio.slice(3, 5)}`;
      await criarBatch({
        batchId,
        competencia: comp,
        contabilidadeId,
        totalEmpresas: started,
      });
    }

    res.status(202).json({
      success: true,
      batch_id: batchId,
      started,
      erros: erros.length,
      execucoes: resultados,
      detalhes_erros: erros,
    });
  } catch (error) {
    logger.error({ err: error }, 'Erro ao adicionar múltiplas execuções');
    res.status(500).json({ detail: 'Erro ao adicionar múltiplas execuções' });
  }
});

// GET /api/execucao/stream/:batch_id - SSE para atualizações em tempo real
// DEVE vir antes de /:empresa_id para que "stream" não seja capturado
router.get('/stream/:batch_id', (req: Request, res: Response) => {
  const batchId = String(req.params.batch_id ?? '');
  if (!batchId) {
    res.status(400).json({ detail: 'batch_id é obrigatório' });
    return;
  }
  registrarClienteSSE(batchId, res);
});

// POST /api/execucao/:empresa_id - Iniciar execução
router.post('/:empresa_id', async (req: Request, res: Response) => {
  try {
    const empresaIdParam = String(req.params.empresa_id ?? '');
    const dataInicio = String(req.query.dataInicio || req.body?.dataInicio || '');
    const dataFim = String(req.query.dataFim || req.body?.dataFim || '');
    const tipo = String(req.query.tipo || req.body?.tipo || 'ambas');
    const headless =
      req.query.headless === 'true' || req.body?.headless === true;

    if (!dataInicio || !dataFim) {
      res.status(400).json({
        detail: 'dataInicio e dataFim são obrigatórios (formato DD/MM/YYYY)',
      });
      return;
    }
    if (!DATA_REGEX.test(dataInicio) || !DATA_REGEX.test(dataFim)) {
      res.status(400).json({
        detail: 'Datas devem estar no formato DD/MM/YYYY (ex: 01/12/2025)',
      });
      return;
    }

    let empresa: Awaited<ReturnType<typeof empresasRepo.obterEmpresaPorId>> = null;
    const idNum = parseInt(empresaIdParam, 10);
    if (!isNaN(idNum)) {
      empresa = await empresasRepo.obterEmpresaPorId(idNum);
    }
    if (!empresa) {
      const cnpjLimpo = limparCnpj(empresaIdParam);
      if (cnpjLimpo.length === 14 && /^\d+$/.test(cnpjLimpo)) {
        empresa = await empresasRepo.obterEmpresaPorCnpj(cnpjLimpo);
      }
    }
    if (!empresa) {
      res.status(404).json({
        detail: `Empresa com ID/CNPJ ${empresaIdParam} não encontrada`,
      });
      return;
    }

    const cnpj = empresa.cnpj || limparCnpj(empresaIdParam);
    if (!cnpj || cnpj.length !== 14) {
      res.status(400).json({ detail: 'Empresa não possui CNPJ cadastrado' });
      return;
    }

    const execucaoId = await adicionarExecucao(
      empresa.id,
      cnpj,
      dataInicio,
      dataFim,
      tipo,
      headless
    );

    const status = obterStatus(String(empresa.id));
    res.status(202).json({
      id: execucaoId,
      empresa_id: String(empresa.id),
      cnpj,
      status: status?.status || 'pendente',
      etapa_atual: status?.etapa_atual || 'inicio',
      progresso: status?.progresso ?? 0,
      logs: status?.logs || [],
      mensagem: status?.mensagem || 'Aguardando execução...',
    });
  } catch (error) {
    logger.error({ err: error }, 'Erro ao iniciar execução');
    res.status(500).json({ detail: 'Erro ao iniciar execução' });
  }
});

// GET /api/execucao/:empresa_id/status
router.get('/:empresa_id/status', async (req: Request, res: Response) => {
  try {
    const empresaId = String(req.params.empresa_id ?? '');
    let status = obterStatus(empresaId);
    if (!status) {
      const cnpjLimpo = limparCnpj(empresaId);
      if (cnpjLimpo.length === 14) {
        const emp = await empresasRepo.obterEmpresaPorCnpj(cnpjLimpo);
        if (emp) {
          status = obterStatus(String(emp.id));
          if (status) {
            res.json({ ...status, empresa_id: String(emp.id), cnpj: emp.cnpj });
            return;
          }
        }
      }
      res.status(404).json({
        detail: `Execução para empresa/CNPJ ${empresaId} não encontrada`,
      });
      return;
    }
    res.json({ ...status, empresa_id: empresaId });
  } catch (error) {
    logger.error({ err: error }, 'Erro ao obter status');
    res.status(500).json({ detail: 'Erro ao obter status' });
  }
});

export default router;
