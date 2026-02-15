/**
 * Script de validação mínima do Playwright.
 *
 * Executa: npm run test:playwright
 *
 * Checklist: Script mínimo abre navegador e fecha sem erro.
 */

import { chromium } from 'playwright';
import { getPlaywrightConfig } from '../playwright-config';
import { getLogger } from '../../infrastructure/logger';

const logger = getLogger('test-playwright');

async function main() {
  logger.info('Iniciando teste mínimo do Playwright...');

  const config = getPlaywrightConfig({ headless: true });

  const browser = await chromium.launch({
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
