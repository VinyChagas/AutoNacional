/**
 * Repositório de configurações (Settings).
 */
import { prisma } from '../db/client';
import type { Settings } from '@prisma/client';

export async function obterConfiguracoes(): Promise<Settings | null> {
  return prisma.settings.findFirst();
}

export type SettingsUpdate = Partial<{
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
}>;

export async function atualizarConfiguracoes(data: SettingsUpdate): Promise<Settings> {
  const existing = await prisma.settings.findFirst();
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined) clean[k] = v;
  }
  if (existing) {
    return prisma.settings.update({
      where: { id: existing.id },
      data: clean as Parameters<typeof prisma.settings.update>[0]['data'],
    });
  }
  return prisma.settings.create({
    data: {
      headless: data.headless ?? false,
      companyTimeoutSeconds: data.companyTimeoutSeconds ?? 300,
      maxRetriesPerStep: data.maxRetriesPerStep ?? 3,
      minActionDelayMs: data.minActionDelayMs ?? 500,
      maxConcurrentBrowsers: data.maxConcurrentBrowsers ?? 5,
      defaultConcurrentBrowsers: data.defaultConcurrentBrowsers ?? 3,
      browserLaunchDelayMs: data.browserLaunchDelayMs ?? 1000,
      viewportPreset: data.viewportPreset ?? 'FULLHD',
      viewportWidth: data.viewportWidth ?? null,
      viewportHeight: data.viewportHeight ?? null,
      downloadsBasePath: data.downloadsBasePath ?? './downloads',
      downloadsPattern: data.downloadsPattern ?? '{cnpj}/{ano}/{mes}',
      logsPath: data.logsPath ?? './logs',
      tempPath: data.tempPath ?? './temp',
      logLevel: data.logLevel ?? 'INFO',
      saveErrorScreenshots: data.saveErrorScreenshots ?? true,
      generatePdfReport: data.generatePdfReport ?? true,
      logRetentionDays: data.logRetentionDays ?? 30,
      maxErrorsInPanel: data.maxErrorsInPanel ?? 100,
    },
  });
}
