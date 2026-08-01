/**
 * Configuração do Playwright para automação NFSe.
 *
 * Centraliza timeout, headless e outras configurações usadas
 * pelos scripts de automação.
 */

import { BrowserContext } from 'playwright';
import {
  PLAYWRIGHT_TIMEOUT,
  PLAYWRIGHT_HEADLESS,
  BROWSER_PAGE_ZOOM,
} from '../infrastructure/config';
import { getLogger } from '../infrastructure/logger';

const logger = getLogger('playwright-config');

export interface PlaywrightConfig {
  /** Timeout em milissegundos para operações (default: 60000) */
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
  // Fallback de conteúdo — a resolução do monitor NÃO é o tamanho da janela.
  // Em execução real o slot visual define viewport + --window-size (769×…).
  viewport: { width: 769, height: 680 },
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

/**
 * Aplica zoom de página em todas as navegações do contexto (padrão 80%).
 * Usa CSS zoom no documentElement — estável no Chromium e reaplicado a cada load.
 */
export async function aplicarZoomPaginaNoContexto(
  context: BrowserContext,
  zoom: number = BROWSER_PAGE_ZOOM
): Promise<void> {
  if (!Number.isFinite(zoom) || zoom === 1) return;

  // Script como string para não exigir lib DOM no tsconfig do Backend
  const zoomCss = JSON.stringify(String(zoom));
  await context.addInitScript({
    content: `(() => {
      var z = ${zoomCss};
      var apply = function () {
        try { document.documentElement.style.zoom = z; } catch (e) {}
      };
      apply();
      document.addEventListener('DOMContentLoaded', apply);
    })();`,
  });

  logger.debug({ zoom }, 'Zoom de página configurado no contexto Playwright');
}
