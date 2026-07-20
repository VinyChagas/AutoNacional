/**
 * Retry de download no nível da operação de negócio (XML/PDF por nota).
 *
 * Em ERROR_CAPTCHA_UNSOLVABLE (e similares): fecha o modal (#btnLimpar),
 * relocaliza a nota, reclica o mesmo botão e cria uma NOVA tarefa 2Captcha.
 * Não reutiliza taskId, token, modal ou desafio anterior.
 */

import { randomUUID } from 'crypto';
import { Page, Locator, Download } from 'playwright';
import { getLogger } from '../infrastructure/logger';
import { sleep } from '../utils/sleep';
import {
  CAPTCHA_OPERATION_MAX_ATTEMPTS,
  CAPTCHA_OPERATION_RETRY_DELAY_MS,
  CAPTCHA_MODAL_CLOSE_TIMEOUT_MS,
  CAPTCHA_NEW_CHALLENGE_TIMEOUT_MS,
  CAPTCHA_NOTE_RELOCATION_TIMEOUT_MS,
  CAPTCHA_OPERATION_FALLBACK_MANUAL,
  CAPTCHA_CONSECUTIVE_FAILURE_LIMIT,
  CAPTCHA_MODE,
  CAPTCHA_SOLVE_TIMEOUT_MS,
  CAPTCHA_MANUAL_TIMEOUT_MS,
} from '../infrastructure/config';
import {
  salvarDownloadDireto,
  validarArquivoBaixado,
  localizarArquivoExistenteValido,
  removerArquivoInvalido,
} from './download-manager';
import {
  DownloadOperationContext,
  DownloadOperationResult,
  DownloadOperationStatus,
  ExecutionDownloadState,
  TipoArquivoNota,
  TipoNotaUi,
  CaptchaModalCloseError,
  NotaNaoEncontradaParaRetryError,
  classificarErroDaOperacao,
  maskNfseKey,
} from './download-operation-types';

const logger = getLogger('download-operation');

const CAPTCHA_SUBMIT_SELECTOR = '#btnSubmitHCaptcha';
const CAPTCHA_CANCEL_SELECTOR = '#btnLimpar';
const DOWNLOAD_TIMEOUT_MS = 50000;
const CAPTCHA_DETECT_TIMEOUT_MS = 8000;
const CAPTCHA_DOWNLOAD_BUFFER_MS = 60000;
const TABLE_ROW_SELECTOR = 'table tbody tr';

export type StageCallback = (stage: string, message: string) => void;

export interface DownloadOperationDeps {
  onStage?: StageCallback;
  /** Resolve o desafio ATUAL via 2Captcha (uma task). */
  resolverCaptchaAutomatico: (page: Page) => Promise<void>;
  /** Fallback manual apenas para esta operação. */
  aguardarResolucaoManual: (page: Page) => Promise<void>;
}

/** Estado por execução (nunca global entre empresas). */
const executionStates = new Map<string, ExecutionDownloadState>();

function getExecutionState(executionId: string): ExecutionDownloadState {
  let st = executionStates.get(executionId);
  if (!st) {
    st = { consecutiveCaptchaFailures: 0 };
    executionStates.set(executionId, st);
  }
  return st;
}

export function shouldSkipAutoForExecution(executionId: string): boolean {
  const st = getExecutionState(executionId);
  return st.consecutiveCaptchaFailures >= CAPTCHA_CONSECUTIVE_FAILURE_LIMIT;
}

export function markAutoSuccess(executionId: string): void {
  getExecutionState(executionId).consecutiveCaptchaFailures = 0;
}

export function markAutoFinalFailure(executionId: string): void {
  getExecutionState(executionId).consecutiveCaptchaFailures += 1;
}

export function clearExecutionDownloadState(executionId: string): void {
  executionStates.delete(executionId);
}

/** Exposto para testes. */
export function _resetExecutionStatesForTests(): void {
  executionStates.clear();
}

function atualizarOperacao(
  ctx: DownloadOperationContext,
  patch: Partial<DownloadOperationContext>
): void {
  Object.assign(ctx, patch, { updatedAt: new Date().toISOString() });
}

function notificar(
  deps: DownloadOperationDeps,
  stage: string,
  message: string,
  ctx?: DownloadOperationContext
): void {
  if (ctx) {
    logger.info(
      {
        operationId: ctx.operationId,
        executionId: ctx.executionId,
        empresaId: ctx.empresaId,
        batchId: ctx.batchId,
        tipoNota: ctx.tipoNota,
        tipoArquivo: ctx.tipoArquivo,
        attempt: ctx.attempt,
        maxAttempts: ctx.maxAttempts,
        chaveNfseMasked: maskNfseKey(ctx.chaveNfse),
        stage,
      },
      message
    );
  } else {
    logger.info({ stage }, message);
  }
  try {
    deps.onStage?.(stage, message);
  } catch {
    /* ignore */
  }
}

export function criarContextoOperacao(params: {
  executionId: string;
  empresaId: string;
  batchId?: string;
  tipoNota: TipoNotaUi;
  tipoArquivo: TipoArquivoNota;
  chaveNfse: string;
  numeroNota?: string;
  paginaOriginal?: number;
  indiceLinhaOriginal?: number;
  basePath: string;
  nomeContabilidade: string;
  mesExecucaoExtenso: string;
  nomeEmpresa: string;
  nomeArquivoPrefixo?: string;
}): DownloadOperationContext {
  const now = new Date().toISOString();
  return {
    operationId: randomUUID(),
    executionId: params.executionId,
    empresaId: params.empresaId,
    batchId: params.batchId,
    tipoNota: params.tipoNota,
    tipoArquivo: params.tipoArquivo,
    chaveNfse: params.chaveNfse,
    numeroNota: params.numeroNota,
    paginaOriginal: params.paginaOriginal,
    indiceLinhaOriginal: params.indiceLinhaOriginal,
    attempt: 1,
    maxAttempts: CAPTCHA_OPERATION_MAX_ATTEMPTS,
    status: 'pendente',
    startedAt: now,
    updatedAt: now,
    basePath: params.basePath,
    nomeContabilidade: params.nomeContabilidade,
    mesExecucaoExtenso: params.mesExecucaoExtenso,
    nomeEmpresa: params.nomeEmpresa,
    nomeArquivoPrefixo: params.nomeArquivoPrefixo,
  };
}

/**
 * Extrai identificador estável da linha: chave 44 dígitos ou composto.
 */
export async function extrairIdentificadorDaLinha(
  rowLocator: Locator
): Promise<{ chaveNfse: string; numeroNota?: string }> {
  const celulas = rowLocator.locator('td');
  const count = await celulas.count().catch(() => 0);
  const textos: string[] = [];
  for (let i = 0; i < count; i++) {
    try {
      textos.push((await celulas.nth(i).innerText()).trim());
    } catch {
      textos.push('');
    }
  }

  const fullText = textos.join(' ');
  const chaveMatch = fullText.replace(/\s/g, '').match(/\d{44}/);
  if (chaveMatch) {
    return { chaveNfse: chaveMatch[0], numeroNota: acharNumeroNota(textos) };
  }

  // href / data-* na linha
  try {
    const html = await rowLocator.innerHTML();
    const fromHref = html.replace(/\s/g, '').match(/\d{44}/);
    if (fromHref) {
      return { chaveNfse: fromHref[0], numeroNota: acharNumeroNota(textos) };
    }
  } catch {
    /* ignore */
  }

  const numeroNota = acharNumeroNota(textos);
  const composto = [
    numeroNota || '',
    ...textos.map((t) => t.replace(/\s+/g, ' ').slice(0, 40)),
  ]
    .filter(Boolean)
    .join('|');

  return {
    chaveNfse: composto || `row-${Date.now()}`,
    numeroNota,
  };
}

function acharNumeroNota(textos: string[]): string | undefined {
  for (const t of textos.slice(0, 4)) {
    if (t && /\d/.test(t)) {
      return t.replace(/[/\\]/g, '-').replace(/\s/g, '_').slice(0, 50);
    }
  }
  return undefined;
}

export async function fecharModalCaptchaAtual(
  page: Page,
  ctx: DownloadOperationContext,
  deps?: DownloadOperationDeps
): Promise<void> {
  atualizarOperacao(ctx, { status: 'retry_reabrindo_modal' });
  if (deps) {
    notificar(
      deps,
      'captcha_retry_closing_modal',
      'Cancelando o modal atual do CAPTCHA antes do retry',
      ctx
    );
  }

  logger.info(
    {
      operationId: ctx.operationId,
      executionId: ctx.executionId,
      empresaId: ctx.empresaId,
      tipoNota: ctx.tipoNota,
      tipoArquivo: ctx.tipoArquivo,
      attempt: ctx.attempt,
      maxAttempts: ctx.maxAttempts,
      selector: CAPTCHA_CANCEL_SELECTOR,
    },
    'Cancelando o modal atual do CAPTCHA antes do retry'
  );

  type Candidate = { name: string; get: () => Locator };
  const candidates: Candidate[] = [
    { name: '#btnLimpar', get: () => page.locator(CAPTCHA_CANCEL_SELECTOR) },
    {
      name: 'role=button[name=Cancelar]',
      get: () => page.getByRole('button', { name: /^Cancelar$/i }),
    },
    {
      name: 'xpath=//*[@id="btnLimpar"]',
      get: () => page.locator('xpath=//*[@id="btnLimpar"]'),
    },
    {
      name: 'xpath-absoluto',
      get: () =>
        page.locator(
          'xpath=/html/body/div[4]/div/div/div[2]/form/div/div/div/div[2]/button[2]'
        ),
    },
  ];

  let clicked = false;
  let selectedSelector: string | undefined;

  for (const c of candidates) {
    const locator = c.get();
    const exists = (await locator.count().catch(() => 0)) > 0;
    if (!exists) continue;

    const button = locator.last();
    const visible = await button.isVisible().catch(() => false);
    const enabled = await button.isEnabled().catch(() => false);
    if (!visible || !enabled) continue;

    await button.scrollIntoViewIfNeeded().catch(() => undefined);
    await button.click({ timeout: CAPTCHA_MODAL_CLOSE_TIMEOUT_MS });
    clicked = true;
    selectedSelector = c.name;
    break;
  }

  if (!clicked) {
    throw new CaptchaModalCloseError(
      'O botão Cancelar do modal do CAPTCHA não foi encontrado ou não estava utilizável.'
    );
  }

  logger.info(
    { operationId: ctx.operationId, selector: selectedSelector },
    'Botão Cancelar do modal do CAPTCHA acionado'
  );

  await aguardarFechamentoCompletoDoModal(page, ctx);
}

export async function aguardarFechamentoCompletoDoModal(
  page: Page,
  ctx: DownloadOperationContext
): Promise<void> {
  const timeout = CAPTCHA_MODAL_CLOSE_TIMEOUT_MS;

  await page
    .locator(CAPTCHA_CANCEL_SELECTOR)
    .last()
    .waitFor({ state: 'hidden', timeout })
    .catch(async () => {
      const stillVisible = await page
        .locator(CAPTCHA_CANCEL_SELECTOR)
        .last()
        .isVisible()
        .catch(() => false);
      if (stillVisible) {
        throw new CaptchaModalCloseError(
          'O botão Cancelar foi clicado, mas o modal continuou visível.'
        );
      }
    });

  await page
    .locator(CAPTCHA_SUBMIT_SELECTOR)
    .waitFor({ state: 'hidden', timeout })
    .catch(() => undefined);

  await page
    .locator('.modal.show, .modal.in')
    .waitFor({ state: 'hidden', timeout })
    .catch(() => undefined);

  await page
    .locator('.modal-backdrop, .modal-backdrop.show')
    .waitFor({ state: 'detached', timeout })
    .catch(async () => {
      const backdropVisible = await page
        .locator('.modal-backdrop:visible')
        .count()
        .catch(() => 0);
      if (backdropVisible > 0) {
        throw new CaptchaModalCloseError(
          'O modal foi cancelado, mas o backdrop permaneceu bloqueando a página.'
        );
      }
    });

  await page
    .locator(TABLE_ROW_SELECTOR)
    .first()
    .waitFor({ state: 'visible', timeout: CAPTCHA_NOTE_RELOCATION_TIMEOUT_MS })
    .catch(() => undefined);

  logger.info(
    {
      operationId: ctx.operationId,
      modalClosed: true,
      backdropRemoved: true,
    },
    'Modal anterior do CAPTCHA fechado completamente'
  );
}

async function linhaCorresponde(
  row: Locator,
  chaveNfse: string
): Promise<boolean> {
  try {
    const id = await extrairIdentificadorDaLinha(row);
    return id.chaveNfse === chaveNfse;
  } catch {
    return false;
  }
}

export async function localizarNotaPorIdentificador(
  page: Page,
  ctx: DownloadOperationContext
): Promise<Locator> {
  const deadline = Date.now() + CAPTCHA_NOTE_RELOCATION_TIMEOUT_MS;

  const tentarNaPaginaAtual = async (): Promise<Locator | null> => {
    await page.waitForSelector(TABLE_ROW_SELECTOR, {
      timeout: Math.min(10000, CAPTCHA_NOTE_RELOCATION_TIMEOUT_MS),
    }).catch(() => undefined);

    const rows = page.locator(TABLE_ROW_SELECTOR);
    const total = await rows.count();

    if (
      ctx.indiceLinhaOriginal != null &&
      ctx.indiceLinhaOriginal >= 0 &&
      ctx.indiceLinhaOriginal < total
    ) {
      const tip = rows.nth(ctx.indiceLinhaOriginal);
      if (await linhaCorresponde(tip, ctx.chaveNfse)) return tip;
    }

    for (let i = 0; i < total; i++) {
      const row = rows.nth(i);
      if (await linhaCorresponde(row, ctx.chaveNfse)) return row;
    }
    return null;
  };

  let found = await tentarNaPaginaAtual();
  if (found) return found;

  // Percorre paginação a partir do início (volta se possível)
  while (Date.now() < deadline) {
    const next = await clicarProximaPagina(page);
    if (!next) break;
    found = await tentarNaPaginaAtual();
    if (found) return found;
  }

  throw new NotaNaoEncontradaParaRetryError(
    `Nota nao encontrada para retry: ${maskNfseKey(ctx.chaveNfse)} (${ctx.tipoArquivo})`
  );
}

async function clicarProximaPagina(page: Page): Promise<boolean> {
  const estrategias = [
    'i.fa-angle-right',
    'a:has(i.fa-angle-right)',
    'xpath=//i[@class="fa fa-angle-right"]',
  ];
  for (const selector of estrategias) {
    try {
      const botao = page.locator(selector).nth(0);
      if ((await botao.count()) === 0) continue;
      const parent = botao.locator('..');
      const liClass = await parent.locator('..').getAttribute('class');
      if (liClass?.toLowerCase().includes('disabled')) return false;
      await botao.click();
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => undefined);
      await page.waitForSelector(TABLE_ROW_SELECTOR, { timeout: 8000 });
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

async function abrirMenuEObterLink(
  page: Page,
  row: Locator,
  ctx: DownloadOperationContext
): Promise<Locator> {
  const colunaAcoesIdx = ctx.tipoNota === 'Emitidas' ? 6 : 5;
  const celulas = row.locator('td');
  const iconeAcoes = celulas.nth(colunaAcoesIdx).locator('div a i, a i').nth(0);
  await iconeAcoes.click();
  const menuSuspenso = row.locator('.menu-suspenso-tabela');
  await menuSuspenso.waitFor({ state: 'visible', timeout: 3000 });

  if (ctx.tipoArquivo === 'xml') {
    let linkXml = page.getByRole('link', { name: 'Download XML' });
    if ((await linkXml.count()) === 0) {
      linkXml = menuSuspenso.locator('a:has-text("XML")');
    }
    return linkXml.nth(0);
  }

  let linkPdf = page.getByRole('link', { name: 'Download DANFS-e' });
  if ((await linkPdf.count()) === 0) {
    linkPdf = menuSuspenso.locator('a:has-text("DANFS-e")');
  }
  return linkPdf.nth(0);
}

async function tentarResolverCaptchaSeNecessario(
  page: Page,
  downloadPromise: Promise<Download>,
  ctx: DownloadOperationContext,
  deps: DownloadOperationDeps,
  forceManual: boolean
): Promise<void> {
  const detectTimeout = Math.max(
    CAPTCHA_DETECT_TIMEOUT_MS,
    CAPTCHA_NEW_CHALLENGE_TIMEOUT_MS
  );
  const apareceuCaptcha = await Promise.race([
    page
      .locator(CAPTCHA_SUBMIT_SELECTOR)
      .waitFor({ state: 'visible', timeout: detectTimeout })
      .then(() => true)
      .catch(() => false),
    downloadPromise.then(() => false).catch(() => false),
  ]);

  if (!apareceuCaptcha) return;

  atualizarOperacao(ctx, { status: 'captcha_detectado' });
  const modo = CAPTCHA_MODE;
  const skipAuto =
    forceManual ||
    shouldSkipAutoForExecution(ctx.executionId) ||
    modo === 'manual';

  if (!skipAuto && (modo === 'auto' || modo === 'auto_manual')) {
    atualizarOperacao(ctx, { status: 'captcha_resolvendo' });
    notificar(
      deps,
      ctx.attempt > 1 ? 'captcha_retry_resolving' : 'captcha_resolvendo',
      ctx.attempt > 1
        ? `Criando nova tarefa 2Captcha para desafio regenerado (tentativa ${ctx.attempt}/${ctx.maxAttempts})`
        : 'Resolvendo hCaptcha via 2captcha…',
      ctx
    );
    await deps.resolverCaptchaAutomatico(page);
    atualizarOperacao(ctx, { status: 'captcha_enviando' });
    markAutoSuccess(ctx.executionId);
    return;
  }

  if (modo === 'auto' && skipAuto) {
    throw new Error('CAPTCHA_MODE=auto e resolução automática indisponível para esta execução');
  }

  atualizarOperacao(ctx, { status: 'fallback_manual' });
  notificar(
    deps,
    'captcha_fallback_manual',
    `Aguardando resolução MANUAL para ${ctx.tipoArquivo.toUpperCase()} desta nota`,
    ctx
  );
  await deps.aguardarResolucaoManual(page);
}

async function executarTentativaDeDownload(
  page: Page,
  row: Locator,
  ctx: DownloadOperationContext,
  deps: DownloadOperationDeps,
  forceManual: boolean
): Promise<string> {
  atualizarOperacao(ctx, { status: 'abrindo_download' });

  const link = await abrirMenuEObterLink(page, row, ctx);

  const downloadTimeout =
    Math.max(CAPTCHA_SOLVE_TIMEOUT_MS, CAPTCHA_MANUAL_TIMEOUT_MS, DOWNLOAD_TIMEOUT_MS) +
    CAPTCHA_DOWNLOAD_BUFFER_MS;
  const downloadPromise = page.waitForEvent('download', { timeout: downloadTimeout });
  downloadPromise.catch(() => {});

  await link.click({ timeout: DOWNLOAD_TIMEOUT_MS });

  await tentarResolverCaptchaSeNecessario(page, downloadPromise, ctx, deps, forceManual);

  atualizarOperacao(ctx, { status: 'aguardando_download' });
  const download = await downloadPromise;

  atualizarOperacao(ctx, { status: 'validando_arquivo' });
  notificar(deps, 'download_validating', `Validando arquivo ${ctx.tipoArquivo.toUpperCase()}…`, ctx);

  const savedPath = await salvarDownloadDireto(
    download,
    ctx.basePath,
    ctx.nomeContabilidade,
    ctx.mesExecucaoExtenso,
    ctx.nomeEmpresa,
    ctx.tipoNota,
    ctx.nomeArquivoPrefixo
  );

  const validation = await validarArquivoBaixado(savedPath, ctx.tipoArquivo);
  if (!validation.valid) {
    await removerArquivoInvalido(savedPath);
    throw new Error(
      `Arquivo ${ctx.tipoArquivo} inválido após download: ${validation.reason || 'desconhecido'}`
    );
  }

  return savedPath;
}

async function prepararNovaTentativa(
  page: Page,
  ctx: DownloadOperationContext,
  deps: DownloadOperationDeps
): Promise<void> {
  atualizarOperacao(ctx, { status: 'retry_pendente' });
  notificar(
    deps,
    'captcha_retry_preparing',
    `CAPTCHA não solucionado. Preparando nova tentativa automática ${ctx.attempt + 1}/${ctx.maxAttempts} para o ${ctx.tipoArquivo.toUpperCase()} da nota.`,
    ctx
  );

  const modalVisivel = await page
    .locator(CAPTCHA_SUBMIT_SELECTOR)
    .isVisible()
    .catch(() => false);
  const cancelVisivel = await page
    .locator(CAPTCHA_CANCEL_SELECTOR)
    .isVisible()
    .catch(() => false);

  if (modalVisivel || cancelVisivel) {
    await fecharModalCaptchaAtual(page, ctx, deps);
  }

  await sleep(CAPTCHA_OPERATION_RETRY_DELAY_MS);

  notificar(
    deps,
    'captcha_retry_relocating_note',
    'Fechando o desafio anterior e localizando novamente a nota.',
    ctx
  );

  await page
    .locator(TABLE_ROW_SELECTOR)
    .first()
    .waitFor({ state: 'visible', timeout: CAPTCHA_NOTE_RELOCATION_TIMEOUT_MS });
}

/**
 * Executa o download de um único arquivo (XML ou PDF) com retry de operação.
 */
export async function executarDownloadNotaComRetry(
  page: Page,
  rowInicial: Locator,
  ctx: DownloadOperationContext,
  deps: DownloadOperationDeps
): Promise<DownloadOperationResult> {
  getExecutionState(ctx.executionId).currentOperationId = ctx.operationId;

  const existing = await localizarArquivoExistenteValido(
    ctx.basePath,
    ctx.nomeContabilidade,
    ctx.mesExecucaoExtenso,
    ctx.nomeEmpresa,
    ctx.tipoNota,
    ctx.tipoArquivo,
    ctx.nomeArquivoPrefixo
  );

  if (existing.valid && existing.path) {
    atualizarOperacao(ctx, {
      status: 'skipped',
      outputPath: existing.path,
      fileValidated: true,
      completedAt: new Date().toISOString(),
    });
    notificar(
      deps,
      'download_completed',
      `Arquivo ${ctx.tipoArquivo.toUpperCase()} já existia e foi validado — pulando download`,
      ctx
    );
    return { success: true, skipped: true, path: existing.path };
  }

  let row = rowInicial;
  let lastError: unknown;

  for (let attempt = ctx.attempt; attempt <= ctx.maxAttempts; attempt++) {
    ctx.attempt = attempt;
    atualizarOperacao(ctx, { status: 'localizando_nota' });

    try {
      if (attempt > 1) {
        row = await localizarNotaPorIdentificador(page, ctx);
        notificar(
          deps,
          'captcha_retry_opening_new_challenge',
          'Nota localizada. Abrindo um novo desafio hCaptcha.',
          ctx
        );
        // Aguarda novo modal após o clique — createTask só depois
        await page
          .locator(CAPTCHA_SUBMIT_SELECTOR)
          .waitFor({ state: 'hidden', timeout: 2000 })
          .catch(() => undefined);
      }

      // Confirma que ainda é a mesma nota
      if (!(await linhaCorresponde(row, ctx.chaveNfse))) {
        row = await localizarNotaPorIdentificador(page, ctx);
      }

      const pathSaved = await executarTentativaDeDownload(
        page,
        row,
        ctx,
        deps,
        false
      );

      atualizarOperacao(ctx, {
        status: 'concluido',
        outputPath: pathSaved,
        fileValidated: true,
        completedAt: new Date().toISOString(),
      });

      const st = getExecutionState(ctx.executionId);
      st.lastCompleted = {
        chaveNfse: ctx.chaveNfse,
        tipoNota: ctx.tipoNota,
        tipoArquivo: ctx.tipoArquivo,
      };
      st.currentOperationId = undefined;

      if (attempt > 1) {
        notificar(deps, 'captcha_retry_success', 'Retry automático concluído com sucesso', ctx);
      }
      notificar(
        deps,
        'download_completed',
        `Download ${ctx.tipoArquivo.toUpperCase()} concluído`,
        ctx
      );

      return { success: true, skipped: false, path: pathSaved };
    } catch (error) {
      lastError = error;
      const classification = classificarErroDaOperacao(error);
      atualizarOperacao(ctx, {
        lastErrorCode: classification.code,
        lastErrorMessage: classification.reason.slice(0, 500),
      });

      logger.warn(
        {
          operationId: ctx.operationId,
          attempt: ctx.attempt,
          maxAttempts: ctx.maxAttempts,
          errorCode: classification.code,
          action: classification.action,
          retryable: classification.retryable,
        },
        'Falha na tentativa de download'
      );

      const hasNext = ctx.attempt < ctx.maxAttempts;

      if (classification.retryable && hasNext) {
        try {
          await prepararNovaTentativa(page, ctx, deps);
        } catch (prepErr) {
          lastError = prepErr;
          break;
        }
        continue;
      }

      break;
    }
  }

  // Esgotou ou erro permanente → fallback manual desta operação
  const classification = classificarErroDaOperacao(lastError);
  markAutoFinalFailure(ctx.executionId);

  if (
    CAPTCHA_OPERATION_FALLBACK_MANUAL &&
    classification.action !== 'FAIL_CONFIGURATION' &&
    CAPTCHA_MODE !== 'auto'
  ) {
    notificar(
      deps,
      'captcha_retry_exhausted',
      `Tentativas automáticas esgotadas (${ctx.maxAttempts}). Aguardando resolução manual para o ${ctx.tipoArquivo.toUpperCase()} desta nota.`,
      ctx
    );

    try {
      // Pode ainda haver modal aberto da última falha
      const modalVisivel = await page
        .locator(CAPTCHA_SUBMIT_SELECTOR)
        .isVisible()
        .catch(() => false);

      if (!modalVisivel) {
        row = await localizarNotaPorIdentificador(page, ctx);
        const pathSaved = await executarTentativaDeDownload(
          page,
          row,
          ctx,
          deps,
          true
        );
        atualizarOperacao(ctx, {
          status: 'concluido',
          outputPath: pathSaved,
          fileValidated: true,
          completedAt: new Date().toISOString(),
        });
        return {
          success: true,
          skipped: false,
          path: pathSaved,
          fallbackManual: true,
        };
      }

      atualizarOperacao(ctx, { status: 'fallback_manual' });
      await deps.aguardarResolucaoManual(page);

      const downloadTimeout =
        Math.max(CAPTCHA_MANUAL_TIMEOUT_MS, DOWNLOAD_TIMEOUT_MS) + CAPTCHA_DOWNLOAD_BUFFER_MS;
      const download = await page.waitForEvent('download', { timeout: downloadTimeout });
      const pathSaved = await salvarDownloadDireto(
        download,
        ctx.basePath,
        ctx.nomeContabilidade,
        ctx.mesExecucaoExtenso,
        ctx.nomeEmpresa,
        ctx.tipoNota,
        ctx.nomeArquivoPrefixo
      );
      const validation = await validarArquivoBaixado(pathSaved, ctx.tipoArquivo);
      if (!validation.valid) {
        await removerArquivoInvalido(pathSaved);
        throw new Error(`Arquivo inválido após resolução manual: ${validation.reason}`);
      }
      atualizarOperacao(ctx, {
        status: 'concluido',
        outputPath: pathSaved,
        fileValidated: true,
        completedAt: new Date().toISOString(),
      });
      return {
        success: true,
        skipped: false,
        path: pathSaved,
        fallbackManual: true,
      };
    } catch (manualErr) {
      atualizarOperacao(ctx, {
        status: 'falhou',
        lastErrorMessage: (manualErr as Error).message.slice(0, 500),
      });
      return {
        success: false,
        error: (manualErr as Error).message,
        fallbackManual: true,
      };
    }
  }

  atualizarOperacao(ctx, { status: 'falhou' as DownloadOperationStatus });
  return {
    success: false,
    error:
      lastError instanceof Error
        ? lastError.message
        : 'Falha na operação de download após tentativas',
  };
}
