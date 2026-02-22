/**
 * Controller para logs de execução.
 * Persiste logs de lote no Supabase (execucao_log_batch + execucao_log_item).
 */
import { Request, Response } from 'express';
import { getSupabaseClient } from '../config/supabase';
import { getLogger } from '../infrastructure/logger';
import {
  validarPayloadSalvarLog,
  salvarLogExecucoesService,
  type PayloadSalvarLog,
} from '../services/logs-execucao.service';

const logger = getLogger('logs-controller');

export async function salvarLogExecucoes(req: Request, res: Response): Promise<void> {
  try {
    const validation = validarPayloadSalvarLog(req.body);
    if (!validation.valid) {
      res.status(400).json({ detail: validation.error });
      return;
    }

    const payload = validation.payload as PayloadSalvarLog;
    const result = await salvarLogExecucoesService(payload);

    if (result.conflict) {
      res.status(409).json({ detail: 'Log já existe para este batch_id' });
      return;
    }

    res.status(201).json({
      success: true,
      batch_log_id: result.batchLogId,
      saved: true,
    });
  } catch (error) {
    logger.error({ err: error }, 'Erro ao salvar log de execuções');
    res.status(500).json({ detail: 'Erro ao salvar log de execuções' });
  }
}
