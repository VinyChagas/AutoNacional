/**
 * Validação de credenciais (CNPJ + senha) no portal NFSe Nacional.
 * Tenta login via formulário e verifica acesso ao dashboard.
 */
import { chromium } from 'playwright';
import { getLogger } from '../infrastructure/logger';
import { PLAYWRIGHT_HEADLESS } from '../infrastructure/config';

const logger = getLogger('validar-credencial-nfse');
const BASE_URL = 'https://www.nfse.gov.br/EmissorNacional/';

export async function validarCredencialNfse(
  cnpj: string,
  senha: string,
  timeoutSeconds = 60
): Promise<boolean> {
  const cnpjLimpo = cnpj.replace(/[.\/\-\s]/g, '');
  if (cnpjLimpo.length !== 14 || !senha?.trim()) {
    return false;
  }

  let browser;
  try {
    browser = await chromium.launch({ headless: PLAYWRIGHT_HEADLESS ?? true });
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();
    page.setDefaultTimeout(timeoutSeconds * 1000);

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(1000);

    const selectorsCnpjSenha = [
      'input[name="cnpj"]',
      'input[id="cnpj"]',
      'input[placeholder*="CNPJ"]',
      'input[type="text"]',
    ];
    const selectorsSenha = [
      'input[name="senha"]',
      'input[id="senha"]',
      'input[type="password"]',
      'input[placeholder*="Senha"]',
    ];

    let inputCnpj = null;
    let inputSenha = null;
    for (const sel of selectorsCnpjSenha) {
      const el = page.locator(sel).first();
      if ((await el.count()) > 0) {
        inputCnpj = el;
        break;
      }
    }
    for (const sel of selectorsSenha) {
      const el = page.locator(sel).first();
      if ((await el.count()) > 0) {
        inputSenha = el;
        break;
      }
    }

    if (!inputCnpj || !inputSenha) {
      logger.debug('Campos CNPJ/senha não encontrados no portal - formato pode ter mudado');
      return false;
    }

    await inputCnpj.fill(cnpjLimpo, { timeout: 5000 });
    await inputSenha.fill(senha, { timeout: 5000 });

    const btnLogin = page.locator(
      'button:has-text("Entrar"), button:has-text("Acessar"), input[type="submit"], .btn-login, #btnLogin'
    ).first();
    if ((await btnLogin.count()) > 0) {
      await btnLogin.click({ timeout: 5000 });
    }

    await page.waitForTimeout(3000);

    const urlAtual = page.url();
    const dashboardEncontrado =
      urlAtual.includes('Dashboard') ||
      urlAtual.includes('Painel') ||
      (await page.locator('text=Dashboard, text=Painel').count()) > 0;

    await context.close();
    await browser.close();

    return dashboardEncontrado;
  } catch (err) {
    logger.warn({ err, cnpj: cnpjLimpo }, 'Erro ao validar credencial NFSe');
    try {
      if (browser) await browser.close();
    } catch {
      /* ignore */
    }
    return false;
  }
}
