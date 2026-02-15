/**
 * Inicialização do banco de dados.
 * Cria registros padrão (Settings) se não existirem.
 */
import { prisma } from './client';
import { getLogger } from '../infrastructure/logger';

const logger = getLogger('db:init');

export async function seedDefaultSettings(): Promise<void> {
  const count = await prisma.settings.count();
  if (count === 0) {
    await prisma.settings.create({
      data: {
        headless: false,
        companyTimeoutSeconds: 300,
        maxRetriesPerStep: 3,
        minActionDelayMs: 500,
        maxConcurrentBrowsers: 5,
        defaultConcurrentBrowsers: 3,
        browserLaunchDelayMs: 1000,
        viewportPreset: 'FULLHD',
        downloadsBasePath: './downloads',
        downloadsPattern: '{cnpj}/{ano}/{mes}',
        logsPath: './logs',
        tempPath: './temp',
        logLevel: 'INFO',
        saveErrorScreenshots: true,
        generatePdfReport: true,
        logRetentionDays: 30,
        maxErrorsInPanel: 100,
      },
    });
    logger.info('Settings padrão criadas');
  }
}
