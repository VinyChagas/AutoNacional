/**
 * Router de validações (certificados e credenciais).
 * Suporta SSE para progresso em tempo real.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getLogger } from '../infrastructure/logger';
import { asyncHandler } from '../middleware/error-handler';
import { jsonSuccess, jsonError, jsonCreated } from '../middleware/response';
import * as validacoesService from '../services/validacoes-service';

const logger = getLogger('validacoes');
const router = Router();

const IniciarSchema = z.object({
  empresa_ids: z.array(z.number().int().positive()).min(1),
  validar_certificados: z.boolean(),
  validar_credenciais: z.boolean(),
  headless: z.boolean().optional().default(true),
});

router.post(
  '/iniciar',
  asyncHandler(async (req: Request, res: Response) => {
    logger.info({ body: req.body }, 'POST /validacoes/iniciar recebido');
    const parsed = IniciarSchema.safeParse(req.body);
    if (!parsed.success) {
      logger.warn({ issues: parsed.error.issues }, 'Payload inválido');
      jsonError(res, parsed.error.issues?.[0]?.message ?? 'Payload inválido', 400);
      return;
    }
    const jobId = await validacoesService.iniciarValidacao(parsed.data);
    logger.info({ jobId, empresaIds: parsed.data.empresa_ids.length, validarCred: parsed.data.validar_credenciais }, 'Validação iniciada');
    jsonCreated(res, { job_id: jobId }, 'Validação iniciada');
  })
);

router.get(
  '/stream/:job_id',
  asyncHandler(async (req: Request, res: Response) => {
    const jobId = String(req.params.job_id ?? '').trim();
    if (!jobId) {
      jsonError(res, 'job_id é obrigatório', 400);
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    validacoesService.registrarClienteSSE(jobId, res);
  })
);

router.post(
  '/start',
  asyncHandler(async (req: Request, res: Response) => {
    const StartSchema = z.object({
      targets: z.array(z.enum(['CERTIFICADO', 'CREDENCIAL'])).min(1),
      scope: z.object({
        mode: z.enum(['SELECTED', 'FILTERED', 'ALL']),
        empresa_ids: z.array(z.number().int().positive()).optional(),
      }),
      filters: z.record(z.string(), z.unknown()).optional(),
    });
    const parsed = StartSchema.safeParse(req.body);
    if (!parsed.success) {
      jsonError(res, parsed.error.issues?.[0]?.message ?? 'Payload inválido', 400);
      return;
    }
    const jobId = await validacoesService.iniciarValidacaoLegacy(parsed.data);
    logger.info({ jobId }, 'Validação iniciada (legacy)');
    jsonCreated(res, { job_id: jobId }, 'Validação iniciada');
  })
);

router.get(
  '/:job_id',
  asyncHandler(async (req: Request, res: Response) => {
    const jobId = String(req.params.job_id ?? '').trim();
    if (!jobId) {
      jsonError(res, 'job_id é obrigatório', 400);
      return;
    }
    const job = validacoesService.obterJob(jobId);
    if (!job) {
      jsonError(res, `Job ${jobId} não encontrado`, 404);
      return;
    }
    jsonSuccess(res, {
      job_id: jobId,
      status: job.status,
      progress: job.progress,
      total: job.total,
      done: job.processed,
      ok: job.ok,
      invalidas: job.invalidas,
      errors: job.erros,
      processed: job.processed,
      items: job.items ?? [],
    });
  })
);

router.post(
  '/:job_id/cancel',
  asyncHandler(async (req: Request, res: Response) => {
    const jobId = String(req.params.job_id ?? '').trim();
    if (!jobId) {
      jsonError(res, 'job_id é obrigatório', 400);
      return;
    }
    const ok = validacoesService.cancelarJob(jobId);
    if (!ok) {
      jsonError(res, `Job ${jobId} não encontrado ou já finalizado`, 404);
      return;
    }
    jsonSuccess(res, { cancelled: true });
  })
);

export default router;
