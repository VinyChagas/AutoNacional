/**
 * Validação de credenciais (CNPJ ou CPF + senha) no portal NFSe Nacional.
 * Tenta login via formulário e verifica acesso ao dashboard.
 * Aceita documento com 11 dígitos (CPF) ou 14 dígitos (CNPJ) - sem adicionar zeros.
 */
import { chromium } from 'playwright';
import { getLogger } from '../infrastructure/logger';

const logger = getLogger('validar-credencial-nfse');
const BASE_URL = 'https://www.nfse.gov.br/EmissorNacional/';

export type ResultadoValidacaoCredencial = {
  ok: boolean;
  status: 'OK' | 'INVALIDA' | 'ERRO_VALIDACAO';
  message: string;
};

export async function validarCredencialNfse(
  documento: string,
  senha: string,
  opts: { timeoutSeconds?: number; headless?: boolean } = {}
): Promise<ResultadoValidacaoCredencial> {
  const timeoutSeconds = opts.timeoutSeconds ?? 60;
  const headless = opts.headless ?? true;
  const docLimpo = documento.replace(/[.\/\-\s]/g, '');
  const isCpf = docLimpo.length === 11;
  const isCnpj = docLimpo.length === 14;
  if ((!isCpf && !isCnpj) || !senha?.trim()) {
    return { ok: false, status: 'INVALIDA', message: 'Documento (CPF/CNPJ) ou senha inválidos' };
  }

  let browser;
  try {
    browser = await chromium.launch({
      headless,
      ...(headless ? {} : { slowMo: 50 }),
    });
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();
    page.setDefaultTimeout(timeoutSeconds * 1000);

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(1000);

    const selectorsDocumento = [
      'input[name="cnpj"]',
      'input[name="usuario"]',
      'input[id="cnpj"]',
      'input[id="usuario"]',
      'input[placeholder*="CNPJ"]',
      'input[placeholder*="CPF"]',
      'input[placeholder*="Usuário"]',
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
    for (const sel of selectorsDocumento) {
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
      logger.debug('Campos documento/senha não encontrados no portal - formato pode ter mudado');
      return { ok: false, status: 'ERRO_VALIDACAO', message: 'Portal NFSe: campos não encontrados' };
    }

    await inputCnpj.fill(docLimpo, { timeout: 5000 });
    await inputSenha.fill(senha, { timeout: 5000 });

    const btnLogin = page.locator(
      'button:has-text("Entrar"), button:has-text("Acessar"), input[type="submit"], .btn-login, #btnLogin'
    ).first();
    if ((await btnLogin.count()) > 0) {
      await btnLogin.click({ timeout: 5000 });
    }

    // Aguardar possível redirect ou atualização SPA (portal pode ser single-page)
    await page.waitForTimeout(5000);

    const urlAtual = page.url();

    // 1) Verificar indicadores de FALHA explícitos (prioridade)
    const textoPagina = await page.locator('body').innerText().catch(() => '');
    const falhaIndicadores = [
      'senha incorreta',
      'credencial inválida',
      'usuário ou senha inválidos',
      'acesso negado',
      'dados incorretos',
      'tente novamente',
    ];
    const temIndicadorFalha = falhaIndicadores.some((t) =>
      textoPagina.toLowerCase().includes(t)
    );
    if (temIndicadorFalha) {
      logger.debug({ urlAtual }, 'Portal exibiu mensagem de falha no login');
      await context.close();
      await browser.close();
      return { ok: false, status: 'INVALIDA', message: 'Senha incorreta ou credenciais inválidas' };
    }

    // 2) Sucesso por URL (redirect típico após login)
    const urlLower = urlAtual.toLowerCase();
    const urlIndicaSucesso =
      urlLower.includes('dashboard') ||
      urlLower.includes('painel') ||
      urlLower.includes('/home') ||
      urlLower.includes('/principal');

    // 3) Sucesso por conteúdo da página (SPA pode manter mesma URL)
    // Não usar "Portal de Gestão" - aparece também na tela de login
    const seletoresSucesso = [
      'text=/dashboard/i',
      'text=/painel/i',
      'text=/emissor nacional/i',
      'text=/área do emissor/i',
      'text=/bem-vindo/i',
      '[href*="Dashboard"]',
      '[href*="dashboard"]',
      '[href*="Painel"]',
      '[href*="painel"]',
      '.dashboard',
      '#dashboard',
      'a:has-text("Emitir")',
      'a:has-text("Notas Fiscais")',
      'a:has-text("Consultar")',
    ];
    let conteudoIndicaSucesso = false;
    for (const sel of seletoresSucesso) {
      try {
        const loc = page.locator(sel).first();
        if ((await loc.count()) > 0) {
          const visivel = await loc.isVisible().catch(() => false);
          if (visivel) {
            conteudoIndicaSucesso = true;
            logger.debug({ selector: sel }, 'Elemento de sucesso encontrado');
            break;
          }
        }
      } catch {
        continue;
      }
    }

    // 4) Formulário de login sumiu = provável sucesso
    const loginAindaVisivel = await inputCnpj.isVisible().catch(() => false);
    const formSumiu = !loginAindaVisivel;

    const dashboardEncontrado =
      urlIndicaSucesso || conteudoIndicaSucesso || (formSumiu && !temIndicadorFalha);

    const tituloPagina = await page.title().catch(() => '');
    logger.debug(
      { urlAtual, tituloPagina, urlIndicaSucesso, conteudoIndicaSucesso, formSumiu, temIndicadorFalha },
      'Resultado da verificação de login'
    );

    await context.close();
    await browser.close();

    if (dashboardEncontrado) {
      return { ok: true, status: 'OK', message: 'Credencial válida' };
    }

    // Login falhou - provável senha incorreta
    return { ok: false, status: 'INVALIDA', message: 'Senha incorreta' };
  } catch (err) {
    logger.warn({ err, documento: docLimpo.substring(0, 6) + '***' }, 'Erro ao validar credencial NFSe');
    try {
      if (browser) await browser.close();
    } catch {
      /* ignore */
    }
    const msg = err instanceof Error ? err.message : 'Falha ao validar';
    return { ok: false, status: 'ERRO_VALIDACAO', message: msg.slice(0, 200) };
  }
}
