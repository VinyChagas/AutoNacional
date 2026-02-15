"use strict";
/**
 * Script de validação mínima do Playwright.
 *
 * Executa: npm run test:playwright
 *
 * Checklist: Script mínimo abre navegador e fecha sem erro.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const playwright_1 = require("playwright");
const playwright_config_1 = require("../playwright-config");
const logger_1 = require("../../infrastructure/logger");
const logger = (0, logger_1.getLogger)('test-playwright');
async function main() {
    logger.info('Iniciando teste mínimo do Playwright...');
    const config = (0, playwright_config_1.getPlaywrightConfig)({ headless: true });
    const browser = await playwright_1.chromium.launch({
        headless: config.headless,
        args: config.args,
    });
    const context = await browser.newContext({
        ignoreHTTPSErrors: config.ignoreHttpsErrors,
        viewport: config.viewport,
    });
    const page = await context.newPage();
    await page.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: config.timeout });
    const title = await page.title();
    logger.info(`Título da página: ${title}`);
    await page.close();
    await context.close();
    await browser.close();
    logger.info('Teste concluído com sucesso. Playwright está funcionando.');
}
main().catch((err) => {
    logger.error({ err, message: err?.message, stack: err?.stack }, 'Erro no teste Playwright');
    process.exit(1);
});
//# sourceMappingURL=test-playwright.js.map