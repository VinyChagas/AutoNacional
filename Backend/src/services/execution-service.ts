/**
 * Service de orquestração de execuções de automação NFSe.
 *
 * Gerencia fila de execuções e coordena: playwright_nfse → processar_notas → salvamento.
 * Padrão producer/worker: endpoint apenas enfileira; browser launch ocorre APENAS no worker.
 */

import PQueue from 'p-queue';
import { sleep } from '../utils/sleep';
import { Page, Browser } from 'playwright';
import { getLogger } from '../infrastructure/logger';
import {
  PLAYWRIGHT_TIMEOUT,
  PLAYWRIGHT_HEADLESS,
  QUEUE_TIMEOUT,
} from '../infrastructure/config';
import * as execucoesRepo from '../repositories/execucoes';
import * as empresasRepo from '../repositories/empresas';
import * as settingsRepo from '../repositories/settings';
import { abrirDashboardNfse, NFSeAutenticacaoError } from '../automation/playwright-nfse';
import type { CertificadoEmMemoria } from '../automation/playwright-nfse';
import { setMinActionDelayMs } from '../automation/processar-notas-competencia';
import {
  processarTabelaEmitidas,
  processarTabelaRecebidas,
  preencherDatasEFiltrar,
} from '../automation/processar-notas-competencia';
import { formatarMesExecucaoParaPasta } from '../automation/download-manager';
import { resolveStoragePath } from '../utils/path-resolve';
import { abrirDashboardNfseComCredencial } from '../automation/login-credencial-nfse';
import * as credenciaisRepo from '../repositories/credenciais';
import { emitirEventoExecucao } from './execution-events.service';
import { persistirExecution } from './automation-metrics.service';
import { cancelByExecution } from './manual-captcha.service';
import type { CaptchaMode } from '../automation/captcha/types';
import {
  captchaWindowManager,
  getVisualSlotCapacityFromSettings,
  type ReservedBrowserSlot,
} from '../automation/captcha-window-manager';
import { CAPTCHA_WINDOW_LAYOUT_ENABLED } from '../infrastructure/config';

const logger = getLogger('execution-service');

/** DD/MM/YYYY -> YYYY-MM */
function competenciaFromDataInicio(dataInicio: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dataInicio);
  if (m) return `${m[3]}-${m[2]}`;
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

const RESULTADOS = [
  'SEM_MOVIMENTO',
  'NOTAS_EMITIDAS',
  'NOTAS_RECEBIDAS',
  'NFS_ENCONTRADAS',
] as const;

type TipoAutenticacao = 'certificado' | 'credenciais';

interface ExecucaoInfo {
  empresaId: number;
  cnpj: string;
  periodoInicio: string;
  periodoFim: string;
  tipo: string;
  headless: boolean;
  baixarPdf: boolean;
  captchaMode: CaptchaMode;
  execucaoDbId: number;
  batchId?: string;
  status: string;
  etapaAtual: string;
  progresso: number;
  logs: string[];
  mensagem: string;
  qtdNotasEmitidas: number;
  qtdNotasRecebidas: number;
  qtdNotasCanceladas: number;
  resultadoFinal: string | null;
  tipoAutenticacao?: TipoAutenticacao;
  page?: Page;
  browser?: Browser;
  /** Slot visual reservado antes do launch (liberado ao fechar o browser). */
  windowSlot?: ReservedBrowserSlot;
  startedAt?: Date;
}

type CertificateLoader = (cnpj: string) => Promise<CertificadoEmMemoria>;

let certificateLoader: CertificateLoader | null = null;

/**
 * Define a função para carregar certificado (será usada quando CertificateService estiver pronto - Fase 5).
 */
export function setCertificateLoader(loader: CertificateLoader): void {
  certificateLoader = loader;
}

/**
 * Obtém certificado por CNPJ (usa o loader configurado).
 * Usado pelo router NFSe e pelo fluxo de execução.
 */
export async function obterCertificadoPorCnpj(
  cnpj: string
): Promise<CertificadoEmMemoria> {
  if (!certificateLoader) {
    throw new Error(
      'CertificateService não configurado. Execute a Etapa 5.2 da migração.'
    );
  }
  return certificateLoader(cnpj);
}

const BROWSER_LAUNCH_DELAY_MS_DEFAULT = 150;

/**
 * Obtém delay entre enfileiramentos (configurável, padrão 150ms).
 */
export async function obterDelayEnfileiramento(): Promise<number> {
  const config = await settingsRepo.obterConfiguracoes();
  return config?.browserLaunchDelayMs ?? BROWSER_LAUNCH_DELAY_MS_DEFAULT;
}

/**
 * Calcula e aplica concurrency_final =
 * min(padrão, máximo das settings, slots visuais, totalEmpresas).
 *
 * Assim, com 10 na fila e 8 slots/navegadores, só 8 rodam; as demais
 * esperam na PQueue até um navegador finalizar e liberar o slot.
 */
export async function configurarConcorrenciaParaBatch(totalEmpresas: number): Promise<number> {
  const config = await settingsRepo.obterConfiguracoes();
  const userConfigured = config?.defaultConcurrentBrowsers ?? 3;
  const maxFromSettings = config?.maxConcurrentBrowsers ?? 5;
  let limite = Math.min(userConfigured, maxFromSettings);

  if (CAPTCHA_WINDOW_LAYOUT_ENABLED) {
    const visualSlots = await getVisualSlotCapacityFromSettings();
    limite = Math.min(limite, visualSlots);
  }

  const concurrencyFinal = Math.max(1, Math.min(limite, totalEmpresas));
  fila.concurrency = concurrencyFinal;
  logger.info(
    {
      totalEmpresas,
      defaultConcurrentBrowsers: userConfigured,
      maxConcurrentBrowsers: maxFromSettings,
      concurrencyFinal,
    },
    'Concorrência do lote aplicada (settings + slots visuais)'
  );
  return concurrencyFinal;
}

async function obterLimiteConcorrencia(): Promise<number> {
  const config = await settingsRepo.obterConfiguracoes();
  let limite = 3;
  if (config) {
    limite = config.defaultConcurrentBrowsers ?? 3;
    if (config.maxConcurrentBrowsers && limite > config.maxConcurrentBrowsers) {
      limite = config.maxConcurrentBrowsers;
    }
  }
  if (CAPTCHA_WINDOW_LAYOUT_ENABLED) {
    const visualSlots = await getVisualSlotCapacityFromSettings();
    limite = Math.min(limite, visualSlots);
  }
  return Math.max(1, limite);
}

/**
 * Obtém o nome da empresa para estrutura de pastas.
 */
async function obterNomeEmpresa(cnpj: string): Promise<string> {
  const empresa = await empresasRepo.obterEmpresaPorCnpj(cnpj);
  if (empresa?.razaoSocial?.trim()) {
    return empresa.razaoSocial.trim();
  }
  return cnpj;
}

/**
 * Adiciona uma execução à fila.
 * @param batchId - UUID do lote (para rastreio quando iniciado via POST /multiplas)
 * @param tipoAutenticacao - 'certificado' ou 'credenciais' (define método de login)
 */
export async function adicionarExecucao(
  empresaId: number,
  cnpj: string,
  dataInicio: string,
  dataFim: string,
  tipo: string,
  headless?: boolean,
  certificado?: CertificadoEmMemoria,
  batchId?: string,
  tipoAutenticacao?: TipoAutenticacao,
  baixarPdf: boolean = true,
  captchaMode: CaptchaMode = 'TWO_CAPTCHA'
): Promise<number> {
  const config = await settingsRepo.obterConfiguracoes();
  // Modo MANUAL exige navegador visível para o operador resolver o hCaptcha.
  const headlessFinal =
    captchaMode === 'MANUAL'
      ? false
      : headless ?? config?.headless ?? PLAYWRIGHT_HEADLESS;

  const exec = await execucoesRepo.criar({
    empresaId,
    cnpj,
    periodoInicio: dataInicio,
    periodoFim: dataFim,
    tipo: tipo || 'ambas',
  });

  const tipoAuth: TipoAutenticacao =
    tipoAutenticacao === 'credenciais' ? 'credenciais' : 'certificado';

  execucoesAtivas.set(String(empresaId), {
    empresaId,
    cnpj,
    periodoInicio: dataInicio,
    periodoFim: dataFim,
    tipo: tipo || 'ambas',
    headless: headlessFinal,
    baixarPdf,
    captchaMode,
    execucaoDbId: exec.id,
    batchId,
    status: 'pendente',
    etapaAtual: 'inicio',
    progresso: 0,
    logs: [],
    mensagem: 'Aguardando execução...',
    qtdNotasEmitidas: 0,
    qtdNotasRecebidas: 0,
    qtdNotasCanceladas: 0,
    resultadoFinal: null,
    tipoAutenticacao: tipoAuth,
  });

  if (!batchId) {
    fila.concurrency = Math.max(fila.concurrency, await obterLimiteConcorrencia());
  }

  fila.add(async () => {
    try {
      await executarFluxoCompleto(
      empresaId,
      cnpj,
      dataInicio,
      dataFim,
      tipo || 'ambas',
      headlessFinal,
      exec.id,
      certificado,
      tipoAuth,
      baixarPdf
    );
    } catch (e) {
      logger.error({ err: e, empresaId }, '[worker] Erro não tratado em executarFluxoCompleto');
    }
  });

  return exec.id;
}

/**
 * Obtém status de todas as execuções de um batch (para polling em lote, evita N requests).
 * @param batchId - UUID do batch
 * @param empresaIdsFallback - Se fornecido, para cada empresa_id não encontrado em memória, busca última execução no DB
 */
export async function obterStatusBatch(
  batchId: string,
  empresaIdsFallback?: number[]
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  const seenEmpresas = new Set<number>();

  for (const [, info] of execucoesAtivas) {
    if (info.batchId === batchId) {
      seenEmpresas.add(info.empresaId);
      out.push({
        empresa_id: String(info.empresaId),
        cnpj: info.cnpj,
        batch_id: info.batchId,
        status: info.status,
        etapa_atual: info.etapaAtual,
        progresso: info.progresso,
        logs: info.logs,
        mensagem: info.mensagem,
        qtd_notas_emitidas: info.qtdNotasEmitidas,
        qtd_notas_recebidas: info.qtdNotasRecebidas,
        qtd_notas_canceladas: info.qtdNotasCanceladas,
        resultado_final: info.resultadoFinal,
        tipo_autenticacao: info.tipoAutenticacao,
      });
    }
  }

  if (empresaIdsFallback && empresaIdsFallback.length > 0) {
    for (const empId of empresaIdsFallback) {
      if (seenEmpresas.has(empId)) continue;
      const ultima = await execucoesRepo.obterUltimaPorEmpresa(empId);
      if (ultima && (ultima.status === 'concluido' || ultima.status === 'falhou')) {
        out.push({
          empresa_id: String(empId),
          cnpj: ultima.cnpj ?? '',
          batch_id: batchId,
          status: ultima.status,
          etapa_atual: ultima.etapaAtual,
          progresso: ultima.progresso,
          logs: [],
          mensagem: ultima.status === 'falhou' ? (ultima.mensagemErro ?? '') : (ultima.mensagem ?? ''),
          qtd_notas_emitidas: ultima.qtdNotasEmitidas,
          qtd_notas_recebidas: ultima.qtdNotasRecebidas,
          qtd_notas_canceladas: 0,
          resultado_final: ultima.resultadoFinal,
        });
      }
    }
  }

  return out;
}

/**
 * Obtém o status de uma execução em andamento.
 */
export function obterStatus(empresaId: string): Record<string, unknown> | null {
  const info = execucoesAtivas.get(empresaId);
  if (!info) return null;

  return {
    empresa_id: String(info.empresaId),
    cnpj: info.cnpj,
    batch_id: info.batchId,
    status: info.status,
    etapa_atual: info.etapaAtual,
    progresso: info.progresso,
    logs: info.logs,
    mensagem: info.mensagem,
    qtd_notas_emitidas: info.qtdNotasEmitidas,
    qtd_notas_recebidas: info.qtdNotasRecebidas,
    qtd_notas_canceladas: info.qtdNotasCanceladas,
    resultado_final: info.resultadoFinal,
    tipo_autenticacao: info.tipoAutenticacao,
  };
}

const execucoesAtivas = new Map<string, ExecucaoInfo>();

const fila = new PQueue({
  concurrency: 3,
  autoStart: true,
});

function logWorker(empresaId: number, msg: string): void {
  logger.debug({ empresaId }, `[worker] ${msg}`);
}

function logFinalize(execucaoDbId: number, msg: string): void {
  logger.debug({ execucaoDbId }, `[finalize] ${msg}`);
}

interface FinalizarExecucaoParams {
  execucaoId: number;
  empresaId: number;
  cnpj: string;
  batchId?: string;
  statusFinal: 'concluido' | 'falhou';
  message: string;
  contagens: { emitidas: number; recebidas: number; canceladas: number };
  resultado_final: string;
  page?: Page;
  browser?: Browser;
  windowSlot?: ReservedBrowserSlot;
  startedAt?: Date;
  persistirMetrica: (status: 'OK' | 'ERRO', erroResumo?: string) => void;
}

/** Status finais que indicam que a execução já foi finalizada no DB. */
const STATUS_FINAIS_DB = new Set(['concluido', 'falhou']);

/** IDs já finalizados (evita dupla chamada em finally + early return). */
const finalizadosIds = new Set<number>();

/**
 * Finalização idempotente: atualiza DB, emite SSE, remove de execucoesAtivas, fecha Playwright.
 * Se já foi chamada para este execucaoId, skip (evita race e dupla emissão SSE).
 */
async function finalizarExecucao(params: FinalizarExecucaoParams): Promise<void> {
  const { execucaoId } = params;
  if (finalizadosIds.has(execucaoId)) {
    logFinalize(execucaoId, 'já finalizado, skip idempotente');
    return;
  }
  finalizadosIds.add(execucaoId);

  // Cancela captchas manuais pendentes desta execução (Central)
  cancelByExecution(String(execucaoId), 'execution_finished');

  const {
    empresaId,
    cnpj,
    batchId,
    statusFinal,
    message,
    contagens,
    resultado_final,
    page,
    browser,
    windowSlot,
    startedAt,
    persistirMetrica,
  } = params;

  const key = String(empresaId);
  const info = execucoesAtivas.get(key);
  const slotToRelease = windowSlot ?? info?.windowSlot;

  const sseStatus: 'OK' | 'ERRO' = statusFinal === 'concluido' ? 'OK' : 'ERRO';
  const msgResumo = message.length > 80 ? message.slice(0, 77) + '...' : message;

  try {
    const existente = await execucoesRepo.obterPorId(execucaoId);
    if (existente && STATUS_FINAIS_DB.has(existente.status)) {
      logFinalize(execucaoId, `já finalizado no DB (${existente.status}), garantindo consistência`);
    } else {
      await execucoesRepo.atualizar(execucaoId, {
        status: statusFinal,
        etapaAtual: 'finalizacao',
        progresso: statusFinal === 'concluido' ? 100 : 0,
        mensagem: message,
        mensagemErro: statusFinal === 'falhou' ? message.slice(0, 500) : undefined,
        dataFim: new Date(),
        qtdNotasEmitidas: contagens.emitidas,
        qtdNotasRecebidas: contagens.recebidas,
        resultadoFinal: resultado_final,
      });
      logFinalize(execucaoId, `DB UPDATED ${statusFinal}`);
    }

    emitirEventoExecucao(batchId, {
      type: 'execution:finished',
      empresa_id: key,
      status: sseStatus,
      message: statusFinal === 'falhou' ? msgResumo : undefined,
      qtd_emitidas: contagens.emitidas,
      qtd_recebidas: contagens.recebidas,
      qtd_canceladas: contagens.canceladas,
      resultado_final,
    });
    logFinalize(execucaoId, 'SSE FINISHED EMITTED');

    persistirMetrica(sseStatus, statusFinal === 'falhou' ? (message?.slice(0, 200) ?? undefined) : undefined);

    // Log único por empresa: sucesso ou falha (evita poluição com logs intermediários)
    if (statusFinal === 'concluido') {
      logger.info(
        { empresaId, cnpj, emitidas: contagens.emitidas, recebidas: contagens.recebidas },
        'Empresa concluída com sucesso'
      );
    } else {
      logger.error({ empresaId, cnpj, err: message }, 'Empresa falhou');
    }
  } catch (e) {
    logger.error({ err: e, execucaoId }, '[finalize] Erro ao atualizar DB/emitir SSE');
  } finally {
    execucoesAtivas.delete(key);
    logFinalize(execucaoId, 'REMOVED ACTIVE');

    try {
      if (page) await page.close().catch(() => {});
      if (browser) await browser.close().catch(() => {});
    } catch {
      /* ignore */
    } finally {
      // Libera o slot visual somente após o navegador ser fechado
      try {
        slotToRelease?.release();
      } catch {
        /* ignore */
      }
      if (info) info.windowSlot = undefined;
    }
  }
}

async function executarFluxoCompleto(
  empresaId: number,
  cnpj: string,
  dataInicio: string,
  dataFim: string,
  tipo: string,
  headless: boolean,
  execucaoDbId: number,
  certificadoFornecido?: CertificadoEmMemoria,
  tipoAutenticacao: TipoAutenticacao = 'certificado',
  baixarPdf: boolean = true
): Promise<void> {
  const key = String(empresaId);
  const info = execucoesAtivas.get(key);
  if (!info) return;

  logWorker(empresaId, 'START');
  const startedAt = new Date();
  info.startedAt = startedAt;
  const batchId = info.batchId;
  let persistirMetrica: (status: 'OK' | 'ERRO', erroResumo?: string) => void = () => {};

  try {
  const razaoSocial = await obterNomeEmpresa(cnpj);
  const metodo: 'CERTIFICADO' | 'CREDENCIAL' = tipoAutenticacao === 'credenciais' ? 'CREDENCIAL' : 'CERTIFICADO';

  emitirEventoExecucao(batchId, {
    type: 'execution:started',
    empresa_id: key,
    cnpj,
    razao_social: razaoSocial,
    metodo,
  });

  const competencia = competenciaFromDataInicio(dataInicio);
  const empresaComContab = await empresasRepo.obterEmpresaComContabilidade(empresaId);
  const contabilidadeId = (empresaComContab as { contabilidadeId?: number | null })?.contabilidadeId ?? null;

  const adicionarLog = (msg: string) => {
    info.logs.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
    logger.debug({ empresaId }, msg);
  };

  const onLoginPageReady = () => {
    logWorker(empresaId, 'login page ready');
    emitirEventoExecucao(batchId, {
      type: 'execution:login_ready',
      empresa_id: key,
      message: 'Tela de login carregada',
    });
  };

  persistirMetrica = (status: 'OK' | 'ERRO', erroResumo?: string) => {
    if (!batchId) return;
    const finishedAt = new Date();
    const tempoSeg = Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000);
    persistirExecution({
      batchId,
      empresaId,
      empresaCnpj: cnpj,
      contabilidadeId,
      competencia,
      status,
      loginMetodo: metodo,
      qtdEmitidas: info.qtdNotasEmitidas || 0,
      qtdRecebidas: info.qtdNotasRecebidas || 0,
      qtdCanceladas: info.qtdNotasCanceladas || 0,
      tempoExecucaoSegundos: tempoSeg,
      erroResumo: erroResumo || null,
      startedAt,
      finishedAt,
    }).catch(() => {});
  };

  emitirEventoExecucao(batchId, {
    type: 'execution:stage',
    empresa_id: key,
    stage: 'abrir_navegador',
    message: 'Abrindo navegador…',
  });

  logWorker(empresaId, 'launching browser');
  info.status = 'em_execucao';
  info.etapaAtual = 'autenticacao';
  info.progresso = 10;
  info.mensagem = 'Abrindo navegador…';
  await execucoesRepo.atualizar(execucaoDbId, {
    status: 'em_execucao',
    etapaAtual: 'autenticacao',
    dataInicio: new Date(),
  });

  let resultadoAuth: Awaited<ReturnType<typeof abrirDashboardNfse>> | undefined;

  try {
  // Reserva slot visual ANTES do Chromium (headless não usa layout)
  const useWindowLayout = !headless && CAPTCHA_WINDOW_LAYOUT_ENABLED;
  if (useWindowLayout) {
    emitirEventoExecucao(batchId, {
      type: 'execution:stage',
      empresa_id: key,
      stage: 'reservando_janela',
      message: 'Reservando posição da janela…',
    });
    info.mensagem = 'Reservando posição da janela…';
    info.windowSlot = await captchaWindowManager.reserveSlot(
      String(execucaoDbId),
      { enabled: true }
    );
    adicionarLog(
      `Slot visual ${info.windowSlot.slotId}: ${info.windowSlot.width}×${info.windowSlot.height} @ (${info.windowSlot.left},${info.windowSlot.top})`
    );
  }

  const windowSlot = info.windowSlot;
  const viewport = windowSlot?.viewport;
  const launchArgs = windowSlot?.launchArgs;

  if (tipoAutenticacao === 'credenciais') {
    const credencial = await credenciaisRepo.obterPrimeiraPorEmpresa(empresaId);
    if (!credencial) {
      const err = `Nenhuma credencial encontrada para a empresa (CNPJ ${cnpj})`;
      adicionarLog(`ERRO: ${err}`);
      info.status = 'falhou';
      info.mensagem = err;
      info.resultadoFinal = 'ERRO';
      return;
    }
    const senha = credenciaisRepo.descriptografarSenha(credencial);
    const documento = credencial.usuario || cnpj;
    emitirEventoExecucao(batchId, {
      type: 'execution:stage',
      empresa_id: key,
      stage: 'login',
      message: 'Fazendo login…',
    });
    info.mensagem = 'Fazendo login…';
    adicionarLog('Chamando autenticação via credencial...');
    const config = await settingsRepo.obterConfiguracoes();
    const timeout = (config?.companyTimeoutSeconds ?? 300) * 1000;
    resultadoAuth = await abrirDashboardNfseComCredencial(documento, senha, {
      headless,
      timeout: timeout || PLAYWRIGHT_TIMEOUT,
      ...(viewport ? { viewport } : {}),
      ...(launchArgs ? { launchArgs } : {}),
      onLoginPageReady,
    });
  } else {
    let certificado: CertificadoEmMemoria;
    if (certificadoFornecido) {
      certificado = certificadoFornecido;
    } else if (certificateLoader) {
      certificado = await certificateLoader(cnpj);
    } else {
      const err = 'CertificateService não configurado. Execute a Etapa 5.2 da migração.';
      adicionarLog(`ERRO: ${err}`);
      info.status = 'falhou';
      info.mensagem = err;
      info.resultadoFinal = 'ERRO';
      return;
    }
    const config = await settingsRepo.obterConfiguracoes();
    const timeout = (config?.companyTimeoutSeconds ?? 300) * 1000;
    emitirEventoExecucao(batchId, {
      type: 'execution:stage',
      empresa_id: key,
      stage: 'login',
      message: 'Fazendo login…',
    });
    info.mensagem = 'Fazendo login…';
    adicionarLog('Chamando autenticação via certificado...');
    resultadoAuth = await abrirDashboardNfse(certificado, {
      headless,
      timeout: timeout || PLAYWRIGHT_TIMEOUT,
      ...(viewport ? { viewport } : {}),
      ...(launchArgs ? { launchArgs } : {}),
      onLoginPageReady,
    });
  }

  logWorker(empresaId, 'browser launched');

    const config = await settingsRepo.obterConfiguracoes();

    if (!resultadoAuth!.sucesso) {
      throw new NFSeAutenticacaoError(resultadoAuth!.mensagem || 'Falha na autenticação');
    }

    if (!resultadoAuth!.page) {
      throw new Error('Página do navegador não foi criada corretamente');
    }

    const auth = resultadoAuth!;
    const page = auth.page!;
    info.page = page;
    info.browser = auth.browser;
    for (const logMsg of auth.logs) adicionarLog(logMsg);
    info.progresso = 30;
    info.mensagem = 'Autenticação concluída.';
    emitirEventoExecucao(batchId, {
      type: 'execution:stage',
      empresa_id: key,
      stage: 'auth_ok',
      message: 'Autenticação concluída.',
    });

    if (config?.minActionDelayMs) {
      setMinActionDelayMs(config.minActionDelayMs);
    }

    const basePathRaw = config?.downloadsBasePath ?? './downloads';
    const basePath = resolveStoragePath(basePathRaw);

    const nomeEmpresa = await obterNomeEmpresa(cnpj);
    const empresaComContab = await empresasRepo.obterEmpresaComContabilidade(empresaId);
    const nomeContabilidade = empresaComContab?.contabilidade?.nomeContabilidade?.trim() ?? 'Sem contabilidade';
    const agora = new Date();
    const mesExecucaoExtenso = formatarMesExecucaoParaPasta(agora.getFullYear(), agora.getMonth() + 1);

    info.etapaAtual = 'processamento_emitidas';
    info.progresso = 40;
    adicionarLog(`Processando notas (${tipo})...`);

    if (tipo === 'ambas' || tipo === 'emitidas') {
      emitirEventoExecucao(batchId, {
        type: 'execution:stage',
        empresa_id: key,
        stage: 'acessar_emitidas',
        message: 'Acessando notas emitidas…',
      });
      info.mensagem = 'Acessando notas emitidas…';
      const menuEmitidas = page.locator('li:nth-of-type(3) img').nth(0);
      await menuEmitidas.click();
      await page.waitForURL('**/Notas/Emitidas', { timeout: 15000 });
      await page.waitForLoadState('networkidle', { timeout: 15000 });
      await page.waitForTimeout(1000);

      emitirEventoExecucao(batchId, {
        type: 'execution:stage',
        empresa_id: key,
        stage: 'pesquisar_emitidas',
        message: 'Pesquisando notas emitidas…',
      });
      info.mensagem = 'Pesquisando notas emitidas…';
      await preencherDatasEFiltrar(page, dataInicio, dataFim);

      emitirEventoExecucao(batchId, {
        type: 'execution:stage',
        empresa_id: key,
        stage: 'baixar_emitidas',
        message: 'Baixando notas emitidas…',
      });
      info.mensagem = 'Baixando notas emitidas…';
      const onCaptchaStage = (stage: string, message: string) => {
        info.mensagem = message;
        emitirEventoExecucao(batchId, {
          type: 'execution:stage',
          empresa_id: key,
          stage,
          message,
        });
      };
      const resEmitidas = await processarTabelaEmitidas(
        page,
        basePath,
        nomeContabilidade,
        mesExecucaoExtenso,
        nomeEmpresa,
        baixarPdf,
        onCaptchaStage,
        {
          executionId: String(execucaoDbId ?? key),
          empresaId: key,
          batchId: batchId || undefined,
          captchaMode: info.captchaMode || 'TWO_CAPTCHA',
          empresaNome: nomeEmpresa,
          cnpj,
        }
      );
      info.qtdNotasEmitidas = resEmitidas.qtd_baixadas;
      info.qtdNotasCanceladas += resEmitidas.qtd_canceladas ?? 0;
      if (resEmitidas.sem_registros) {
        emitirEventoExecucao(batchId, {
          type: 'execution:stage',
          empresa_id: key,
          stage: 'nenhuma_emitida',
          message: 'Nenhuma nota emitida encontrada — avançando…',
        });
        info.mensagem = 'Nenhuma nota emitida encontrada — avançando…';
      }
      emitirEventoExecucao(batchId, {
        type: 'execution:counts',
        empresa_id: key,
        qtd_emitidas: info.qtdNotasEmitidas,
        qtd_recebidas: info.qtdNotasRecebidas,
        qtd_canceladas: info.qtdNotasCanceladas,
      });
    }

    if (tipo === 'ambas' || tipo === 'recebidas') {
      emitirEventoExecucao(batchId, {
        type: 'execution:stage',
        empresa_id: key,
        stage: 'acessar_recebidas',
        message: 'Acessando notas recebidas…',
      });
      info.mensagem = 'Acessando notas recebidas…';
      const menuRecebidas = page.locator('li:nth-of-type(4) img').nth(0);
      await menuRecebidas.click();
      await page.waitForURL('**/Notas/Recebidas', { timeout: 15000 });
      await page.waitForLoadState('networkidle', { timeout: 15000 });
      await page.waitForTimeout(1000);

      emitirEventoExecucao(batchId, {
        type: 'execution:stage',
        empresa_id: key,
        stage: 'pesquisar_recebidas',
        message: 'Pesquisando notas recebidas…',
      });
      info.mensagem = 'Pesquisando notas recebidas…';
      await preencherDatasEFiltrar(page, dataInicio, dataFim);

      emitirEventoExecucao(batchId, {
        type: 'execution:stage',
        empresa_id: key,
        stage: 'baixar_recebidas',
        message: 'Baixando notas recebidas…',
      });
      info.mensagem = 'Baixando notas recebidas…';
      const onCaptchaStage = (stage: string, message: string) => {
        info.mensagem = message;
        emitirEventoExecucao(batchId, {
          type: 'execution:stage',
          empresa_id: key,
          stage,
          message,
        });
      };
      const resRecebidas = await processarTabelaRecebidas(
        page,
        basePath,
        nomeContabilidade,
        mesExecucaoExtenso,
        nomeEmpresa,
        baixarPdf,
        onCaptchaStage,
        {
          executionId: String(execucaoDbId ?? key),
          empresaId: key,
          batchId: batchId || undefined,
          captchaMode: info.captchaMode || 'TWO_CAPTCHA',
          empresaNome: nomeEmpresa,
          cnpj,
        }
      );
      info.qtdNotasRecebidas = resRecebidas.qtd_baixadas;
      info.qtdNotasCanceladas += resRecebidas.qtd_canceladas ?? 0;
      if (resRecebidas.sem_registros) {
        emitirEventoExecucao(batchId, {
          type: 'execution:stage',
          empresa_id: key,
          stage: 'nenhuma_recebida',
          message: 'Nenhuma nota recebida encontrada…',
        });
        info.mensagem = 'Nenhuma nota recebida encontrada…';
      }
      emitirEventoExecucao(batchId, {
        type: 'execution:counts',
        empresa_id: key,
        qtd_emitidas: info.qtdNotasEmitidas,
        qtd_recebidas: info.qtdNotasRecebidas,
        qtd_canceladas: info.qtdNotasCanceladas,
      });
    }

    let resultadoFinal = 'SEM_MOVIMENTO';
    if (info.qtdNotasEmitidas > 0 && info.qtdNotasRecebidas > 0) {
      resultadoFinal = 'NFS_ENCONTRADAS';
    } else if (info.qtdNotasEmitidas > 0) {
      resultadoFinal = 'NOTAS_EMITIDAS';
    } else if (info.qtdNotasRecebidas > 0) {
      resultadoFinal = 'NOTAS_RECEBIDAS';
    }

    logWorker(empresaId, 'DOWNLOADS DONE');

    emitirEventoExecucao(batchId, {
      type: 'execution:stage',
      empresa_id: key,
      stage: 'finalizando',
      message: 'Finalizando…',
    });
    info.mensagem = 'Finalizando…';

    info.status = 'concluido';
    info.progresso = 100;
    info.mensagem = 'Execução concluída com sucesso';
    info.resultadoFinal = resultadoFinal;
    adicionarLog('Execução concluída com sucesso');
  } catch (e) {
    const err = e as Error;
    const msg = err.message || 'Erro desconhecido';
    adicionarLog(`ERRO: ${msg}`);
    info.status = 'falhou';
    info.mensagem = msg;
    info.resultadoFinal = 'ERRO';
  } finally {
    const statusFinal = info.status === 'concluido' ? 'concluido' : 'falhou';
    const resultadoFinal = info.resultadoFinal ?? 'ERRO';
    await finalizarExecucao({
      execucaoId: execucaoDbId,
      empresaId,
      cnpj,
      batchId,
      statusFinal,
      message: info.mensagem || (statusFinal === 'falhou' ? 'Erro desconhecido' : 'Concluído'),
      contagens: {
        emitidas: info.qtdNotasEmitidas,
        recebidas: info.qtdNotasRecebidas,
        canceladas: info.qtdNotasCanceladas,
      },
      resultado_final: resultadoFinal,
      page: info.page,
      browser: info.browser,
      windowSlot: info.windowSlot,
      startedAt,
      persistirMetrica,
    });
  }
  } catch (outerErr) {
    const err = outerErr as Error;
    logger.error({ err, empresaId, execucaoDbId }, '[worker] Erro antes do fluxo principal');
    info.status = 'falhou';
    info.mensagem = err.message || 'Erro inesperado';
    info.resultadoFinal = 'ERRO';
  } finally {
    const statusFinal = info.status === 'concluido' ? 'concluido' : 'falhou';
    const resultadoFinal = info.resultadoFinal ?? 'ERRO';
    await finalizarExecucao({
      execucaoId: execucaoDbId,
      empresaId,
      cnpj,
      batchId,
      statusFinal,
      message: info.mensagem || (statusFinal === 'falhou' ? 'Erro desconhecido' : 'Concluído'),
      contagens: {
        emitidas: info.qtdNotasEmitidas,
        recebidas: info.qtdNotasRecebidas,
        canceladas: info.qtdNotasCanceladas,
      },
      resultado_final: resultadoFinal,
      page: info.page,
      browser: info.browser,
      windowSlot: info.windowSlot,
      startedAt,
      persistirMetrica,
    });
  }
}
