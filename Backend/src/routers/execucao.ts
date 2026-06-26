/**
 * Router de execução orquestrada (playwright + processar_notas).
 * Rotas de execução de automação.
 */
import { randomUUID } from 'crypto';
import { Router, Request, Response } from 'express';
import { getLogger } from '../infrastructure/logger';
import * as empresasRepo from '../repositories/empresas';
import * as certificadosRepo from '../repositories/certificados';
import {
  adicionarExecucao,
  obterStatus,
  obterStatusBatch,
  configurarConcorrenciaParaBatch,
  obterDelayEnfileiramento,
} from '../services/execution-service';
import { sleep } from '../utils/sleep';
import { registrarClienteSSE } from '../services/execution-events.service';
import { criarBatch } from '../services/automation-metrics.service';
import * as execucoesRepo from '../repositories/execucoes';
import * as settingsRepo from '../repositories/settings';
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
// Producer: apenas enfileira; browser launch ocorre APENAS no worker (fila).
router.post('/multiplas', async (req: Request, res: Response) => {
  try {
    const batchId = randomUUID();
    const body = req.body as {
      empresas?: Array<{ empresa_id: string; cnpj: string; tipo_autenticacao?: string }>;
      dataInicio?: string;
      dataFim?: string;
      tipo?: string;
      headless?: boolean;
      baixarPdf?: boolean;
      contabilidade_id?: number | null;
    };
    const empresas = body.empresas || [];
    const dataInicio = body.dataInicio;
    const dataFim = body.dataFim;
    const tipo = body.tipo || 'ambas';
    const headless = body.headless ?? false;
    const baixarPdf = body.baixarPdf ?? true;
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

    const erros: Array<{ empresa_id: string; cnpj: string; erro: string }> = [];
    const validos: Array<{ empresaId: number; cnpj: string; tipoAuth: 'certificado' | 'credenciais' }> = [];

    for (const emp of empresas) {
      const cnpjLimpo = limparCnpj(emp.cnpj);
      if (cnpjLimpo.length !== 14) {
        erros.push({ empresa_id: emp.empresa_id, cnpj: emp.cnpj, erro: 'CNPJ inválido' });
        continue;
      }
      try {
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
            erros.push({ empresa_id: emp.empresa_id, cnpj: emp.cnpj, erro: 'Empresa não encontrada' });
            continue;
          }
        }
        const tipoAuth = emp.tipo_autenticacao === 'credenciais' ? 'credenciais' : 'certificado';
        validos.push({ empresaId, cnpj: cnpjLimpo, tipoAuth });
      } catch (e) {
        erros.push({ empresa_id: emp.empresa_id, cnpj: emp.cnpj, erro: (e as Error).message });
      }
    }

    if (validos.length === 0) {
      res.status(400).json({
        detail: 'Nenhuma empresa válida para executar',
        erros: erros.length,
        detalhes_erros: erros,
      });
      return;
    }

    const delayMs = await obterDelayEnfileiramento();
    const concurrencyFinal = await configurarConcorrenciaParaBatch(validos.length);

    if (dataInicio && DATA_REGEX.test(dataInicio)) {
      const comp = `${dataInicio.slice(6, 10)}-${dataInicio.slice(3, 5)}`;
      await criarBatch({
        batchId,
        competencia: comp,
        contabilidadeId,
        totalEmpresas: validos.length,
      });
    }

    const primeiro = validos[0];
    const execucaoId = await adicionarExecucao(
      primeiro.empresaId,
      primeiro.cnpj,
      dataInicio!,
      dataFim!,
      tipo,
      headless,
      undefined,
      batchId,
      primeiro.tipoAuth,
      baixarPdf
    );
    const status = obterStatus(String(primeiro.empresaId));

    logger.debug(`[producer] enfileirou empresa ${primeiro.empresaId} (1/${validos.length})`);

    const execucoes: Array<Record<string, unknown>> = validos.map((v, idx) => {
      if (idx === 0) {
        return {
          id: execucaoId,
          empresa_id: String(primeiro.empresaId),
          cnpj: primeiro.cnpj,
          status: status?.status || 'pendente',
          etapa_atual: status?.etapa_atual || 'inicio',
          progresso: status?.progresso ?? 0,
          logs: status?.logs || [],
        };
      }
      return {
        empresa_id: String(v.empresaId),
        cnpj: v.cnpj,
        status: 'pendente',
        etapa_atual: 'inicio',
        progresso: 0,
        logs: [],
      };
    });

    res.status(202).json({
      success: true,
      batch_id: batchId,
      started: validos.length,
      erros: erros.length,
      execucoes,
      detalhes_erros: erros,
      concurrency_final: concurrencyFinal,
      delayMs,
    });

    (async () => {
      for (let i = 1; i < validos.length; i++) {
        await sleep(delayMs);
        const { empresaId, cnpj, tipoAuth } = validos[i];
        try {
          await adicionarExecucao(
            empresaId,
            cnpj,
            dataInicio!,
            dataFim!,
            tipo,
            headless,
            undefined,
            batchId,
            tipoAuth,
            baixarPdf
          );
          logger.debug(`[producer] enfileirou empresa ${empresaId} (${i + 1}/${validos.length})`);
        } catch (e) {
          logger.error({ err: e, empresaId }, 'Erro ao enfileirar empresa em background');
        }
      }
    })().catch((err) => logger.error({ err }, 'Erro no enfileiramento em background'));
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

// GET /api/execucao/batch/:batch_id/status - Status de todas as execuções do batch (1 request em vez de N)
// Query opcional: empresa_ids=1,2,3 — para fallback no DB quando não estiver em memória
router.get('/batch/:batch_id/status', async (req: Request, res: Response) => {
  try {
    const batchId = String(req.params.batch_id ?? '');
    if (!batchId) {
      res.status(400).json({ detail: 'batch_id é obrigatório' });
      return;
    }
    const rawIds = req.query.empresa_ids ?? req.query.empresaIds;
    let empresaIdsFallback: number[] | undefined;
    if (typeof rawIds === 'string') {
      empresaIdsFallback = rawIds
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !isNaN(n) && n > 0);
    }
    const statuses = await obterStatusBatch(batchId, empresaIdsFallback);
    res.json({ execucoes: statuses });
  } catch (error) {
    logger.error({ err: error }, 'Erro ao obter status do batch');
    res.status(500).json({ detail: 'Erro ao obter status do batch' });
  }
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
    const baixarPdf = !(
      req.query.baixarPdf === 'false' || req.body?.baixarPdf === false
    );

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
      headless,
      undefined,
      undefined,
      undefined,
      baixarPdf
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
      let empresaIdNum: number | null = null;
      let cnpj: string | null = null;
      if (cnpjLimpo.length === 14) {
        const emp = await empresasRepo.obterEmpresaPorCnpj(cnpjLimpo);
        if (emp) {
          empresaIdNum = emp.id;
          cnpj = emp.cnpj;
          status = obterStatus(String(emp.id));
          if (status) {
            res.json({ ...status, empresa_id: String(emp.id), cnpj: emp.cnpj });
            return;
          }
        }
      }
      if (!empresaIdNum) {
        const parsed = parseInt(empresaId, 10);
        if (!isNaN(parsed)) {
          const emp = await empresasRepo.obterEmpresaPorId(parsed);
          if (emp) {
            empresaIdNum = emp.id;
            cnpj = emp.cnpj;
          }
        }
      }
      // Fallback: execução já finalizou e foi removida de execucoesAtivas — buscar no banco
      if (empresaIdNum) {
        const ultima = await execucoesRepo.obterUltimaPorEmpresa(empresaIdNum);
        if (ultima && (ultima.status === 'concluido' || ultima.status === 'falhou')) {
          res.json({
            empresa_id: String(empresaIdNum),
            cnpj: cnpj ?? ultima.cnpj ?? '',
            status: ultima.status,
            etapa_atual: ultima.etapaAtual,
            progresso: ultima.progresso,
            logs: [],
            mensagem: ultima.status === 'falhou' ? (ultima.mensagemErro ?? '') : (ultima.mensagem ?? ''),
            qtd_notas_emitidas: ultima.qtdNotasEmitidas,
            qtd_notas_recebidas: ultima.qtdNotasRecebidas,
            resultado_final: ultima.resultadoFinal,
          });
          return;
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
