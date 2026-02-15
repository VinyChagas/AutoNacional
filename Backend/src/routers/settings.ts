/**
 * Router de configurações de automação.
 */
import { Router, Request, Response } from 'express';
import { getLogger } from '../infrastructure/logger';
import * as repo from '../repositories/settings';

const logger = getLogger('settings');
const router = Router();

function toResponse(s: {
  id: number;
  headless: boolean;
  companyTimeoutSeconds: number;
  maxRetriesPerStep: number;
  minActionDelayMs: number;
  maxConcurrentBrowsers: number;
  defaultConcurrentBrowsers: number;
  browserLaunchDelayMs: number;
  viewportPreset: string;
  viewportWidth: number | null;
  viewportHeight: number | null;
  downloadsBasePath: string;
  downloadsPattern: string;
  logsPath: string;
  tempPath: string;
  logLevel: string;
  saveErrorScreenshots: boolean;
  generatePdfReport: boolean;
  logRetentionDays: number;
  maxErrorsInPanel: number;
}) {
  return {
    id: s.id,
    headless: s.headless,
    companyTimeoutSeconds: s.companyTimeoutSeconds,
    maxRetriesPerStep: s.maxRetriesPerStep,
    minActionDelayMs: s.minActionDelayMs,
    maxConcurrentBrowsers: s.maxConcurrentBrowsers,
    defaultConcurrentBrowsers: s.defaultConcurrentBrowsers,
    browserLaunchDelayMs: s.browserLaunchDelayMs,
    viewportPreset: s.viewportPreset,
    viewportWidth: s.viewportWidth,
    viewportHeight: s.viewportHeight,
    downloadsBasePath: s.downloadsBasePath,
    downloadsPattern: s.downloadsPattern,
    logsPath: s.logsPath,
    tempPath: s.tempPath,
    logLevel: s.logLevel,
    saveErrorScreenshots: s.saveErrorScreenshots,
    generatePdfReport: s.generatePdfReport,
    logRetentionDays: s.logRetentionDays,
    maxErrorsInPanel: s.maxErrorsInPanel,
  };
}

/**
 * GET /api/settings
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    logger.info('Endpoint GET /api/settings chamado');
    const config = await repo.obterConfiguracoes();
    if (!config) {
      res.status(500).json({ detail: 'Erro ao obter configurações' });
      return;
    }
    res.json(toResponse(config));
  } catch (error) {
    logger.error({ err: error }, 'Erro ao obter configurações');
    res.status(500).json({ detail: 'Erro ao obter configurações' });
  }
});

/**
 * PUT /api/settings
 * Converte camelCase do frontend para o repositório.
 */
router.put('/', async (req: Request, res: Response) => {
  try {
    logger.info('Endpoint PUT /api/settings chamado');
    const body = req.body as Record<string, unknown>;
    const data: repo.SettingsUpdate = {};

    if (body.headless != null) data.headless = Boolean(body.headless);
    if (body.companyTimeoutSeconds != null)
      data.companyTimeoutSeconds = Number(body.companyTimeoutSeconds);
    if (body.maxRetriesPerStep != null)
      data.maxRetriesPerStep = Number(body.maxRetriesPerStep);
    if (body.minActionDelayMs != null)
      data.minActionDelayMs = Number(body.minActionDelayMs);
    if (body.maxConcurrentBrowsers != null)
      data.maxConcurrentBrowsers = Number(body.maxConcurrentBrowsers);
    if (body.defaultConcurrentBrowsers != null)
      data.defaultConcurrentBrowsers = Number(body.defaultConcurrentBrowsers);
    if (body.browserLaunchDelayMs != null)
      data.browserLaunchDelayMs = Number(body.browserLaunchDelayMs);
    if (body.viewportPreset != null)
      data.viewportPreset = String(body.viewportPreset);
    if (body.viewportWidth != null)
      data.viewportWidth = body.viewportWidth === null ? null : Number(body.viewportWidth);
    if (body.viewportHeight != null)
      data.viewportHeight = body.viewportHeight === null ? null : Number(body.viewportHeight);
    if (body.downloadsBasePath != null)
      data.downloadsBasePath = String(body.downloadsBasePath);
    if (body.downloadsPattern != null)
      data.downloadsPattern = String(body.downloadsPattern);
    if (body.logsPath != null) data.logsPath = String(body.logsPath);
    if (body.tempPath != null) data.tempPath = String(body.tempPath);
    if (body.logLevel != null) data.logLevel = String(body.logLevel);
    if (body.saveErrorScreenshots != null)
      data.saveErrorScreenshots = Boolean(body.saveErrorScreenshots);
    if (body.generatePdfReport != null)
      data.generatePdfReport = Boolean(body.generatePdfReport);
    if (body.logRetentionDays != null)
      data.logRetentionDays = Number(body.logRetentionDays);
    if (body.maxErrorsInPanel != null)
      data.maxErrorsInPanel = Number(body.maxErrorsInPanel);

    const config = await repo.atualizarConfiguracoes(data);
    res.json(toResponse(config));
  } catch (error) {
    logger.error({ err: error }, 'Erro ao atualizar configurações');
    res.status(500).json({ detail: 'Erro ao atualizar configurações' });
  }
});

export default router;
