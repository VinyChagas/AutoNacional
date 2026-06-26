/**
 * Automação para processar notas fiscais de uma competência no portal NFSe Nacional.
 *
 * Varredura de notas emitidas e recebidas, com download de XML e DANFS-e (PDF).
 */

import { Page, Locator } from 'playwright';
import { setDownloadsBasePath, salvarDownloadDireto } from './download-manager';
import { getLogger } from '../infrastructure/logger';

const logger = getLogger('processar-notas');

export { setDownloadsBasePath };

/** Timeout para waitForEvent('download') e click em downloads. 45-60s recomendado para lote. */
const DOWNLOAD_TIMEOUT_MS = 50000;

let _minActionDelayMs = 500;

export function setMinActionDelayMs(ms: number): void {
  _minActionDelayMs = ms;
}

export function getMinActionDelayMs(): number {
  return _minActionDelayMs;
}

/**
 * Normaliza a competência para comparação.
 * Aceita: "MM/AAAA", "MM-AAAA", "MMAAAA"
 */
export function normalizarCompetencia(valor: string): string {
  if (!valor || !valor.trim()) return '';
  const competencia = valor.trim();
  if (competencia.includes('/')) return competencia;
  if (competencia.includes('-')) return competencia.replace(/-/g, '/');
  if (competencia.length === 6 && /^\d+$/.test(competencia)) {
    return `${competencia.slice(0, 2)}/${competencia.slice(2)}`;
  }
  return competencia;
}

/**
 * Encontra e clica no botão "Próxima" página.
 */
async function clicarBotaoProximaPagina(page: Page): Promise<boolean> {
  const estrategias = [
    'i.fa-angle-right',
    'a:has(i.fa-angle-right)',
    'xpath=//i[@class="fa fa-angle-right"]',
    'xpath=//a[.//i[contains(@class,"fa-angle-right")]]',
  ];

  for (const selector of estrategias) {
    try {
      const botao = page.locator(selector).nth(0);
      if ((await botao.count()) > 0) {
        const parent = botao.locator('..');
        const liClass = await parent.locator('..').getAttribute('class');
        if (liClass?.toLowerCase().includes('disabled')) return false;
        await botao.click();
        await page.waitForLoadState('networkidle', { timeout: 10000 });
        await page.waitForSelector('table tbody tr', { timeout: 8000 });
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}

/**
 * Verifica se a página exibe "Nenhum registro encontrado".
 */
export async function verificarSemRegistros(page: Page): Promise<boolean> {
  const selectors = [
    'xpath=/html/body/div[1]/span',
    'span.sem-registros',
    'text=Nenhum registro encontrado',
  ];
  for (const selector of selectors) {
    try {
      const el = page.locator(selector);
      if ((await el.count()) > 0) {
        const texto = selector.startsWith('text=') ? '' : await el.innerText();
        if (selector.startsWith('text=') || (texto && texto.includes('Nenhum registro encontrado'))) {
          return true;
        }
      }
    } catch {
      /* ignore */
    }
  }
  return false;
}

/**
 * Verifica se uma nota está cancelada.
 */
async function verificarNotaCancelada(rowLocator: Locator): Promise<boolean> {
  try {
    const celulas = rowLocator.locator('td');
    for (const colIdx of [4, 5]) {
      const coluna = celulas.nth(colIdx);
      const img = coluna.locator('img');
      if ((await img.count()) > 0) {
        const src = await img.getAttribute('src');
        const title = await img.getAttribute('data-original-title') || await img.getAttribute('title');
        if (src?.toLowerCase().includes('cancelada') || title?.toLowerCase().includes('cancelada')) {
          return true;
        }
      }
    }
  } catch {
    /* ignore */
  }
  return false;
}

/**
 * Verifica se uma nota é válida (não cancelada).
 * Retorna { valida: boolean; cancelada: boolean } para contar canceladas.
 */
async function verificarNotaValida(rowLocator: Locator): Promise<{ valida: boolean; cancelada: boolean }> {
  const cancelada = await verificarNotaCancelada(rowLocator);
  if (cancelada) {
    logger.debug('Nota cancelada detectada. Não será baixada.');
    return { valida: false, cancelada: true };
  }
  return { valida: true, cancelada: false };
}

/**
 * Baixa XML e (opcionalmente) DANFS-e de uma linha da tabela.
 * Usa nomeContabilidade e mesExecucaoExtenso para a estrutura de pastas (não a competência da nota).
 * basePath deve ser único por execução/empresa para evitar sobreposição em lote.
 * @param baixarPdf - quando false, baixa apenas o XML (pula o DANFS-e/PDF).
 */
async function baixarArquivosDaLinha(
  page: Page,
  rowLocator: Locator,
  basePath: string,
  nomeContabilidade: string,
  mesExecucaoExtenso: string,
  nomeEmpresa: string,
  tipoNota: 'Emitidas' | 'Recebidas',
  baixarPdf: boolean = true
): Promise<void> {
  const colunaAcoesIdx = tipoNota === 'Emitidas' ? 6 : 5;
  const celulas = rowLocator.locator('td');

  let numeroNota: string | null = null;
  for (const idx of [0, 1, 2, 3]) {
    try {
      const texto = (await celulas.nth(idx).innerText()).trim();
      if (texto && /\d/.test(texto)) {
        numeroNota = texto.replace(/[/\\]/g, '-').replace(/\s/g, '_').slice(0, 50);
        break;
      }
    } catch {
      /* ignore */
    }
  }

  const colunaAcoes = celulas.nth(colunaAcoesIdx);
  const iconeAcoes = colunaAcoes.locator('div a i, a i').nth(0);
  await iconeAcoes.click();

  const menuSuspenso = rowLocator.locator('.menu-suspenso-tabela');
  await menuSuspenso.waitFor({ state: 'visible', timeout: 3000 });

  const prefixo = numeroNota ? `${numeroNota}_` : undefined;

  try {
    let linkXml = page.getByRole('link', { name: 'Download XML' });
    if ((await linkXml.count()) === 0) {
      linkXml = menuSuspenso.locator('a:has-text("XML")');
    }
    const [downloadXml] = await Promise.all([
      page.waitForEvent('download', { timeout: DOWNLOAD_TIMEOUT_MS }),
      linkXml.nth(0).click({ timeout: DOWNLOAD_TIMEOUT_MS }),
    ]);
    await salvarDownloadDireto(downloadXml, basePath, nomeContabilidade, mesExecucaoExtenso, nomeEmpresa, tipoNota, prefixo);
  } catch (e) {
    const err = e as Error;
    const isTimeout = err.name === 'TimeoutError' || /timeout/i.test(err.message);
    if (isTimeout) {
      logger.debug({ err: e }, 'Timeout ao baixar XML (arquivo ignorado, execução continua)');
    } else {
      logger.warn({ err: e }, 'Erro ao baixar XML');
    }
  }

  if (baixarPdf) {
    await iconeAcoes.click();
    await page.waitForTimeout(_minActionDelayMs);
    await iconeAcoes.click();
    await menuSuspenso.waitFor({ state: 'visible', timeout: 3000 });

    try {
      let linkPdf = page.getByRole('link', { name: 'Download DANFS-e' });
      if ((await linkPdf.count()) === 0) {
        linkPdf = menuSuspenso.locator('a:has-text("DANFS-e")');
      }
      const [downloadPdf] = await Promise.all([
        page.waitForEvent('download', { timeout: DOWNLOAD_TIMEOUT_MS }),
        linkPdf.nth(0).click({ timeout: DOWNLOAD_TIMEOUT_MS }),
      ]);
      await salvarDownloadDireto(downloadPdf, basePath, nomeContabilidade, mesExecucaoExtenso, nomeEmpresa, tipoNota, prefixo);
    } catch (e) {
      const err = e as Error;
      const isTimeout = err.name === 'TimeoutError' || /timeout/i.test(err.message);
      if (isTimeout) {
        logger.debug({ err: e }, 'Timeout ao baixar DANFS-e (arquivo ignorado, execução continua)');
      } else {
        logger.warn({ err: e }, 'Erro ao baixar DANFS-e');
      }
    }
  }

  await iconeAcoes.click();
}

/**
 * Processa a tabela de notas emitidas.
 * A pasta usa nomeContabilidade e mesExecucaoExtenso (mês da execução), não a competência da nota.
 */
export async function processarTabelaEmitidas(
  page: Page,
  basePath: string,
  nomeContabilidade: string,
  mesExecucaoExtenso: string,
  nomeEmpresa: string,
  baixarPdf: boolean = true
): Promise<{ qtd_baixadas: number; qtd_canceladas: number; sem_registros: boolean; encontrou_notas: boolean }> {
  if (await verificarSemRegistros(page)) {
    return { qtd_baixadas: 0, qtd_canceladas: 0, sem_registros: true, encontrou_notas: false };
  }

  let qtdBaixadas = 0;
  let qtdCanceladas = 0;
  let encontrouNotas = false;

  while (true) {
    await page.waitForSelector('table tbody tr', { timeout: 10000 });
    const linhas = page.locator('table tbody tr');
    const total = await linhas.count();
    if (total === 0) break;

    for (let i = 0; i < total; i++) {
      const linha = linhas.nth(i);
      try {
        encontrouNotas = true;

        const { valida, cancelada } = await verificarNotaValida(linha);
        if (cancelada) qtdCanceladas++;
        if (valida) {
          await baixarArquivosDaLinha(page, linha, basePath, nomeContabilidade, mesExecucaoExtenso, nomeEmpresa, 'Emitidas', baixarPdf);
          qtdBaixadas++;
        }
      } catch (e) {
        logger.debug({ err: e }, `Erro ao processar linha ${i + 1}`);
      }
    }

    const mudou = await clicarBotaoProximaPagina(page);
    if (!mudou) break;
    await page.waitForTimeout(_minActionDelayMs);
  }

  return { qtd_baixadas: qtdBaixadas, qtd_canceladas: qtdCanceladas, sem_registros: false, encontrou_notas: encontrouNotas };
}

/**
 * Processa a tabela de notas recebidas.
 * A pasta usa nomeContabilidade e mesExecucaoExtenso (mês da execução), não a competência da nota.
 */
export async function processarTabelaRecebidas(
  page: Page,
  basePath: string,
  nomeContabilidade: string,
  mesExecucaoExtenso: string,
  nomeEmpresa: string,
  baixarPdf: boolean = true
): Promise<{ qtd_baixadas: number; qtd_canceladas: number; sem_registros: boolean; encontrou_notas: boolean }> {
  if (await verificarSemRegistros(page)) {
    return { qtd_baixadas: 0, qtd_canceladas: 0, sem_registros: true, encontrou_notas: false };
  }

  let qtdBaixadas = 0;
  let qtdCanceladas = 0;
  let encontrouNotas = false;

  while (true) {
    await page.waitForSelector('table tbody tr', { timeout: 10000 });
    const linhas = page.locator('table tbody tr');
    const total = await linhas.count();
    if (total === 0) break;

    for (let i = 0; i < total; i++) {
      const linha = linhas.nth(i);
      try {
        encontrouNotas = true;

        const { valida, cancelada } = await verificarNotaValida(linha);
        if (cancelada) qtdCanceladas++;
        if (valida) {
          await baixarArquivosDaLinha(page, linha, basePath, nomeContabilidade, mesExecucaoExtenso, nomeEmpresa, 'Recebidas', baixarPdf);
          qtdBaixadas++;
        }
      } catch (e) {
        logger.debug({ err: e }, `Erro ao processar linha ${i + 1}`);
      }
    }

    const mudou = await clicarBotaoProximaPagina(page);
    if (!mudou) break;
    await page.waitForTimeout(_minActionDelayMs);
  }

  return { qtd_baixadas: qtdBaixadas, qtd_canceladas: qtdCanceladas, sem_registros: false, encontrou_notas: encontrouNotas };
}

/**
 * Preenche datas e clica em filtrar.
 */
export async function preencherDatasEFiltrar(
  page: Page,
  dataInicio: string,
  dataFim: string
): Promise<void> {
  const campoInicio = page.locator('xpath=//*[@id="datainicio"]');
  const campoFim = page.locator('xpath=//*[@id="datafim"]');
  await campoInicio.waitFor({ state: 'visible', timeout: 10000 });
  await campoFim.waitFor({ state: 'visible', timeout: 10000 });

  await campoInicio.fill('');
  await campoInicio.fill(dataInicio);
  await campoFim.fill('');
  await campoFim.fill(dataFim);

  await page.waitForTimeout(_minActionDelayMs);

  const botaoFiltrar = page.locator('xpath=//*[@id="searchbar"]/form/div[2]/div[2]/div[2]/button');
  await botaoFiltrar.click();
  await page.waitForLoadState('networkidle', { timeout: 10000 });
  await page.waitForTimeout(_minActionDelayMs * 2);
}
