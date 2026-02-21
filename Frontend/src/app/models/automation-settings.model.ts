/** Presets de execução para usuários não técnicos */
export type ExecutionPreset = 'RAPIDO' | 'PADRAO' | 'ESTAVEL';

export type ViewportPreset = 'DESKTOP_1366x768' | 'HD' | 'FULLHD' | 'QHD' | 'CUSTOM';

export interface AutomationSettings {
  headless: boolean;
  companyTimeoutSeconds: number;
  maxRetriesPerStep: number;
  minActionDelayMs: number;
  maxConcurrentBrowsers: number;
  defaultConcurrentBrowsers: number;
  browserLaunchDelayMs: number;
  viewportPreset: ViewportPreset;
  viewportWidth?: number;
  viewportHeight?: number;
  downloadsBasePath: string;
  downloadsPattern: string;
  logsPath: string;
  tempPath: string;
  logLevel: 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';
  saveErrorScreenshots: boolean;
  generatePdfReport: boolean;
  logRetentionDays: number;
  maxErrorsInPanel: number;
}

/** Valores por preset de execução */
export const PRESET_VALUES: Record<ExecutionPreset, Partial<AutomationSettings>> = {
  RAPIDO: {
    headless: true,
    companyTimeoutSeconds: 600,
    maxRetriesPerStep: 2,
    minActionDelayMs: 200,
    maxConcurrentBrowsers: 4,
    defaultConcurrentBrowsers: 4,
    browserLaunchDelayMs: 500,
    viewportPreset: 'DESKTOP_1366x768',
  },
  PADRAO: {
    headless: false,
    companyTimeoutSeconds: 1800,
    maxRetriesPerStep: 3,
    minActionDelayMs: 500,
    maxConcurrentBrowsers: 3,
    defaultConcurrentBrowsers: 3,
    browserLaunchDelayMs: 1000,
    viewportPreset: 'FULLHD',
  },
  ESTAVEL: {
    headless: false,
    companyTimeoutSeconds: 3600,
    maxRetriesPerStep: 5,
    minActionDelayMs: 1000,
    maxConcurrentBrowsers: 2,
    defaultConcurrentBrowsers: 1,
    browserLaunchDelayMs: 2000,
    viewportPreset: 'FULLHD',
  },
};

export interface ConfigStatus {
  apiUp: boolean;
  dbConnected: boolean;
  supabaseConfigured: boolean;
  playwrightOk: boolean;
  corsOrigins: string[];
  port: number;
  version?: string;
}

export interface TestPathsResponse {
  previewResolvedPath: string;
  checks: {
    downloadsWritable: boolean;
    logsWritable: boolean;
    tempWritable: boolean;
    canCreateSubfolders: boolean;
    errors: string[];
  };
}
