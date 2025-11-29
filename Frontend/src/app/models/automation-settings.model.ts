export interface AutomationSettings {
  // Execução Geral
  headless: boolean;
  companyTimeoutSeconds: number;
  maxRetriesPerStep: number;
  minActionDelayMs: number;

  // Navegadores / Concorrência
  maxConcurrentBrowsers: number;
  defaultConcurrentBrowsers: number;
  browserLaunchDelayMs: number;
  viewportPreset: 'HD' | 'FULLHD' | 'QHD' | 'CUSTOM';
  viewportWidth?: number;
  viewportHeight?: number;

  // Diretórios
  downloadsBasePath: string;
  downloadsPattern: string;
  logsPath: string;
  tempPath: string;

  // Logs & Relatórios
  logLevel: 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';
  saveErrorScreenshots: boolean;
  generatePdfReport: boolean;
  logRetentionDays: number;
  maxErrorsInPanel: number;
}

