import type { Settings } from '@prisma/client';
export declare function obterConfiguracoes(): Promise<Settings | null>;
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
export declare function atualizarConfiguracoes(data: SettingsUpdate): Promise<Settings>;
//# sourceMappingURL=settings.d.ts.map