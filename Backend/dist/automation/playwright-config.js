"use strict";
/**
 * Configuração do Playwright para automação NFSe.
 *
 * Centraliza timeout, headless e outras configurações usadas
 * pelos scripts de automação.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultPlaywrightConfig = void 0;
exports.getPlaywrightConfig = getPlaywrightConfig;
exports.aplicarZoomPaginaNoContexto = aplicarZoomPaginaNoContexto;
const config_1 = require("../infrastructure/config");
const logger_1 = require("../infrastructure/logger");
const logger = (0, logger_1.getLogger)('playwright-config');
exports.defaultPlaywrightConfig = {
    timeout: config_1.PLAYWRIGHT_TIMEOUT,
    headless: config_1.PLAYWRIGHT_HEADLESS,
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
function getPlaywrightConfig(overrides) {
    const config = { ...exports.defaultPlaywrightConfig, ...overrides };
    logger.debug(`Config: timeout=${config.timeout}ms, headless=${config.headless}, viewport=${config.viewport.width}x${config.viewport.height}`);
    return config;
}
/**
 * Aplica zoom de página em todas as navegações do contexto (padrão 80%).
 * Usa CSS zoom no documentElement — estável no Chromium e reaplicado a cada load.
 */
async function aplicarZoomPaginaNoContexto(context, zoom = config_1.BROWSER_PAGE_ZOOM) {
    if (!Number.isFinite(zoom) || zoom === 1)
        return;
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
//# sourceMappingURL=playwright-config.js.map