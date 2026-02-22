/**
 * Router de status do ambiente (READ-ONLY).
 * Nunca expõe chaves sensíveis.
 */
import { Router, Request, Response } from 'express';
import { getLogger } from '../infrastructure/logger';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/client';
import {
  SUPABASE_URL,
  CORS_ORIGINS,
  PORT,
} from '../infrastructure/config';

const logger = getLogger('config');

function isPlaywrightInstalled(): Promise<boolean> {
  return import('playwright')
    .then(() => true)
    .catch(() => false);
}

/**
 * GET /api/config/status
 * Retorna status do ambiente sem expor segredos.
 */
const router = Router();

router.get('/status', async (_req: Request, res: Response) => {
  try {
    let dbConnected = false;
    try {
      await prisma.$queryRaw(Prisma.sql`SELECT 1`);
      dbConnected = true;
    } catch {
      dbConnected = false;
    }

    const playwrightOk = await isPlaywrightInstalled();

    res.json({
      apiUp: true,
      dbConnected,
      supabaseConfigured: Boolean(SUPABASE_URL && SUPABASE_URL.length > 0),
      playwrightOk,
      corsOrigins: CORS_ORIGINS,
      port: PORT,
      version: process.env.npm_package_version || '1.0.0',
    });
  } catch (error) {
    logger.error({ err: error }, 'Erro ao obter status');
    res.status(500).json({
      apiUp: true,
      dbConnected: false,
      supabaseConfigured: false,
      playwrightOk: false,
      error: 'Falha ao verificar status',
    });
  }
});

export default router;
