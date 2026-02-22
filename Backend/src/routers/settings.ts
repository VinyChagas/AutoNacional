/**
 * Router de configurações de automação.
 * Endpoints: GET, PUT, GET /defaults, POST /reset, POST /test-paths
 */
import { Router, Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs/promises';
import { getLogger } from '../infrastructure/logger';
import { openNativeFolderPicker } from '../utils/native-folder-picker';
import { resolveStoragePath } from '../utils/path-resolve';
import * as repo from '../repositories/settings';
import type { Settings } from '@prisma/client';

const logger = getLogger('settings');
const router = Router();

/** Valores padrão "factory" para comparação e reset */
export const DEFAULT_SETTINGS = {
  headless: false,
  companyTimeoutSeconds: 3600,
  maxRetriesPerStep: 3,
  minActionDelayMs: 500,
  maxConcurrentBrowsers: 5,
  defaultConcurrentBrowsers: 3,
  browserLaunchDelayMs: 1000,
  viewportPreset: 'FULLHD',
  viewportWidth: null as number | null,
  viewportHeight: null as number | null,
  downloadsBasePath: './downloads',
  downloadsPattern: '{cnpj}/{ano}/{mes}',
  logsPath: './logs',
  tempPath: './temp',
  logLevel: 'INFO',
  saveErrorScreenshots: true,
  generatePdfReport: true,
  logRetentionDays: 30,
  maxErrorsInPanel: 100,
};

type SettingsFlat = Omit<Settings, 'id'>;

function toResponse(s: Settings | SettingsFlat) {
  return {
    id: 'id' in s ? s.id : undefined,
    execution: {
      headless: s.headless,
      companyTimeoutSeconds: s.companyTimeoutSeconds,
      maxRetriesPerStep: s.maxRetriesPerStep,
      minActionDelayMs: s.minActionDelayMs,
    },
    browsers: {
      maxConcurrentBrowsers: s.maxConcurrentBrowsers,
      defaultConcurrentBrowsers: s.defaultConcurrentBrowsers,
      browserLaunchDelayMs: s.browserLaunchDelayMs,
      viewportPreset: s.viewportPreset,
      viewportWidth: s.viewportWidth,
      viewportHeight: s.viewportHeight,
    },
    paths: {
      downloadsBasePath: s.downloadsBasePath,
      downloadsPattern: s.downloadsPattern,
      logsPath: s.logsPath,
      tempPath: s.tempPath,
    },
    logs: {
      logLevel: s.logLevel,
      saveErrorScreenshots: s.saveErrorScreenshots,
      generatePdfReport: s.generatePdfReport,
      logRetentionDays: s.logRetentionDays,
      maxErrorsInPanel: s.maxErrorsInPanel,
    },
    // Flat para compatibilidade com frontend que pode esperar formato antigo
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

function parseBodyToUpdate(body: Record<string, unknown>): repo.SettingsUpdate {
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
  return data;
}

/** Validações server-side para PUT */
function validateSettings(data: repo.SettingsUpdate): { valid: boolean; errors: Array<{ field: string; message: string }> } {
  const errors: Array<{ field: string; message: string }> = [];
  const maxC = data.maxConcurrentBrowsers ?? 5;
  const defC = data.defaultConcurrentBrowsers ?? 3;
  if (defC > maxC) {
    errors.push({
      field: 'defaultConcurrentBrowsers',
      message: 'Padrão de navegadores não pode ser maior que o máximo',
    });
  }
  if (data.viewportPreset === 'CUSTOM') {
    const w = data.viewportWidth ?? 0;
    const h = data.viewportHeight ?? 0;
    if (!w || !h || w < 1 || h < 1) {
      errors.push({
        field: 'viewportWidth',
        message: 'Com viewport CUSTOM, largura e altura são obrigatórias e devem ser > 0',
      });
    }
  }
  return { valid: errors.length === 0, errors };
}

/** Resolve pattern de downloads com placeholders */
function resolveDownloadsPattern(
  basePath: string,
  pattern: string,
  sample: { cnpj?: string; competencia?: string }
): string {
  const cnpjRaw = (sample.cnpj || '00.000.000/0001-00').replace(/\D/g, '');
  const comp = sample.competencia || '2026-01';
  const [ano, mes] = comp.includes('/')
    ? comp.split('/').reverse()
    : comp.includes('-')
      ? comp.split('-')
      : [comp.slice(4), comp.slice(0, 2)];
  let resolved = pattern
    .replace(/\{cnpj\}/gi, cnpjRaw)
    .replace(/\{ano\}/gi, ano || '2026')
    .replace(/\{mes\}/gi, mes || '01');
  const full = path.join(basePath, resolved);
  return path.normalize(full);
}

/** Verifica se diretório existe (ou pode ser criado) e tem permissão de escrita */
async function checkPathWritable(dirPath: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const normalized = resolveStoragePath(dirPath);
    try {
      await fs.mkdir(normalized, { recursive: true });
    } catch {
      /* pode já existir */
    }
    const stat = await fs.stat(normalized);
    if (!stat.isDirectory()) {
      return { ok: false, error: 'Não é um diretório' };
    }
    const testFile = path.join(normalized, `.write-test-${Date.now()}`);
    await fs.writeFile(testFile, 'test', 'utf8');
    await fs.unlink(testFile);
    return { ok: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

/** Verifica se consegue criar subpastas */
async function checkCanCreateSubfolders(dirPath: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const normalized = resolveStoragePath(dirPath);
    try {
      await fs.mkdir(normalized, { recursive: true });
    } catch {
      /* pode já existir */
    }
    const testDir = path.join(normalized, `test-sub-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
    await fs.rmdir(testDir);
    return { ok: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

/**
 * GET /api/settings
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
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
 * GET /api/settings/defaults
 */
router.get('/defaults', (_req: Request, res: Response) => {
  res.json(toResponse(DEFAULT_SETTINGS as SettingsFlat));
});

/**
 * PUT /api/settings
 */
router.put('/', async (req: Request, res: Response) => {
  try {
    const body = req.body as Record<string, unknown>;
    const data = parseBodyToUpdate(body);
    const validation = validateSettings(data);
    if (!validation.valid) {
      res.status(422).json({
        detail: 'Validação falhou',
        errors: validation.errors,
      });
      return;
    }
    const config = await repo.atualizarConfiguracoes(data);
    res.json(toResponse(config));
  } catch (error) {
    logger.error({ err: error }, 'Erro ao atualizar configurações');
    res.status(500).json({ detail: 'Erro ao atualizar configurações' });
  }
});

/**
 * POST /api/settings/reset
 */
router.post('/reset', async (_req: Request, res: Response) => {
  try {
    const config = await repo.atualizarConfiguracoes(DEFAULT_SETTINGS as repo.SettingsUpdate);
    res.json(toResponse(config));
  } catch (error) {
    logger.error({ err: error }, 'Erro ao resetar configurações');
    res.status(500).json({ detail: 'Erro ao resetar configurações' });
  }
});

/**
 * POST /api/settings/test-paths
 * Body: { downloadsBasePath, downloadsPattern, logsPath, tempPath, sample?: { cnpj, competencia } }
 */
router.post('/test-paths', async (req: Request, res: Response) => {
  try {
    const body = req.body as {
      downloadsBasePath?: string;
      downloadsPattern?: string;
      logsPath?: string;
      tempPath?: string;
      sample?: { cnpj?: string; competencia?: string };
    };
    const basePath = body.downloadsBasePath ?? './downloads';
    const pattern = body.downloadsPattern ?? '{cnpj}/{ano}/{mes}';
    const logsPath = body.logsPath ?? './logs';
    const tempPath = body.tempPath ?? './temp';
    const sample = body.sample ?? { cnpj: '00.000.000/0001-00', competencia: '2026-01' };

    const baseResolved = resolveStoragePath(basePath);
    const previewResolvedPath = resolveDownloadsPattern(baseResolved, pattern, sample);

    const [downloadsCheck, logsCheck, tempCheck] = await Promise.all([
      checkPathWritable(basePath),
      checkPathWritable(logsPath),
      checkPathWritable(tempPath),
    ]);

    const canCreateSubfolders = (await checkCanCreateSubfolders(basePath)).ok;

    const errors: string[] = [];
    if (!downloadsCheck.ok) errors.push(`Downloads: ${downloadsCheck.error}`);
    if (!logsCheck.ok) errors.push(`Logs: ${logsCheck.error}`);
    if (!tempCheck.ok) errors.push(`Temp: ${tempCheck.error}`);

    res.json({
      previewResolvedPath,
      checks: {
        downloadsWritable: downloadsCheck.ok,
        logsWritable: logsCheck.ok,
        tempWritable: tempCheck.ok,
        canCreateSubfolders,
        errors,
      },
    });
  } catch (error) {
    logger.error({ err: error }, 'Erro ao testar diretórios');
    res.status(500).json({ detail: 'Erro ao testar diretórios' });
  }
});

/**
 * POST /api/settings/select-folder
 * Abre seletor nativo de pasta no servidor e retorna o caminho absoluto.
 * Requer que o backend rode na mesma máquina do usuário (ex: desenvolvimento local).
 */
router.post('/select-folder', async (_req: Request, res: Response) => {
  try {
    const selectedPath = await openNativeFolderPicker();
    if (!selectedPath) {
      res.status(400).json({ detail: 'Nenhuma pasta selecionada', path: null });
      return;
    }
    res.json({ path: selectedPath });
  } catch (error) {
    logger.error({ err: error }, 'Erro ao abrir seletor de pasta');
    res.status(500).json({ detail: 'Erro ao abrir seletor de pasta', path: null });
  }
});

export default router;
