/**
 * Router de validações (certificados e credenciais).
 * Jobs em memória com suporte a polling.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getLogger } from '../infrastructure/logger';
import { asyncHandler } from '../middleware/error-handler';
import { jsonSuccess, jsonError, jsonCreated } from '../middleware/response';
import * as validacoesService from '../services/validacoes-service';

const logger = getLogger('validacoes');
const router = Router();

const StartSchema = z.object({
  targets: z.array(z.enum(['CERTIFICADO', 'CREDENCIAL'])).min(1),
  scope: z.object({
    mode: z.enum(['SELECTED', 'FILTERED', 'ALL']),
    empresa_ids: z.array(z.number().int().positive()).optional(),
  }),
  filters: z
    .object({
      search: z.string().optional(),
      contabilidade_id: z.number().optional(),
      has_cert: z.boolean().optional(),
      has_cred: z.boolean().optional(),
      sem_cert: z.boolean().optional(),
      sem_cred: z.boolean().optional(),
      sem_metodo: z.boolean().optional(),
      sort: z.string().optional(),
      order: z.enum(['asc', 'desc']).optional(),
    })
    .optional(),
  options: z
    .object({
      concurrency: z.number().int().min(1).max(8).optional(),
      timeoutSeconds: z.number().int().min(10).max(300).optional(),
      stopOnConsecutiveErrors: z.number().int().min(1).max(20).optional(),
    })
    .optional(),
});

router.post(
  '/start',
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = StartSchema.safeParse(req.body);
    if (!parsed.success) {
      jsonError(res, parsed.error.issues?.[0]?.message ?? 'Payload inválido', 400);
      return;
    }
    const jobId = await validacoesService.iniciarValidacao(parsed.data);
    logger.info({ jobId }, 'Validação iniciada');
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
      ok: job.ok,
      errors: job.errors,
      processed: job.processed,
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
