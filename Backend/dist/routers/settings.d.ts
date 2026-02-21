declare const router: import("express-serve-static-core").Router;
/** Valores padrão "factory" para comparação e reset */
export declare const DEFAULT_SETTINGS: {
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
};
export default router;
//# sourceMappingURL=settings.d.ts.map