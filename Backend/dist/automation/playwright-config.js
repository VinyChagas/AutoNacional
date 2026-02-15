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
const config_1 = require("../infrastructure/config");
const logger_1 = require("../infrastructure/logger");
const logger = (0, logger_1.getLogger)('playwright-config');
exports.defaultPlaywrightConfig = {
    timeout: config_1.PLAYWRIGHT_TIMEOUT,
    headless: config_1.PLAYWRIGHT_HEADLESS,
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
function getPlaywrightConfig(overrides) {
    const config = { ...exports.defaultPlaywrightConfig, ...overrides };
    logger.debug(`Config: timeout=${config.timeout}ms, headless=${config.headless}, viewport=${config.viewport.width}x${config.viewport.height}`);
    return config;
}
//# sourceMappingURL=playwright-config.js.map