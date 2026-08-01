/**
 * Automação para processar notas fiscais de uma competência no portal NFSe Nacional.
 *
 * Varredura de notas emitidas e recebidas, com download de XML e DANFS-e (PDF).
 * hCaptcha: 2captcha (automático) com rqdata opcional; retry por operação (novo CAPTCHA);
 * modo MANUAL / fallback: Tab/Enter no browser → token legítimo → #btnSubmitHCaptcha.
 */

import { Page, Locator } from 'playwright';
import { setDownloadsBasePath } from './download-manager';
import { getLogger } from '../infrastructure/logger';
import { captchaConfigurado, CaptchaError } from './captcha-solver';
import {
  reportCaptchaDetectado,
  reportSolucaoSubmetidaNoSite,
  reportCaptchaFalha,
} from './captcha-report';
import {
  CAPTCHA_MANUAL_TIMEOUT_MS,
  CAPTCHA_MANUAL_USE_CENTRAL,
} from '../infrastructure/config';
import {
  criarContextoOperacao,
  executarDownloadNotaComRetry,
  extrairIdentificadorDaLinha,
  localizarNotaPorIdentificador,
} from './download-operation';
import {
  CAPTCHA_SUBMIT_SELECTOR,
  capturarDadosCaptcha,
  aplicarTokenCaptchaNaPagina,
} from './hcaptcha-page';
import { getCaptchaProvider } from './captcha/get-captcha-provider';
import type { CaptchaMode } from './captcha/types';
import { resolverCaptchaPorCliquesRemotos } from './manual-captcha-remote';
import {
  tratarHCaptchaManual,
  type CaptchaContexto,
} from './hcaptcha-manual-handler';
import {
  newAttemptId,
  captureOriginalPageSnapshot,
  initAttemptReport,
  ensureDebugDir,
  captureDebugScreenshot,
  finalizeAttemptReport,
  writeDiagnosticJson,
} from './captcha-diagnostic';

const logger = getLogger('processar-notas');

export { setDownloadsBasePath };

/** Callback opcional para emitir estágio SSE (ex.: aguardando captcha). */
export type CaptchaStageCallback = (stage: string, message: string) => void;

let _minActionDelayMs = 500;

/** IDs da execução atual (propagados pelo execution-service). */
export interface ExecutionIds {
  executionId: string;
  empresaId: string;
  batchId?: string;
  /** Modo de captcha do lote (TWO_CAPTCHA | MANUAL). */
  captchaMode?: CaptchaMode;
  empresaNome?: string;
  cnpj?: string;
}

export function setMinActionDelayMs(ms: number): void {
  _minActionDelayMs = ms;
}

export function getMinActionDelayMs(): number {
  return _minActionDelayMs;
}

function notificarCaptcha(
  onCaptchaStage: CaptchaStageCallback | undefined,
  stage: string,
  message: string
): void {
  logger.info({ stage }, message);
  try {
    onCaptchaStage?.(stage, message);
  } catch {
    /* callback não deve derrubar o fluxo */
  }
}

async function resolverCaptchaAutomatico(
  page: Page,
  onCaptchaStage?: CaptchaStageCallback
): Promise<void> {
  if (!captchaConfigurado()) {
    throw new CaptchaError(
      'TWOCAPTCHA_API_KEY não configurada',
      'ERROR_CONFIGURATION'
    );
  }

  const dados = await capturarDadosCaptcha(page);
  if (!dados) {
    throw new CaptchaError(
      'Não foi possível extrair o sitekey do hCaptcha',
      'ERROR_CONFIGURATION'
    );
  }

  let userAgent: string | undefined;
  try {
    userAgent = String(await page.evaluate('navigator.userAgent'));
  } catch {
    /* opcional */
  }

  reportCaptchaDetectado({
    sitekey: dados.sitekey,
    pageurl: dados.pageurl,
    userAgent,
    ...(dados.rqdata ? { rqdata: dados.rqdata } : {}),
  });

  notificarCaptcha(
    onCaptchaStage,
    'captcha_resolvendo',
    'hCaptcha detectado — solicitando solução ao 2captcha'
  );

  logger.info(
    {
      sitekey: dados.sitekey,
      pageurl: dados.pageurl,
      hasRqdata: Boolean(dados.rqdata),
    },
    'hCaptcha detectado — solicitando solução ao 2captcha'
  );

  let token: string;
  try {
    const solution = await getCaptchaProvider('TWO_CAPTCHA').solve({
      batchId: '',
      executionId: '',
      empresaId: '',
      empresaNome: '',
      cnpj: '',
      siteKey: dados.sitekey,
      pageUrl: dados.pageurl,
      userAgent,
      ...(dados.rqdata ? { rqdata: dados.rqdata } : {}),
    });
    if (solution.status !== 'RESOLVED' || !solution.token) {
      throw new CaptchaError(
        solution.reason || '2Captcha não retornou token',
        'ERROR_CAPTCHA_UNSOLVABLE'
      );
    }
    token = solution.token;
  } catch (e) {
    reportCaptchaFalha({
      etapa: 'resolverHCaptcha',
      erro: (e as Error).message,
    });
    throw e;
  }

  try {
    logger.info(
      { evento: 'manual_captcha_injection_started', provider: 'TWO_CAPTCHA' },
      'Injetando token 2Captcha na página'
    );
    await aplicarTokenCaptchaNaPagina(page, token);
    reportSolucaoSubmetidaNoSite({
      pageurl: dados.pageurl,
      camposInjetados: ['h-captcha-response', 'g-recaptcha-response'],
      botaoConfirmacao: CAPTCHA_SUBMIT_SELECTOR,
      sucesso: true,
    });
    notificarCaptcha(
      onCaptchaStage,
      'captcha_resolvido',
      'Captcha resolvido automaticamente (2captcha)'
    );
    logger.debug('Modal de captcha confirmado (2captcha)');
  } catch (e) {
    reportSolucaoSubmetidaNoSite({
      pageurl: dados.pageurl,
      camposInjetados: ['h-captcha-response', 'g-recaptcha-response'],
      botaoConfirmacao: CAPTCHA_SUBMIT_SELECTOR,
      sucesso: false,
      erro: (e as Error).message,
    });
    throw e;
  }
}

/**
 * Resolve hCaptcha via Central Manual por cliques remotos:
 * screenshot do Playwright → operador clica na Central → mouse no browser.
 * TIMEOUT / SKIPPED → CaptchaError retryable para regenerar o desafio.
 */
async function resolverCaptchaCentral(
  page: Page,
  executionIds: ExecutionIds,
  onCaptchaStage?: CaptchaStageCallback
): Promise<void> {
  const attemptId = newAttemptId();
  const dados = await capturarDadosCaptcha(page);
  if (!dados) {
    throw new CaptchaError(
      'Não foi possível extrair o sitekey do hCaptcha',
      'ERROR_CONFIGURATION'
    );
  }

  if (!executionIds.batchId) {
    throw new CaptchaError(
      'batchId obrigatório para Central Manual de Captchas',
      'ERROR_CONFIGURATION'
    );
  }

  let userAgent: string | undefined;
  try {
    userAgent = String(await page.evaluate('navigator.userAgent'));
  } catch {
    /* opcional */
  }

  const snapshot = await captureOriginalPageSnapshot(page, {
    batchId: executionIds.batchId,
    executionId: executionIds.executionId,
    attemptId,
  });
  snapshot.siteKey = dados.sitekey;
  snapshot.rqdata = dados.rqdata || snapshot.rqdata;
  snapshot.action = dados.action || snapshot.action;
  snapshot.callbackName = dados.callbackName || snapshot.callbackName;
  snapshot.pageUrl = dados.pageurl;

  initAttemptReport({
    batchId: executionIds.batchId,
    executionId: executionIds.executionId,
    empresaId: executionIds.empresaId,
    captchaId: 'pending',
    attemptId,
    snapshot,
  });
  await ensureDebugDir(executionIds.batchId, executionIds.executionId, attemptId);
  await captureDebugScreenshot(page, attemptId, '01-original-detected');

  reportCaptchaDetectado({
    sitekey: dados.sitekey,
    pageurl: dados.pageurl,
    userAgent,
    ...(dados.rqdata ? { rqdata: dados.rqdata } : {}),
  });

  notificarCaptcha(
    onCaptchaStage,
    'captcha_aguardando_central',
    'Aguardando cliques na Central de Captchas (print remoto)'
  );

  logger.info(
    {
      evento: 'manual_captcha_remote_started',
      batchId: executionIds.batchId,
      executionId: executionIds.executionId,
      empresaId: executionIds.empresaId,
      attemptId,
      pageurl: dados.pageurl,
    },
    'Iniciando resolução MANUAL por screenshot + cliques remotos'
  );

  const solution = await resolverCaptchaPorCliquesRemotos(page, {
    batchId: executionIds.batchId,
    executionId: executionIds.executionId,
    empresaId: executionIds.empresaId,
    empresaNome: executionIds.empresaNome || executionIds.empresaId,
    cnpj: executionIds.cnpj || '',
    siteKey: dados.sitekey,
    pageUrl: dados.pageurl,
    userAgent,
    attemptId,
    ...(dados.rqdata ? { rqdata: dados.rqdata } : {}),
    ...(dados.action ? { action: dados.action } : {}),
    ...(dados.callbackName ? { callbackName: dados.callbackName } : {}),
  });

  if (solution.status === 'SKIPPED' || solution.status === 'TIMEOUT') {
    finalizeAttemptReport(
      attemptId,
      solution.status === 'SKIPPED' ? 'SKIPPED' : 'TIMEOUT',
      solution.status === 'SKIPPED' ? 'Operador pulou o desafio' : 'Timeout na Central'
    );
    await writeDiagnosticJson(attemptId);
    throw new CaptchaError(
      solution.status === 'SKIPPED'
        ? 'Captcha pulado na Central Manual — gerando nova tentativa'
        : 'Timeout na Central Manual — gerando nova tentativa',
      'ERROR_CAPTCHA_UNSOLVABLE'
    );
  }

  if (solution.status === 'CANCELLED') {
    finalizeAttemptReport(attemptId, 'CANCELLED', solution.reason || 'cancelado');
    await writeDiagnosticJson(attemptId);
    throw new CaptchaError(
      solution.reason || 'Captcha cancelado (execução/lote finalizado)',
      'ERROR_CONFIGURATION'
    );
  }

  if (solution.status !== 'RESOLVED') {
    finalizeAttemptReport(attemptId, 'ERROR', 'Status inesperado na Central');
    await writeDiagnosticJson(attemptId);
    throw new CaptchaError(
      'Central Manual não concluiu o desafio',
      'ERROR_CAPTCHA_UNSOLVABLE'
    );
  }

  // remote_click: o desafio já foi resolvido no browser do Playwright
  const modalAindaVisivel = await page
    .locator(CAPTCHA_SUBMIT_SELECTOR)
    .isVisible()
    .catch(() => false);

  if (modalAindaVisivel) {
    finalizeAttemptReport(
      attemptId,
      'MODAL_REMAINED_OPEN',
      'Modal ainda aberto após resolução remota'
    );
    await writeDiagnosticJson(attemptId);
    reportCaptchaFalha({
      etapa: 'portal_apos_central_remote',
      erro: 'Modal de captcha ainda visível após remote_click',
    });
    throw new CaptchaError(
      'Modal de captcha ainda aberto após resolução na Central',
      'ERROR_CAPTCHA_UNSOLVABLE'
    );
  }

  finalizeAttemptReport(
    attemptId,
    'RESOLVED_REMOTE_CLICK',
    `Resolvido por ${solution.resolvedBy || 'remote_click'}`
  );
  await writeDiagnosticJson(attemptId);
  await captureDebugScreenshot(page, attemptId, '04-after-remote-resolve');

  reportSolucaoSubmetidaNoSite({
    pageurl: dados.pageurl,
    camposInjetados: [],
    botaoConfirmacao: CAPTCHA_SUBMIT_SELECTOR,
    sucesso: true,
  });
  notificarCaptcha(
    onCaptchaStage,
    'captcha_resolvido',
    'Captcha resolvido na Central (cliques remotos)'
  );
  logger.info(
    {
      evento: 'manual_captcha_remote_finished',
      batchId: executionIds.batchId,
      executionId: executionIds.executionId,
      empresaId: executionIds.empresaId,
      captchaId: solution.captchaId,
      attemptId,
      resolvedBy: solution.resolvedBy,
    },
    'Captcha resolvido por cliques remotos'
  );
}

/**
 * Resolução MANUAL no navegador Playwright:
 * animação → Tab/Tab/Enter → usuário resolve → detecta token → Confirmar.
 * Usado no fallback (CAPTCHA_MODE) e no modo de lote MANUAL.
 */
async function aguardarResolucaoManual(
  page: Page,
  onCaptchaStage?: CaptchaStageCallback,
  contexto?: CaptchaContexto
): Promise<void> {
  const result = await tratarHCaptchaManual(page, contexto || {}, {
    timeoutMs: CAPTCHA_MANUAL_TIMEOUT_MS,
    modalJaVisivel: true,
    onStage: onCaptchaStage,
  });

  if (result.status === 'RESOLVED') {
    return;
  }

  if (result.status === 'MODAL_NOT_FOUND') {
    // Caller já detectou o modal; se sumiu, o download pode ter seguido.
    return;
  }

  throw new CaptchaError(
    result.reason ||
      `Falha na resolução manual do hCaptcha (${result.status})`,
    'ERROR_CAPTCHA_UNSOLVABLE'
  );
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
 * Cada arquivo é uma operação independente com retry de CAPTCHA no nível da operação.
 */
async function baixarArquivosDaLinha(
  page: Page,
  rowLocator: Locator,
  basePath: string,
  nomeContabilidade: string,
  mesExecucaoExtenso: string,
  nomeEmpresa: string,
  tipoNota: 'Emitidas' | 'Recebidas',
  baixarPdf: boolean = true,
  onCaptchaStage?: CaptchaStageCallback,
  executionIds?: ExecutionIds,
  indiceLinha?: number
): Promise<void> {
  const { chaveNfse, numeroNota } = await extrairIdentificadorDaLinha(rowLocator);
  const prefixo = numeroNota ? `${numeroNota}_` : undefined;
  const execId =
    executionIds?.executionId ||
    `anon-${nomeEmpresa}-${Date.now()}`;
  const empresaId = executionIds?.empresaId || '0';

  const captchaContextoBase: CaptchaContexto = {
    executionId: execId,
    empresaId,
    batchId: executionIds?.batchId,
  };

  const deps = {
    onStage: onCaptchaStage,
    resolverCaptchaAutomatico: (p: Page) =>
      resolverCaptchaAutomatico(p, onCaptchaStage),
    /** MANUAL (lote ou fallback): Tab/Enter + token legítimo + #btnSubmitHCaptcha. */
    aguardarResolucaoManual: (p: Page) =>
      aguardarResolucaoManual(p, onCaptchaStage, captchaContextoBase),
    /** Opt-in: Central remota (CAPTCHA_MANUAL_USE_CENTRAL=true). */
    resolverCaptchaCentral:
      executionIds?.captchaMode === 'MANUAL' &&
      CAPTCHA_MANUAL_USE_CENTRAL &&
      Boolean(executionIds.batchId)
        ? (p: Page) => resolverCaptchaCentral(p, executionIds, onCaptchaStage)
        : undefined,
  };

  const ctxXml = criarContextoOperacao({
    executionId: execId,
    empresaId,
    batchId: executionIds?.batchId,
    captchaMode: executionIds?.captchaMode,
    tipoNota,
    tipoArquivo: 'xml',
    chaveNfse,
    numeroNota,
    indiceLinhaOriginal: indiceLinha,
    basePath,
    nomeContabilidade,
    mesExecucaoExtenso,
    nomeEmpresa,
    nomeArquivoPrefixo: prefixo,
  });

  try {
    const resXml = await executarDownloadNotaComRetry(page, rowLocator, ctxXml, deps);
    if (!resXml.success) {
      logger.warn({ err: resXml.error, chave: chaveNfse }, 'Falha ao baixar XML');
    }
  } catch (e) {
    logger.warn({ err: e }, 'Erro ao baixar XML');
  }

  if (!baixarPdf) return;

  await page.waitForTimeout(_minActionDelayMs);

  // Relocaliza a linha (DOM pode ter mudado após XML)
  let rowPdf = rowLocator;
  try {
    rowPdf = await localizarNotaPorIdentificador(page, {
      ...ctxXml,
      tipoArquivo: 'pdf',
    });
  } catch {
    rowPdf = rowLocator;
  }

  const ctxPdf = criarContextoOperacao({
    executionId: execId,
    empresaId,
    batchId: executionIds?.batchId,
    captchaMode: executionIds?.captchaMode,
    tipoNota,
    tipoArquivo: 'pdf',
    chaveNfse,
    numeroNota,
    indiceLinhaOriginal: indiceLinha,
    basePath,
    nomeContabilidade,
    mesExecucaoExtenso,
    nomeEmpresa,
    nomeArquivoPrefixo: prefixo,
  });

  try {
    const resPdf = await executarDownloadNotaComRetry(page, rowPdf, ctxPdf, deps);
    if (!resPdf.success) {
      logger.warn({ err: resPdf.error, chave: chaveNfse }, 'Falha ao baixar DANFS-e');
    }
  } catch (e) {
    logger.warn({ err: e }, 'Erro ao baixar DANFS-e');
  }
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
  baixarPdf: boolean = true,
  onCaptchaStage?: CaptchaStageCallback,
  executionIds?: ExecutionIds
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
          await baixarArquivosDaLinha(
            page,
            linha,
            basePath,
            nomeContabilidade,
            mesExecucaoExtenso,
            nomeEmpresa,
            'Emitidas',
            baixarPdf,
            onCaptchaStage,
            executionIds,
            i
          );
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
  baixarPdf: boolean = true,
  onCaptchaStage?: CaptchaStageCallback,
  executionIds?: ExecutionIds
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
          await baixarArquivosDaLinha(
            page,
            linha,
            basePath,
            nomeContabilidade,
            mesExecucaoExtenso,
            nomeEmpresa,
            'Recebidas',
            baixarPdf,
            onCaptchaStage,
            executionIds,
            i
          );
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
