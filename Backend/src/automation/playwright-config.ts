/**
 * Configuração do Playwright para automação NFSe.
 *
 * Centraliza timeout, headless e outras configurações usadas
 * pelos scripts de automação.
 */

import {
  PLAYWRIGHT_TIMEOUT,
  PLAYWRIGHT_HEADLESS,
} from '../infrastructure/config';
import { getLogger } from '../infrastructure/logger';

const logger = getLogger('playwright-config');

export interface PlaywrightConfig {
  /** Timeout em milissegundos para operações (default: 30000) */
  timeout: number;
  /** Se true, executa navegador em modo headless */
  headless: boolean;
  /** Ignorar erros de certificado SSL */
  ignoreHttpsErrors: boolean;
  /** Configuração do viewport (width, height) */
  viewport: { width: number; height: number };
  /** Argumentos extras para o Chromium */
  args: string[];
}

export const defaultPlaywrightConfig: PlaywrightConfig = {
  timeout: PLAYWRIGHT_TIMEOUT,
  headless: PLAYWRIGHT_HEADLESS,
  ignoreHttpsErrors: true,
  viewport: { width: 1920, height: 1080 },
  args: [
    '--disable-features=DownloadBubble,DownloadBubbleV2',
    '--disable-features=SafeBrowsing',
    '--safebrowsing-disable-auto-update',
    '--safebrowsing-disable-download-protection',
    '--disable-web-security',
    '--allow-running-insecure-content',
    '--disable-notifications',
    '--disable-infobars',
  ],
};

/**
 * Retorna a configuração do Playwright para uso nos scripts.
 */
export function getPlaywrightConfig(overrides?: Partial<PlaywrightConfig>): PlaywrightConfig {
  const config = { ...defaultPlaywrightConfig, ...overrides };
  logger.debug(
    `Config: timeout=${config.timeout}ms, headless=${config.headless}, viewport=${config.viewport.width}x${config.viewport.height}`
  );
  return config;
}
