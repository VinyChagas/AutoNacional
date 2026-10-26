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
import { assertPageUsable, clicarMenuNotasEAguardar, isTargetClosedError } from '../automation/playwright-nav';
import * as credenciaisRepo from '../repositories/credenciais';
import { emitirEventoExecucao, emitirProgressoFiscalSeAssociado } from './execution-events.service';
import { persistirExecution } from './automation-metrics.service';
import { cancelByExecution } from './manual-captcha.service';
import type { CaptchaMode } from '../automation/captcha/types';
import {
  captchaWindowManager,
  getVisualSlotCapacityFromSettings,
  type ReservedBrowserSlot,
} from '../automation/captcha-window-manager';
import { CAPTCHA_WINDOW_LAYOUT_ENABLED } from '../infrastructure/config';
import { VIEWPORT_DESCOBERTA_PORTAL_SEFIN } from '../automation/nfse/discovery/portal-selectors';
import {
  OrquestracaoNfseError,
  CronometroMonotonico,
  decidirIntegracaoNativa,
  decidirMotorIniciar,
  exportarSefinParaDownloadsOperacionais,
  metricasOperacionaisVazias,
  montarReconciliacaoExecucao,
  resolverRaizFiscalNativaProduto,
  serializarMetricasOperacionais,
  tentarFluxoNativoControlado,
  type CodigoErroOrquestracaoNfse,
  type MetricasOperacionaisNfse,
  type MotorProcessamentoIniciar,
  type ResultadoFluxoFiscalNativo,
} from '../automation/nfse/orchestration';
import {
  RepositorioFiscalNfse,
  criarResolvedorRaizInjetada,
} from '../automation/nfse/infrastructure';
import { criarPeriodoConsultaPortal } from '../automation/nfse/contracts/periodo';
import { discoverNfse } from '../automation/nfse/discovery/discovery-service';
import { avaliarPonteHomologacaoDiscoveryOnly } from '../automation/nfse/homologacao';
import {
  liberarExecucaoHomologacao,
  prepararExecucaoHomologacao,
  STATUS_HOMOLOGACAO_LIBERADA,
  type DependenciasPreparacaoLiberacao,
  type PayloadExecucaoHomologacao,
} from '../automation/nfse/homologacao/preparacao-liberacao';
import { obterCanalHomologacaoOperacional } from '../automation/nfse/homologacao/canal-autorizacao';
import { registrarHandlersAdminPreparacaoLiberacao } from '../automation/nfse/homologacao/admin/admin-handlers';
import { HomologacaoNfseError } from '../automation/nfse/homologacao/types';
import {
  listarSnapshotsPorLote,
  progressoFiscalDeDiscoveryOnly,
  progressoFiscalDeInventarioNativo,
  publicarProgressoFiscal,
  retenirProgressoFiscal,
  type ProgressoFiscalNfse,
} from '../automation/nfse/progresso-fiscal';
import {
  decidirAdnIniciar,
  executarFluxoAdnIniciar,
  exportarAdnParaDownloadsOperacionais,
  garantirArvoreHomologacaoAdn,
  obterAutorizacaoAdnIniciarRuntime,
  obterDependenciasAdnIniciar,
  resolverRaizHomologacaoAdn,
} from '../automation/nfse/adn';
import {
  classificarErroEmpresa,
  intervaloRetryMs,
  obterPoliticaRetryEmpresa,
  podeAgendarNovaTentativa,
  type PoliticaRetryEmpresa,
} from './retry-empresa';

const logger = getLogger('execution-service');

/** Impede novos jobs e orienta o encerramento das execuções já enfileiradas. */
let encerrandoFila = false;

/** Timers de retry agendados (empresaId → timeout). Cancelados em pararFila. */
const retriesAgendados = new Map<string, ReturnType<typeof setTimeout>>();

/** DD/MM/YYYY -> YYYY-MM */
function competenciaFromDataInicio(dataInicio: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dataInicio);
  if (m) return `${m[3]}-${m[2]}`;
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * API-02K — sucesso Portal+SEFIN só com descoberta completa e cobertura determinada.
 * Competência vazia (COMPLETO + 0 docs) = SEM_MOVIMENTO OK.
 */
function avaliarResultadoPortalSefin(resultado: ResultadoFluxoFiscalNativo): {
  ok: boolean;
  codigo: CodigoErroOrquestracaoNfse;
  mensagem: string;
  resultadoFinal: string;
} {
  const inv = resultado.inventario;
  if (!inv || inv.completude !== 'COMPLETO') {
    return {
      ok: false,
      codigo: 'DESCOBERTA_INCOMPLETA',
      mensagem:
        'Descoberta Portal incompleta ou indeterminada — não é possível declarar sucesso na competência.',
      resultadoFinal: 'ERRO',
    };
  }
  // API-03N — só vigentes sem XML íntegro geram ERRO operacional.
  // Indeterminada com XML (atenção) NÃO entra no denominador de vigentes.
  const faltantes = resultado.chavesVigentesFaltantes ?? [];
  const vigentesIncompletos =
    resultado.vigentes > 0 &&
    (resultado.pendentes > 0 ||
      resultado.persistidos < resultado.vigentes ||
      faltantes.length > 0);
  if (vigentesIncompletos) {
    const amostra = faltantes.slice(0, 5).join(',');
    return {
      ok: false,
      codigo: 'COBERTURA_INCOMPLETA',
      mensagem:
        `Cobertura fiscal incompleta: vigentes=${resultado.vigentes} persistidos=${resultado.persistidos} ` +
        `faltantes=${faltantes.length}` +
        (amostra ? ` chaves=${amostra}` : '') +
        ` pendentes=${resultado.pendentes} ` +
        `xmls_atencao=${resultado.xmlsComAtencaoFiscal ?? 0} ` +
        `reconciliação=${resultado.conclusaoReconciliacao ?? 'n/a'}.`,
      resultadoFinal: 'ERRO',
    };
  }

  const emitidas = inv.totais.emitidas;
  const recebidas = inv.totais.recebidas;
  let resultadoFinal = 'SEM_MOVIMENTO';
  if (emitidas > 0 && recebidas > 0) resultadoFinal = 'NFS_ENCONTRADAS';
  else if (emitidas > 0) resultadoFinal = 'NOTAS_EMITIDAS';
  else if (recebidas > 0) resultadoFinal = 'NOTAS_RECEBIDAS';

  // Pendência fiscal (indeterminadas): sucesso operacional com atenção.
  if (resultado.indeterminadas > 0) {
    return {
      ok: true,
      codigo: 'FALHA_ORQUESTRACAO',
      mensagem:
        `Portal+SEFIN concluído com pendências fiscais: indeterminadas=${resultado.indeterminadas} ` +
        `xmls_atencao=${resultado.xmlsComAtencaoFiscal ?? 0} vigentes_ok=${resultado.persistidos}/${resultado.vigentes}.`,
      resultadoFinal: 'CONCLUIDA_COM_PENDENCIAS',
    };
  }

  return {
    ok: true,
    codigo: 'FALHA_ORQUESTRACAO',
    mensagem:
      resultadoFinal === 'SEM_MOVIMENTO'
        ? 'Portal+SEFIN: competência sem movimento (descoberta completa).'
        : `Portal+SEFIN concluído com cobertura determinada (${resultado.coberturaPercentual}%).`,
    resultadoFinal,
  };
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
  /** Motor efetivo após roteamento Iniciar (API-02K: PORTAL_SEFIN | PLAYWRIGHT | ADN). */
  motorProcessamento?: MotorProcessamentoIniciar;
  page?: Page;
  browser?: Browser;
  /** Slot visual reservado antes do launch (liberado ao fechar o browser). */
  windowSlot?: ReservedBrowserSlot;
  startedAt?: Date;
  /** Progresso fiscal estruturado (UI-01e-B) — só em memória enquanto a execução está ativa. */
  progressoFiscal?: ProgressoFiscalNfse;
  /** API-02W — durações e contadores operacionais (Portal+SEFIN). */
  metricasOperacionais?: MetricasOperacionaisNfse;
  /** API-03M — XMLs indeterminados persistidos (não contam como vigentes). */
  xmlsComAtencaoFiscal?: number;
  /** API-03M — detalhe por nota indeterminada. */
  pendenciasFiscais?: Array<{
    chave_acesso: string;
    numero_nota: string | null;
    codigo: string;
    motivo: string;
    xml_recuperado: boolean;
    documento_exportado: boolean;
  }>;
  /** API-03M — chaves exportadas para Pendentes_Validacao_Fiscal. */
  chavesPendentesExportadas?: string[];
  /** API-03N — vigentes sem XML íntegro. */
  chavesVigentesFaltantes?: string[];
  /** API-03G — tentativa atual (1 = primeira corrida). */
  tentativaAtual?: number;
  /** API-03G — máximo total de corridas (1 + novas). */
  maxTentativas?: number;
  /** API-03G — motivo da última falha transitória. */
  motivoUltimaFalha?: string | null;
  /** API-03G — ISO da próxima tentativa agendada. */
  proximaTentativaEm?: string | null;
  /** Certificado injetado na 1ª enfileirada (reusado no retry). */
  certificadoFornecido?: CertificadoEmMemoria;
  /** Homologação B2 — não reenfileira automaticamente. */
  retryDesabilitado?: boolean;
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
/** API-03I — trava curta anti duplo clique no retry manual. */
const retriesManuaisTravados = new Set<string>();

export class RetryManualEmpresaError extends Error {
  readonly codigo: string;

  constructor(codigo: string, mensagem: string) {
    super(mensagem);
    this.name = 'RetryManualEmpresaError';
    this.codigo = codigo;
  }
}

const STATUS_OCUPADO_RETRY_MANUAL = new Set([
  'pendente',
  'executando',
  'aguardando_retry',
  'aguardando_captcha',
  'aguardando_fila',
]);

/**
 * API-03I — retry manual de uma empresa com erro definitivo.
 * Reutiliza fila/PQueue, reinicia orçamento de tentativas só desta empresa,
 * preserva período/batch/checkpoint/XMLs. Não reinicia as demais.
 */
export async function reintentarEmpresaManual(entrada: {
  empresaId: number;
  cnpj: string;
  dataInicio: string;
  dataFim: string;
  tipo?: string;
  headless?: boolean;
  baixarPdf?: boolean;
  captchaMode?: CaptchaMode;
  batchId?: string;
  tipoAutenticacao?: TipoAutenticacao;
}): Promise<{
  execucaoId: number;
  tentativa_atual: number;
  max_tentativas: number;
  batch_id: string | undefined;
}> {
  const key = String(entrada.empresaId);
  if (encerrandoFila) {
    throw new RetryManualEmpresaError(
      'SERVIDOR_ENCERRANDO',
      'Servidor em encerramento; retry manual não é aceito.'
    );
  }

  const ativa = execucoesAtivas.get(key);
  if (ativa && STATUS_OCUPADO_RETRY_MANUAL.has(ativa.status)) {
    throw new RetryManualEmpresaError(
      'EMPRESA_EM_EXECUCAO',
      'A empresa já está na fila, em execução ou aguardando retry.'
    );
  }

  if (retriesManuaisTravados.has(key)) {
    throw new RetryManualEmpresaError(
      'RETRY_EM_ANDAMENTO',
      'Retry manual já solicitado para esta empresa.'
    );
  }

  retriesManuaisTravados.add(key);
  try {
    const timer = retriesAgendados.get(key);
    if (timer) {
      clearTimeout(timer);
      retriesAgendados.delete(key);
    }
    // Remove entrada residual (ex.: falhou ainda em memória em cenários atípicos).
    execucoesAtivas.delete(key);

    const politica = obterPoliticaRetryEmpresa();
    const maxTentativas = 1 + politica.maxNovasTentativas;
    // Garante capacidade na fila mesmo com lote já concluído (batchId reaproveitado).
    fila.concurrency = Math.max(fila.concurrency, 1, await obterLimiteConcorrencia());
    const execucaoId = await adicionarExecucao(
      entrada.empresaId,
      entrada.cnpj,
      entrada.dataInicio,
      entrada.dataFim,
      entrada.tipo || 'ambas',
      entrada.headless,
      undefined,
      entrada.batchId,
      entrada.tipoAutenticacao,
      entrada.baixarPdf ?? true,
      entrada.captchaMode ?? 'TWO_CAPTCHA'
    );

    const info = execucoesAtivas.get(key);
    if (info) {
      info.tentativaAtual = 1;
      info.maxTentativas = maxTentativas;
      info.motivoUltimaFalha = null;
      info.proximaTentativaEm = null;
      info.mensagem = `Retry manual — tentativa 1/${maxTentativas}…`;
    }

    if (entrada.batchId) {
      emitirEventoExecucao(entrada.batchId, {
        type: 'execution:retry',
        empresa_id: key,
        tentativa_atual: 0,
        max_tentativas: maxTentativas,
        proxima_tentativa: 1,
        delay_ms: 0,
        proxima_tentativa_em: new Date().toISOString(),
        motivo: 'Retry manual solicitado pelo operador.',
        codigo: 'RETRY_MANUAL',
        message: `Retry manual — tentativa 1/${maxTentativas}…`,
      });
    }

    logger.info(
      { empresaId: entrada.empresaId, cnpj: entrada.cnpj, execucaoId, batchId: entrada.batchId },
      'Retry manual enfileirado'
    );

    return {
      execucaoId,
      tentativa_atual: 1,
      max_tentativas: maxTentativas,
      batch_id: entrada.batchId,
    };
  } finally {
    retriesManuaisTravados.delete(key);
  }
}

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
  if (encerrandoFila) {
    throw new Error('Servidor em encerramento; novas execuções não são aceitas');
  }

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

  const politica = obterPoliticaRetryEmpresa();
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
    tentativaAtual: 1,
    maxTentativas: 1 + politica.maxNovasTentativas,
    motivoUltimaFalha: null,
    proximaTentativaEm: null,
    certificadoFornecido: certificado,
  });

  if (!batchId) {
    fila.concurrency = Math.max(fila.concurrency, await obterLimiteConcorrencia());
  }

  enfileirarWorkerEmpresa(empresaId);

  return exec.id;
}

/** Enfileira (ou re-enfileira) o worker da empresa na PQueue. */
function enfileirarWorkerEmpresa(empresaId: number): void {
  const info = execucoesAtivas.get(String(empresaId));
  if (!info) return;
  fila.add(async () => {
    try {
      await executarFluxoCompleto(
        info.empresaId,
        info.cnpj,
        info.periodoInicio,
        info.periodoFim,
        info.tipo,
        info.headless,
        info.execucaoDbId,
        info.certificadoFornecido,
        info.tipoAutenticacao === 'credenciais' ? 'credenciais' : 'certificado',
        info.baixarPdf
      );
    } catch (e) {
      logger.error({ err: e, empresaId }, '[worker] Erro não tratado em executarFluxoCompleto');
    }
  });
}

/**
 * Enfileira execução já criada (homologação B2) na mesma PQueue.
 * Não cria novo registro Prisma. Não consome ticket.
 */
async function enfileirarExecucaoHomologacaoPreparada(
  payload: PayloadExecucaoHomologacao
): Promise<void> {
  if (encerrandoFila) {
    throw new Error('Servidor em encerramento; novas execuções não são aceitas');
  }

  const config = await settingsRepo.obterConfiguracoes();
  const headlessFinal =
    payload.captchaMode === 'MANUAL'
      ? false
      : payload.headless ?? config?.headless ?? PLAYWRIGHT_HEADLESS;

  const execId = Number(payload.execucaoId);
  const tipoAuth: TipoAutenticacao =
    payload.tipoAutenticacao === 'credenciais' ? 'credenciais' : 'certificado';

  execucoesAtivas.set(String(payload.empresaId), {
    empresaId: payload.empresaId,
    cnpj: payload.cnpj,
    periodoInicio: payload.periodoInicio,
    periodoFim: payload.periodoFim,
    tipo: payload.tipo || 'ambas',
    headless: headlessFinal,
    baixarPdf: payload.baixarPdf,
    captchaMode: payload.captchaMode,
    execucaoDbId: execId,
    status: STATUS_HOMOLOGACAO_LIBERADA,
    etapaAtual: 'aguardando_fila',
    progresso: 0,
    logs: [],
    mensagem: 'Homologação liberada — aguardando worker',
    qtdNotasEmitidas: 0,
    qtdNotasRecebidas: 0,
    qtdNotasCanceladas: 0,
    resultadoFinal: null,
    tipoAutenticacao: tipoAuth,
    tentativaAtual: 1,
    maxTentativas: 1,
    retryDesabilitado: true,
  });

  fila.concurrency = Math.max(fila.concurrency, await obterLimiteConcorrencia());

  fila.add(async () => {
    try {
      await executarFluxoCompleto(
        payload.empresaId,
        payload.cnpj,
        payload.periodoInicio,
        payload.periodoFim,
        payload.tipo || 'ambas',
        headlessFinal,
        execId,
        undefined,
        tipoAuth,
        payload.baixarPdf
      );
    } catch (e) {
      logger.error(
        { err: e, empresaId: payload.empresaId, execucaoId: payload.execucaoId },
        '[worker] Erro não tratado em executarFluxoCompleto (homologação liberada)'
      );
    }
  });
}

function depsPreparacaoLiberacaoProducao(): DependenciasPreparacaoLiberacao {
  return {
    async criarExecucao(data) {
      return execucoesRepo.criar(data);
    },
    async obterExecucao(id) {
      const e = await execucoesRepo.obterPorId(id);
      if (!e) return null;
      return {
        id: e.id,
        status: e.status,
        cnpj: e.cnpj,
        periodoInicio: e.periodoInicio,
        periodoFim: e.periodoFim,
        empresaId: e.empresaId,
      };
    },
    atualizarSeStatus: (id, statusAtual, data) =>
      execucoesRepo.atualizarSeStatus(id, statusAtual, data),
    enfileirar: enfileirarExecucaoHomologacaoPreparada,
    obterCanal: obterCanalHomologacaoOperacional,
    headlessPadrao: PLAYWRIGHT_HEADLESS,
  };
}

function coerirHeadlessAdmin(valor: unknown): boolean | undefined {
  if (valor === undefined || valor === null) return undefined;
  if (typeof valor === 'boolean') return valor;
  if (typeof valor === 'string') {
    const n = valor.trim().toLowerCase();
    if (n === 'true') return true;
    if (n === 'false') return false;
  }
  throw new HomologacaoNfseError('CONTEXTO_INVALIDO', 'headless deve ser boolean true|false.');
}

function coerirCaptchaModeAdmin(valor: unknown): CaptchaMode | undefined {
  if (valor === undefined || valor === null) return undefined;
  if (typeof valor !== 'string') {
    throw new HomologacaoNfseError(
      'CONTEXTO_INVALIDO',
      'captchaMode deve ser MANUAL ou TWO_CAPTCHA.'
    );
  }
  const modo = valor.trim().toUpperCase().replace(/-/g, '_');
  const normalizado =
    modo === 'TWOCAPTCHA' || modo === '2CAPTCHA' ? 'TWO_CAPTCHA' : modo;
  if (normalizado !== 'MANUAL' && normalizado !== 'TWO_CAPTCHA') {
    throw new HomologacaoNfseError(
      'CONTEXTO_INVALIDO',
      'captchaMode deve ser MANUAL ou TWO_CAPTCHA.'
    );
  }
  return normalizado;
}

function paramsAdminPreparar(params: Record<string, unknown>) {
  const empresaId = Number(params.empresaId);
  const cnpj = String(params.cnpj ?? '');
  const periodoInicio = String(params.periodoInicio ?? '');
  const periodoFim = String(params.periodoFim ?? '');
  if (!Number.isInteger(empresaId) || empresaId < 1) {
    throw new HomologacaoNfseError('CONTEXTO_INVALIDO', 'empresaId inválido.');
  }
  return prepararExecucaoHomologacao(
    {
      empresaId,
      cnpj,
      periodoInicio,
      periodoFim,
      tipo: params.tipo != null ? String(params.tipo) : 'DISCOVERY_ONLY',
      tipoAutenticacao:
        params.tipoAutenticacao === 'credenciais' ? 'credenciais' : 'certificado',
      headless: coerirHeadlessAdmin(params.headless),
      baixarPdf: typeof params.baixarPdf === 'boolean' ? params.baixarPdf : undefined,
      captchaMode: coerirCaptchaModeAdmin(params.captchaMode),
    },
    depsPreparacaoLiberacaoProducao()
  );
}

function paramsAdminLiberar(params: Record<string, unknown>) {
  return liberarExecucaoHomologacao(
    { execucaoId: String(params.execucaoId ?? '') },
    depsPreparacaoLiberacaoProducao()
  );
}

registrarHandlersAdminPreparacaoLiberacao({
  preparar: async (params) => {
    const r = await paramsAdminPreparar(params);
    return { ...r };
  },
  liberar: async (params) => {
    const r = await paramsAdminLiberar(params);
    return { ...r };
  },
});

/**
 * Obtém status de todas as execuções de um batch (para polling em lote, evita N requests).
 * @param batchId - UUID do batch
 * @param empresaIdsFallback - Se fornecido, para cada empresa_id não encontrado em memória ativa
 *   nem na retenção fiscal do lote, busca última execução no DB (sem inventar `fiscal`).
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
      const row: Record<string, unknown> = {
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
        motor: info.motorProcessamento ?? null,
        competencia_fiscal: competenciaFromDataInicio(info.periodoInicio),
        periodo_inicio: info.periodoInicio,
        periodo_fim: info.periodoFim,
        metricas_operacionais: serializarMetricasOperacionais(info.metricasOperacionais),
        reconciliacao: reconciliacaoDeInfo(info),
        tentativa_atual: info.tentativaAtual ?? 1,
        max_tentativas: info.maxTentativas ?? 1,
        motivo_ultima_falha: info.motivoUltimaFalha ?? null,
        proxima_tentativa_em: info.proximaTentativaEm ?? null,
      };
      // Campo opcional: só quando há progresso fiscal associado a este lote/execução.
      if (
        info.progressoFiscal &&
        info.progressoFiscal.empresa_id === String(info.empresaId) &&
        info.progressoFiscal.execucao_id === String(info.execucaoDbId) &&
        (info.progressoFiscal.batch_id === null || info.progressoFiscal.batch_id === batchId)
      ) {
        row.fiscal = info.progressoFiscal;
      }
      out.push(row);
    }
  }

  // UI-01e-B1 — após finalização: snapshots retidos do mesmo lote (mesmo processo).
  for (const snap of listarSnapshotsPorLote(batchId)) {
    const empNum = parseInt(snap.empresa_id, 10);
    if (!Number.isFinite(empNum) || seenEmpresas.has(empNum)) continue;
    if (snap.batch_id !== batchId) continue;
    seenEmpresas.add(empNum);
    const row: Record<string, unknown> = {
      empresa_id: snap.empresa_id,
      cnpj: snap.cnpj,
      batch_id: batchId,
      status: snap.status,
      etapa_atual: snap.etapa_atual,
      progresso: snap.progresso,
      logs: [],
      mensagem: snap.mensagem,
      qtd_notas_emitidas: snap.qtd_notas_emitidas,
      qtd_notas_recebidas: snap.qtd_notas_recebidas,
      qtd_notas_canceladas: snap.qtd_notas_canceladas,
      resultado_final: snap.resultado_final,
      tipo_autenticacao: snap.tipo_autenticacao,
      motor: snap.motor ?? null,
      competencia_fiscal: snap.periodo_inicio
        ? competenciaFromDataInicio(snap.periodo_inicio)
        : null,
      periodo_inicio: snap.periodo_inicio ?? null,
      periodo_fim: snap.periodo_fim ?? null,
      fiscal: snap.fiscal,
      metricas_operacionais: snap.metricas_operacionais ?? null,
      reconciliacao: snap.reconciliacao ?? null,
    };
    out.push(row);
  }

  if (empresaIdsFallback && empresaIdsFallback.length > 0) {
    for (const empId of empresaIdsFallback) {
      if (seenEmpresas.has(empId)) continue;
      const ultima = await execucoesRepo.obterUltimaPorEmpresa(empId);
      if (ultima && (ultima.status === 'concluido' || ultima.status === 'falhou')) {
        // Sem `fiscal`/métricas no DB legado — reconciliação parcial só com contagens conhecidas.
        const reconciliacaoLegado = montarReconciliacaoExecucao({
          statusExecucao: ultima.status === 'falhou' ? 'ERRO' : 'OK',
          mensagemErro: ultima.status === 'falhou' ? (ultima.mensagemErro ?? null) : null,
          etapaAtual: ultima.etapaAtual,
          qtdEmitidas: ultima.qtdNotasEmitidas,
          qtdRecebidas: ultima.qtdNotasRecebidas,
          qtdCanceladas: 0,
          fiscal: null,
          metricas: null,
        });
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
          competencia_fiscal: ultima.periodoInicio
            ? competenciaFromDataInicio(ultima.periodoInicio)
            : null,
          periodo_inicio: ultima.periodoInicio ?? null,
          periodo_fim: ultima.periodoFim ?? null,
          metricas_operacionais: null,
          reconciliacao: reconciliacaoLegado,
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

  const status: Record<string, unknown> = {
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
    motor: info.motorProcessamento ?? null,
    competencia_fiscal: competenciaFromDataInicio(info.periodoInicio),
    periodo_inicio: info.periodoInicio,
    periodo_fim: info.periodoFim,
    metricas_operacionais: serializarMetricasOperacionais(info.metricasOperacionais),
    reconciliacao: reconciliacaoDeInfo(info),
    tentativa_atual: info.tentativaAtual ?? 1,
    max_tentativas: info.maxTentativas ?? 1,
    motivo_ultima_falha: info.motivoUltimaFalha ?? null,
    proxima_tentativa_em: info.proximaTentativaEm ?? null,
  };
  if (
    info.progressoFiscal &&
    info.progressoFiscal.empresa_id === String(info.empresaId) &&
    info.progressoFiscal.execucao_id === String(info.execucaoDbId)
  ) {
    status.fiscal = info.progressoFiscal;
  }
  return status;
}

const execucoesAtivas = new Map<string, ExecucaoInfo>();

/**
 * Stub mínimo de progresso fiscal quando o fluxo não publicou `progressoFiscal`
 * (ex.: falha cedo). Permite reter métricas/reconciliação sem inventar completude.
 */
function progressoFiscalMinimoParaRetencao(info: ExecucaoInfo): ProgressoFiscalNfse {
  const emitidas = info.qtdNotasEmitidas ?? 0;
  const recebidas = info.qtdNotasRecebidas ?? 0;
  const canceladas = info.qtdNotasCanceladas ?? 0;
  // API-03N — sem inventário, não inventar vigentes misturando indeterminadas.
  // Preferir null-safe: vigentes desconhecidos ficam 0 no stub; a UI usa "—" via reconciliacao.
  const descobertos = emitidas + recebidas;
  return {
    versao: 1,
    batch_id: info.batchId ?? null,
    empresa_id: String(info.empresaId),
    execucao_id: String(info.execucaoDbId),
    cnpj: info.cnpj,
    revisao: 0,
    inventario: {
      estado: 'indisponivel',
      completude: null,
      conclusao_confiavel: false,
      totais: {
        emitidas,
        recebidas,
        canceladas,
        vigentes: 0,
        indeterminadas: 0,
        descobertos,
        paginas: 0,
      },
    },
    validacao: {
      estado: 'indisponivel',
      origem: 'indisponivel',
      vigentes: 0,
      canceladas,
      indeterminadas: 0,
      conclusao_confiavel: false,
    },
    recuperacao: { estado: 'nao_executada', conclusao_confiavel: false },
    codigo: null,
    message: null,
    estado_operacional: null,
    veredito_discovery: null,
  };
}

function reconciliacaoDeInfo(info: ExecucaoInfo) {
  return montarReconciliacaoExecucao({
    statusExecucao: info.status,
    resultadoFinal: info.resultadoFinal,
    mensagemErro: info.status === 'falhou' || info.status === 'erro' ? info.mensagem : null,
    etapaAtual: info.etapaAtual,
    qtdEmitidas: info.qtdNotasEmitidas,
    qtdRecebidas: info.qtdNotasRecebidas,
    qtdCanceladas: info.qtdNotasCanceladas,
    fiscal: info.progressoFiscal,
    metricas: info.metricasOperacionais,
    xmlsComAtencaoFiscal: info.xmlsComAtencaoFiscal,
    pendenciasFiscais: info.pendenciasFiscais,
    chavesPendentesExportadas: info.chavesPendentesExportadas,
    chavesVigentesFaltantesLista: info.chavesVigentesFaltantes,
  });
}

/** Retém snapshot (métricas + reconciliação). Sobrevive à remoção de execucoesAtivas; não ao restart. */
function retenirProgressoFiscalDeInfo(
  info: ExecucaoInfo,
  opcoes?: { marcadoFinalizado?: boolean }
): void {
  if (!info.execucaoDbId) return;
  const fiscalBase = info.progressoFiscal ?? progressoFiscalMinimoParaRetencao(info);
  const reconciliacao = reconciliacaoDeInfo({
    ...info,
    progressoFiscal: fiscalBase,
  });
  retenirProgressoFiscal(
    {
      empresa_id: String(info.empresaId),
      cnpj: info.cnpj,
      batch_id: info.batchId ?? null,
      execucao_id: String(info.execucaoDbId),
      status: info.status,
      etapa_atual: info.etapaAtual,
      progresso: info.progresso,
      mensagem: info.mensagem,
      qtd_notas_emitidas: info.qtdNotasEmitidas,
      qtd_notas_recebidas: info.qtdNotasRecebidas,
      qtd_notas_canceladas: info.qtdNotasCanceladas,
      resultado_final: info.resultadoFinal,
      tipo_autenticacao: info.tipoAutenticacao,
      motor: info.motorProcessamento,
      periodo_inicio: info.periodoInicio,
      periodo_fim: info.periodoFim,
      fiscal: {
        ...fiscalBase,
        batch_id: info.batchId ?? fiscalBase.batch_id,
        empresa_id: String(info.empresaId),
        execucao_id: String(info.execucaoDbId),
        cnpj: info.cnpj,
      },
      metricas_operacionais: serializarMetricasOperacionais(info.metricasOperacionais),
      reconciliacao: reconciliacao as unknown as Record<string, unknown>,
    },
    { marcadoFinalizado: opcoes?.marcadoFinalizado === true }
  );
}

const fila = new PQueue({
  concurrency: 3,
  autoStart: true,
});

export function obterEstadoFila(): {
  pending: number;
  running: number;
  shuttingDown: boolean;
} {
  return {
    pending: fila.size,
    running: fila.pending,
    shuttingDown: encerrandoFila,
  };
}

/**
 * Pausa a fila, descarta jobs ainda não iniciados e fecha browsers em andamento.
 * O fluxo existente de finalização grava a falha das execuções que já tinham começado.
 * API-03G — cancela retries agendados e marca aguardando_retry como falha definitiva.
 */
export async function pararFilaExecucao(timeoutMs = 20_000): Promise<void> {
  encerrandoFila = true;
  fila.pause();
  fila.clear();

  for (const [empresaKey, timer] of retriesAgendados) {
    clearTimeout(timer);
    retriesAgendados.delete(empresaKey);
  }

  const ativas = [...execucoesAtivas.values()];
  for (const info of ativas) {
    if (info.status !== 'pendente' && info.status !== 'aguardando_retry') continue;
    try {
      await execucoesRepo.atualizar(info.execucaoDbId, {
        status: 'falhou',
        etapaAtual: 'encerramento',
        mensagem: 'Execução interrompida: processo encerrando',
        mensagemErro: 'Encerramento do processo antes do início da automação',
        dataFim: new Date(),
      });
    } catch (err) {
      logger.error(
        { err, execucaoId: info.execucaoDbId },
        'Falha ao marcar execução pendente como interrompida'
      );
    }
    execucoesAtivas.delete(String(info.empresaId));
  }

  await Promise.all(
    [...execucoesAtivas.values()].map(async (info) => {
      try {
        await info.page?.close().catch(() => undefined);
        await info.browser?.close().catch(() => undefined);
      } catch {
        /* o finally de cada execução fecha o que restar */
      }
    })
  );

  await Promise.race([
    fila.onIdle(),
    new Promise<void>((resolve) => {
      setTimeout(resolve, timeoutMs);
    }),
  ]);

  logger.info(obterEstadoFila(), 'Fila de execução parada');
}

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

async function liberarRecursosTentativa(info: ExecucaoInfo): Promise<void> {
  const page = info.page;
  const browser = info.browser;
  const slot = info.windowSlot;
  info.page = undefined;
  info.browser = undefined;
  info.windowSlot = undefined;
  try {
    if (page) await page.close().catch(() => undefined);
    if (browser) await browser.close().catch(() => undefined);
  } catch {
    /* ignore */
  } finally {
    try {
      slot?.release();
    } catch {
      /* ignore */
    }
  }
}

/**
 * API-03G — fecha sessão da tentativa e agenda retorno ao fim da fila,
 * ou finaliza definitivamente. Não apaga checkpoint/XML.
 */
async function decidirFinalizacaoOuRetry(params: {
  info: ExecucaoInfo;
  execucaoId: number;
  empresaId: number;
  cnpj: string;
  batchId?: string;
  startedAt?: Date;
  persistirMetrica: (status: 'OK' | 'ERRO', erroResumo?: string) => void;
  politica?: PoliticaRetryEmpresa;
}): Promise<void> {
  const { info, execucaoId, empresaId, cnpj, batchId, startedAt, persistirMetrica } = params;
  const politica = params.politica ?? obterPoliticaRetryEmpresa();
  const maxTotal = 1 + politica.maxNovasTentativas;
  info.maxTentativas = maxTotal;
  if (!info.tentativaAtual || info.tentativaAtual < 1) info.tentativaAtual = 1;

  if (info.status === 'concluido') {
    await finalizarExecucao({
      execucaoId,
      empresaId,
      cnpj,
      batchId,
      statusFinal: 'concluido',
      message: info.mensagem || 'Concluído',
      contagens: {
        emitidas: info.qtdNotasEmitidas,
        recebidas: info.qtdNotasRecebidas,
        canceladas: info.qtdNotasCanceladas,
      },
      resultado_final: info.resultadoFinal ?? 'SEM_MOVIMENTO',
      page: info.page,
      browser: info.browser,
      windowSlot: info.windowSlot,
      startedAt,
      persistirMetrica,
    });
    return;
  }

  if (encerrandoFila) {
    await finalizarExecucao({
      execucaoId,
      empresaId,
      cnpj,
      batchId,
      statusFinal: 'falhou',
      message: info.mensagem || 'Execução interrompida: processo encerrando',
      contagens: {
        emitidas: info.qtdNotasEmitidas,
        recebidas: info.qtdNotasRecebidas,
        canceladas: info.qtdNotasCanceladas,
      },
      resultado_final: 'ERRO',
      page: info.page,
      browser: info.browser,
      windowSlot: info.windowSlot,
      startedAt,
      persistirMetrica,
    });
    return;
  }

  const mensagemFalha = info.mensagem || 'Erro desconhecido';
  const classificacao = info.retryDesabilitado
    ? {
        acao: 'FALHA_DEFINITIVA' as const,
        motivo: 'Retry desabilitado neste contexto (homologação).',
        codigo: 'RETRY_DESABILITADO',
      }
    : classificarErroEmpresa(mensagemFalha);

  if (classificacao.acao === 'SUSPENDER_ACESSO') {
    info.resultadoFinal = 'SUSPENSO_ACESSO';
    await finalizarExecucao({
      execucaoId,
      empresaId,
      cnpj,
      batchId,
      statusFinal: 'falhou',
      message: `${mensagemFalha} [${classificacao.codigo}] ${classificacao.motivo}`,
      contagens: {
        emitidas: info.qtdNotasEmitidas,
        recebidas: info.qtdNotasRecebidas,
        canceladas: info.qtdNotasCanceladas,
      },
      resultado_final: 'SUSPENSO_ACESSO',
      page: info.page,
      browser: info.browser,
      windowSlot: info.windowSlot,
      startedAt,
      persistirMetrica,
    });
    return;
  }

  const tentativa = info.tentativaAtual;
  if (
    classificacao.acao === 'RETRY' &&
    podeAgendarNovaTentativa(politica, tentativa)
  ) {
    const delayMs = intervaloRetryMs(politica, tentativa);
    const proxima = tentativa + 1;
    const proximaEm = new Date(Date.now() + delayMs).toISOString();

    await liberarRecursosTentativa(info);

    info.status = 'aguardando_retry';
    info.etapaAtual = 'aguardando_retry';
    info.progresso = 0;
    info.motivoUltimaFalha = mensagemFalha.slice(0, 500);
    info.proximaTentativaEm = proximaEm;
    info.mensagem = `Tentativa ${tentativa}/${maxTotal} falhou (transitório). Nova tentativa ${proxima}/${maxTotal} em ${Math.round(delayMs / 1000)}s.`;
    info.resultadoFinal = null;

    try {
      await execucoesRepo.atualizar(execucaoId, {
        status: 'aguardando_retry',
        etapaAtual: 'aguardando_retry',
        progresso: 0,
        mensagem: info.mensagem,
        mensagemErro: info.motivoUltimaFalha ?? undefined,
      });
    } catch (err) {
      logger.error({ err, execucaoId }, '[retry] Falha ao persistir aguardando_retry');
    }

    emitirEventoExecucao(batchId, {
      type: 'execution:retry',
      empresa_id: String(empresaId),
      tentativa_atual: tentativa,
      max_tentativas: maxTotal,
      proxima_tentativa: proxima,
      delay_ms: delayMs,
      proxima_tentativa_em: proximaEm,
      motivo: info.motivoUltimaFalha ?? mensagemFalha,
      codigo: classificacao.codigo,
      message: info.mensagem,
    });

    logger.warn(
      {
        empresaId,
        cnpj,
        tentativa,
        maxTotal,
        delayMs,
        codigo: classificacao.codigo,
      },
      'Empresa reenfileirada para retry automático'
    );

    const key = String(empresaId);
    const existente = retriesAgendados.get(key);
    if (existente) clearTimeout(existente);

    const timer = setTimeout(() => {
      retriesAgendados.delete(key);
      const atual = execucoesAtivas.get(key);
      if (!atual || atual.execucaoDbId !== execucaoId) return;
      if (encerrandoFila) {
        void finalizarExecucao({
          execucaoId,
          empresaId,
          cnpj,
          batchId: atual.batchId,
          statusFinal: 'falhou',
          message: 'Retry cancelado: processo encerrando',
          contagens: { emitidas: 0, recebidas: 0, canceladas: 0 },
          resultado_final: 'ERRO',
          persistirMetrica: () => undefined,
        });
        return;
      }
      atual.tentativaAtual = proxima;
      atual.status = 'pendente';
      atual.etapaAtual = 'inicio';
      atual.proximaTentativaEm = null;
      atual.mensagem = `Tentativa ${proxima}/${maxTotal}…`;
      atual.qtdNotasEmitidas = 0;
      atual.qtdNotasRecebidas = 0;
      atual.qtdNotasCanceladas = 0;
      atual.resultadoFinal = null;
      atual.metricasOperacionais = undefined;
      atual.progressoFiscal = undefined;
      void execucoesRepo
        .atualizar(execucaoId, {
          status: 'pendente',
          etapaAtual: 'inicio',
          progresso: 0,
          mensagem: atual.mensagem,
          qtdNotasEmitidas: 0,
          qtdNotasRecebidas: 0,
        })
        .catch(() => undefined);
      emitirEventoExecucao(batchId, {
        type: 'execution:stage',
        empresa_id: key,
        stage: 'retry_inicio',
        message: atual.mensagem,
      });
      enfileirarWorkerEmpresa(empresaId);
    }, delayMs);

    retriesAgendados.set(key, timer);
    return;
  }

  const esgotado =
    classificacao.acao === 'RETRY' && !podeAgendarNovaTentativa(politica, tentativa);
  const msgFinal = esgotado
    ? `${mensagemFalha} (retry esgotado: ${tentativa}/${maxTotal})`
    : mensagemFalha;

  await finalizarExecucao({
    execucaoId,
    empresaId,
    cnpj,
    batchId,
    statusFinal: 'falhou',
    message: msgFinal,
    contagens: {
      emitidas: info.qtdNotasEmitidas,
      recebidas: info.qtdNotasRecebidas,
      canceladas: info.qtdNotasCanceladas,
    },
    resultado_final: info.resultadoFinal ?? 'ERRO',
    page: info.page,
    browser: info.browser,
    windowSlot: info.windowSlot,
    startedAt,
    persistirMetrica,
  });
}

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
      motor: info?.motorProcessamento,
      competencia_fiscal: info?.periodoInicio
        ? competenciaFromDataInicio(info.periodoInicio)
        : undefined,
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
    // API-03B — sempre reter métricas + reconciliação (com ou sem progressoFiscal nativo).
    if (info) {
      retenirProgressoFiscalDeInfo(
        {
          ...info,
          status: statusFinal,
          mensagem: message,
          qtdNotasEmitidas: contagens.emitidas,
          qtdNotasRecebidas: contagens.recebidas,
          qtdNotasCanceladas: contagens.canceladas,
          resultadoFinal: resultado_final,
        },
        { marcadoFinalizado: true }
      );
    }
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

  if (encerrandoFila) {
    info.status = 'falhou';
    info.mensagem = 'Execução interrompida: processo encerrando';
    info.resultadoFinal = 'ERRO';
    await finalizarExecucao({
      execucaoId: execucaoDbId,
      empresaId,
      cnpj,
      batchId: info.batchId,
      statusFinal: 'falhou',
      message: info.mensagem,
      contagens: { emitidas: 0, recebidas: 0, canceladas: 0 },
      resultado_final: 'ERRO',
      persistirMetrica: () => undefined,
    });
    return;
  }

  logWorker(empresaId, 'START');
  const startedAt = new Date();
  info.startedAt = startedAt;
  const batchId = info.batchId;
  let persistirMetrica: (status: 'OK' | 'ERRO', erroResumo?: string) => void = () => {};

  try {
  const razaoSocial = await obterNomeEmpresa(cnpj);
  const metodo: 'CERTIFICADO' | 'CREDENCIAL' = tipoAutenticacao === 'credenciais' ? 'CREDENCIAL' : 'CERTIFICADO';

  const competencia = competenciaFromDataInicio(dataInicio);
  const empresaComContab = await empresasRepo.obterEmpresaComContabilidade(empresaId);
  const contabilidadeId = (empresaComContab as { contabilidadeId?: number | null })?.contabilidadeId ?? null;

  const adicionarLog = (msg: string) => {
    info.logs.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
    logger.debug({ empresaId }, msg);
  };

  const cronometro = new CronometroMonotonico();
  info.metricasOperacionais = metricasOperacionaisVazias();

  const onLoginPageReady = () => {
    cronometro.marcar('login_page_ready');
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

  // API-02K — Roteamento Iniciar: A1→Portal+SEFIN; credenciais/exceção→Playwright;
  // ADN só com autorização explícita (complementar). Sem flags temporárias no A1 padrão.
  const decisaoMotor = decidirMotorIniciar({
    tipoAutenticacao,
    cnpj,
    autorizacaoAdnIniciar: obterAutorizacaoAdnIniciarRuntime(cnpj),
  });
  info.motorProcessamento = decisaoMotor.motor;

  // API-02G — started após roteamento, com motor e competência fiscal reais.
  emitirEventoExecucao(batchId, {
    type: 'execution:started',
    empresa_id: key,
    cnpj,
    razao_social: razaoSocial,
    metodo,
    motor: info.motorProcessamento,
    competencia_fiscal: competencia,
  });

  if (decisaoMotor.executarAdn) {
    // ADN complementar: reusa decisão tipada do módulo ADN (autorização explícita).
    const decisaoAdn = decidirAdnIniciar({
      tipoAutenticacao,
      cnpj,
      env: process.env,
      autorizacaoAdnIniciar: obterAutorizacaoAdnIniciarRuntime(cnpj),
    });
    emitirEventoExecucao(batchId, {
      type: 'execution:stage',
      empresa_id: key,
      stage: 'adn_distribuicao',
      message: 'Distribuição ADN complementar (sem navegador)…',
    });
    logWorker(empresaId, 'ADN complementary path — no Chromium');
    info.status = 'em_execucao';
    info.etapaAtual = 'adn_distribuicao';
    info.progresso = 15;
    info.mensagem = 'Distribuição ADN complementar (sem navegador)…';
    adicionarLog(`Roteamento Iniciar: ${decisaoMotor.motivo}`);
    await execucoesRepo.atualizar(execucaoDbId, {
      status: 'em_execucao',
      etapaAtual: 'adn_distribuicao',
      dataInicio: new Date(),
    });

    try {
      const resultadoAdn = await executarFluxoAdnIniciar(
        {
          cnpj,
          dataInicio,
          dataFim,
          identidade: {
            batchId: batchId ?? null,
            empresaId: key,
            execucaoId: String(execucaoDbId),
            cnpj,
          },
          decisao: decisaoAdn,
          deveInterromper: () => encerrandoFila,
          env: process.env,
        },
        obterDependenciasAdnIniciar({ exigirGateLive: false })
      );

      if (resultadoAdn.chromiumAberto || resultadoAdn.playwrightUsado || resultadoAdn.sefinChamado) {
        throw new OrquestracaoNfseError(
          'CONTEXTO_INVALIDO',
          'Fluxo ADN Iniciar violou isolamento (Chromium/SEFIN). Abortando sem legado.'
        );
      }

      if (resultadoAdn.fiscal) {
        const fiscal = publicarProgressoFiscal(resultadoAdn.fiscal);
        info.progressoFiscal = fiscal;
        retenirProgressoFiscalDeInfo(info);
        emitirProgressoFiscalSeAssociado({
          batchId,
          empresaId: key,
          execucaoId: String(execucaoDbId),
          cnpj,
          fiscal,
        });
      }

      info.qtdNotasEmitidas = resultadoAdn.contagens.emitidas;
      info.qtdNotasRecebidas = resultadoAdn.contagens.recebidas;
      info.qtdNotasCanceladas = resultadoAdn.contagens.canceladas;
      adicionarLog(resultadoAdn.motivo);

      if (!resultadoAdn.ok) {
        info.status = 'falhou';
        info.mensagem = resultadoAdn.motivo;
        info.resultadoFinal = 'ERRO';
        info.progresso = 100;
      } else {
        // API-01X — exporta XMLs ADN → downloads operacionais (mesmo contrato Playwright).
        emitirEventoExecucao(batchId, {
          type: 'execution:stage',
          empresa_id: key,
          stage: 'adn_exportacao_downloads',
          message: 'Exportando XMLs ADN para downloads…',
        });
        const configAdn = await settingsRepo.obterConfiguracoes();
        const basePathAdn = resolveStoragePath(configAdn?.downloadsBasePath ?? './downloads');
        const nomeEmpresaAdn = await obterNomeEmpresa(cnpj);
        const empresaContabAdn = await empresasRepo.obterEmpresaComContabilidade(empresaId);
        const nomeContabAdn =
          empresaContabAdn?.contabilidade?.nomeContabilidade?.trim() ?? 'Sem contabilidade';
        const agoraAdn = new Date();
        const mesExecAdn = formatarMesExecucaoParaPasta(
          agoraAdn.getFullYear(),
          agoraAdn.getMonth() + 1
        );
        const arvoreAdn = garantirArvoreHomologacaoAdn(resolverRaizHomologacaoAdn({}));
        const exportacao = await exportarAdnParaDownloadsOperacionais({
          cnpj,
          ambiente: 'producao',
          raizDocumentosAdn: arvoreAdn.documentos,
          dataInicio,
          dataFim,
          downloadsBasePath: basePathAdn,
          nomeContabilidade: nomeContabAdn,
          mesExecucaoExtenso: mesExecAdn,
          nomeEmpresa: nomeEmpresaAdn,
        });
        adicionarLog(exportacao.motivo);

        if (!exportacao.ok) {
          info.status = 'falhou';
          info.mensagem = exportacao.motivo;
          info.resultadoFinal = 'ERRO';
          info.progresso = 100;
        } else {
          info.status = 'concluido';
          info.progresso = 100;
          info.mensagem = `${resultadoAdn.motivo} | ${exportacao.motivo}`;
          info.resultadoFinal = resultadoAdn.resultadoFinal;
          adicionarLog(
            `ADN Iniciar concluído sem Chromium; resultado=${resultadoAdn.resultadoFinal}; ` +
              `exportados=${exportacao.copiados + exportacao.jaIguais}; ` +
              `inventário mensal permanece PARCIAL.`
          );
        }
      }
    } catch (e) {
      const err = e as Error;
      adicionarLog(`ERRO ADN Iniciar: ${err.message}`);
      info.status = 'falhou';
      info.mensagem = `${err.message} Sem fallback para Playwright.`;
      info.resultadoFinal = 'ERRO';
      info.progresso = 100;
    } finally {
      await decidirFinalizacaoOuRetry({
        info,
        execucaoId: execucaoDbId,
        empresaId,
        cnpj,
        batchId,
        startedAt,
        persistirMetrica,
      });
    }
    return;
  }

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

  cronometro.marcar('chromium_inicio');
  let resultadoAuth: Awaited<ReturnType<typeof abrirDashboardNfse>> | undefined;

  try {
  // Portal+SEFIN (A1): sem CAPTCHA — viewport de descoberta, não o slot compacto 769×679.
  // Credenciais/Playwright: mantém layout de slots para resolução visual do CAPTCHA.
  const usarViewportDescoberta = decisaoMotor.executarPortalSefin;
  const useWindowLayout =
    !headless && CAPTCHA_WINDOW_LAYOUT_ENABLED && !usarViewportDescoberta;
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
  const viewport = usarViewportDescoberta
    ? { ...VIEWPORT_DESCOBERTA_PORTAL_SEFIN }
    : windowSlot?.viewport;
  const launchArgs = usarViewportDescoberta
    ? [
        `--window-size=${VIEWPORT_DESCOBERTA_PORTAL_SEFIN.width},${VIEWPORT_DESCOBERTA_PORTAL_SEFIN.height}`,
      ]
    : windowSlot?.launchArgs;
  if (usarViewportDescoberta) {
    adicionarLog(
      `Viewport descoberta Portal+SEFIN: ${VIEWPORT_DESCOBERTA_PORTAL_SEFIN.width}×${VIEWPORT_DESCOBERTA_PORTAL_SEFIN.height} (sem slot CAPTCHA)`
    );
  }

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
    resultadoAuth = await abrirDashboardNfseComCredencial(documento, senha, {
      headless,
      timeout: PLAYWRIGHT_TIMEOUT,
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
      timeout: PLAYWRIGHT_TIMEOUT,
      ...(viewport ? { viewport } : {}),
      ...(launchArgs ? { launchArgs } : {}),
      onLoginPageReady,
    });
  }

  cronometro.marcar('auth_ok');
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
    // Chromium ≈ até tela de login; autenticação ≈ login pronto → dashboard.
    const m = info.metricasOperacionais ?? metricasOperacionaisVazias();
    m.duracoes.chromiumMs =
      cronometro.entre('chromium_inicio', 'login_page_ready') ??
      cronometro.entre('chromium_inicio', 'auth_ok');
    m.duracoes.autenticacaoMs =
      cronometro.entre('login_page_ready', 'auth_ok') ??
      cronometro.entre('chromium_inicio', 'auth_ok');
    info.metricasOperacionais = m;
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

    // H2.2.2-B — discoverNfse injetado; só executa com ticket + ativação individual.
    // Sem canal/ticket = legado. Sem ativação = BLOQUEADA (gate global fechado e insuficiente sozinho).
    const ponteHomologacao = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: String(execucaoDbId),
      cnpj,
      periodoConsulta: criarPeriodoConsultaPortal(dataInicio, dataFim),
      pagePresente: Boolean(page),
      page,
      discover: discoverNfse,
    });

    if (ponteHomologacao.encerrarEtapaFiscal) {
      emitirEventoExecucao(batchId, {
        type: 'execution:stage',
        empresa_id: key,
        stage: 'nfse_homologacao_discovery_only',
        message: `Homologação DISCOVERY_ONLY (${ponteHomologacao.estadoOperacional ?? ponteHomologacao.situacao})…`,
      });
      info.mensagem = ponteHomologacao.motivo;
      adicionarLog(
        `Homologação H2.2.2-B: ${ponteHomologacao.situacao}/${ponteHomologacao.estadoOperacional ?? 'n/a'} ` +
          `auth=${ponteHomologacao.autorizacaoId ?? 'n/a'} cnpj=${ponteHomologacao.cnpjMascarado} ` +
          `ticketConsumido=${ponteHomologacao.ticketConsumido} ` +
          `descobertaExecutada=${ponteHomologacao.descobertaExecutada} — sem legado.`
      );
      if (
        ponteHomologacao.situacao === 'RECUSADA' ||
        ponteHomologacao.situacao === 'BLOQUEADA_GATE_REAL' ||
        ponteHomologacao.situacao === 'DESCOBERTA_FALHA' ||
        ponteHomologacao.estadoOperacional === 'FALHA'
      ) {
        throw new OrquestracaoNfseError('CONTEXTO_INVALIDO', ponteHomologacao.motivo);
      }
      // BLOQUEADA / CONCLUIDA / INCOMPLETA / CANCELADA: encerra sem nativo SEFIN nem download legado.
      const totais = ponteHomologacao.resultadoDiscovery?.totais;
      info.qtdNotasEmitidas = totais?.emitidas ?? 0;
      info.qtdNotasRecebidas = totais?.recebidas ?? 0;
      info.qtdNotasCanceladas = totais?.canceladas ?? 0;

      // UI-01e-B/D — adaptador + ponto único de publicação (revisão monotônica).
      // SSE e retenção/polling compartilham a mesma instância lógica (mesma revisão).
      const fiscal = publicarProgressoFiscal(
        progressoFiscalDeDiscoveryOnly({
          identidade: {
            batchId: batchId ?? null,
            empresaId: key,
            execucaoId: String(execucaoDbId),
            cnpj,
          },
          resultado: ponteHomologacao.resultadoDiscovery,
          estadoOperacional: ponteHomologacao.estadoOperacional,
          codigoErroPonte: ponteHomologacao.codigoErro,
          motivo: ponteHomologacao.motivo,
        })
      );
      info.progressoFiscal = fiscal;
      retenirProgressoFiscalDeInfo(info);
      const emitiuFiscal = emitirProgressoFiscalSeAssociado({
        batchId,
        empresaId: key,
        execucaoId: String(execucaoDbId),
        cnpj,
        fiscal,
      });
      if (!batchId) {
        adicionarLog(
          'Progresso fiscal retido em memória (sem batchId — SSE fiscal e polling de lote indisponíveis).'
        );
      } else if (!emitiuFiscal) {
        adicionarLog('Progresso fiscal não emitido via SSE (associação lote/empresa/execução inválida).');
      }
    } else {
    // API-02K — A1 padrão: modoProdutoPortalSefin (sem flag/autorização manual).
    // Credenciais / exceção Playwright: legado (sem modo produto).
    // API-02Q — fecha Chromium após descoberta Portal; SEFIN segue sem browser.
    // Não altera o ramo credenciais/Playwright legado.
    const liberarNavegadorAposDescoberta = decisaoMotor.executarPortalSefin
      ? async () => {
          const pg = info.page;
          const br = info.browser;
          info.page = undefined;
          info.browser = undefined;
          if (pg) await pg.close().catch(() => undefined);
          if (br) await br.close().catch(() => undefined);
          adicionarLog('Chromium encerrado após descoberta Portal (SEFIN sem browser).');
        }
      : undefined;
    const contextoNativo = {
      page,
      cnpj,
      dataInicio,
      dataFim,
      tipo,
      baixarPdf,
      execucaoId: String(execucaoDbId),
      certificadoEmMemoria: certificadoFornecido ?? null,
      tipoAutenticacao,
      modoProdutoPortalSefin: decisaoMotor.executarPortalSefin,
      liberarNavegadorAposDescoberta,
    };
    const decisaoNativa = decidirIntegracaoNativa(contextoNativo);

    if (decisaoNativa.situacao === 'NATIVO_RECUSADO') {
      throw new OrquestracaoNfseError(
        decisaoNativa.codigoRecusa ?? 'CONTEXTO_INVALIDO',
        decisaoNativa.motivo
      );
    }

    if (decisaoNativa.executarNativo) {
      emitirEventoExecucao(batchId, {
        type: 'execution:stage',
        empresa_id: key,
        stage: 'nfse_portal_sefin',
        message: 'Portal + SEFIN: descoberta e recuperação XML…',
      });
      info.mensagem = 'Portal + SEFIN: descoberta e recuperação XML…';
      info.etapaAtual = 'portal_sefin';
      adicionarLog(`Roteamento Iniciar: ${decisaoMotor.motivo}`);
      adicionarLog(`Fluxo Portal+SEFIN: ${decisaoNativa.motivo}`);
      if (baixarPdf) {
        adicionarLog(
          'Aviso: baixarPdf=true ignorado — Portal+SEFIN é XML-only; DANFS-e/PDF não será recuperado.'
        );
      }

      let resultadoNativo: ResultadoFluxoFiscalNativo;
      try {
        const tentativa = await tentarFluxoNativoControlado(contextoNativo);
        if (!tentativa.resultado) {
          throw new OrquestracaoNfseError(
            'CONTEXTO_INVALIDO',
            'Fluxo Portal+SEFIN decidido sem resultado estruturado.'
          );
        }
        resultadoNativo = tentativa.resultado;
      } catch (erroNativo) {
        // Sem fallback silencioso para download legado / CAPTCHA.
        if (erroNativo instanceof OrquestracaoNfseError) throw erroNativo;
        const msg = erroNativo instanceof Error ? erroNativo.message : 'Falha na orquestração Portal+SEFIN.';
        throw new OrquestracaoNfseError('FALHA_ORQUESTRACAO', msg);
      }

      info.qtdNotasEmitidas = resultadoNativo.inventario?.totais.emitidas ?? 0;
      info.qtdNotasRecebidas = resultadoNativo.inventario?.totais.recebidas ?? 0;
      info.qtdNotasCanceladas = resultadoNativo.canceladas;
      emitirEventoExecucao(batchId, {
        type: 'execution:counts',
        empresa_id: key,
        qtd_emitidas: info.qtdNotasEmitidas,
        qtd_recebidas: info.qtdNotasRecebidas,
        qtd_canceladas: info.qtdNotasCanceladas,
      });
      const faltantesLog = resultadoNativo.chavesVigentesFaltantes ?? [];
      adicionarLog(
        `Portal+SEFIN: vigentes=${resultadoNativo.vigentes} persistidos=${resultadoNativo.persistidos} ` +
          `faltantes=${faltantesLog.length} ` +
          `indet=${resultadoNativo.indeterminadas} ` +
          `xmls_atencao=${resultadoNativo.xmlsComAtencaoFiscal ?? 0} ` +
          `cobertura=${resultadoNativo.coberturaPercentual}% ` +
          `reconciliacao=${resultadoNativo.conclusaoReconciliacao ?? 'n/a'} ` +
          `loteLiberado=${resultadoNativo.loteLiberado}`
      );

      const metricas = info.metricasOperacionais ?? metricasOperacionaisVazias();
      metricas.duracoes.descobertaEmitidasMs =
        resultadoNativo.duracoes?.descobertaEmitidasMs ?? null;
      metricas.duracoes.descobertaRecebidasMs =
        resultadoNativo.duracoes?.descobertaRecebidasMs ?? null;
      metricas.duracoes.recuperacaoSefinMs =
        resultadoNativo.duracoes?.recuperacaoSefinMs ?? null;
      // Notas descobertas no Portal ≠ XMLs SEFIN persistidos (só vigentes confirmados).
      metricas.contadores.notasDescobertas = resultadoNativo.descobertos;
      metricas.contadores.xmlsPersistidos = resultadoNativo.persistidos;

      // API-03N — publicar inventário real antes de avaliar/exportar (evita vigentes=descobertos−canceladas).
      if (resultadoNativo.inventario) {
        const fiscal = publicarProgressoFiscal(
          progressoFiscalDeInventarioNativo({
            identidade: {
              batchId: batchId ?? null,
              empresaId: key,
              execucaoId: String(execucaoDbId),
              cnpj,
            },
            inventario: resultadoNativo.inventario,
            recuperacaoEstado:
              (resultadoNativo.chavesVigentesFaltantes?.length ?? 0) > 0
                ? 'parcial'
                : resultadoNativo.indeterminadas > 0
                  ? 'parcial'
                  : 'completa',
          })
        );
        info.progressoFiscal = fiscal;
        emitirProgressoFiscalSeAssociado({
          batchId,
          empresaId: key,
          execucaoId: String(execucaoDbId),
          cnpj,
          fiscal,
        });
      }

      info.xmlsComAtencaoFiscal = resultadoNativo.xmlsComAtencaoFiscal ?? 0;
      info.pendenciasFiscais = resultadoNativo.pendenciasFiscais ?? [];
      info.chavesVigentesFaltantes = resultadoNativo.chavesVigentesFaltantes ?? [];

      // API-03M/03N — exporta XMLs já recuperados mesmo sem cobertura 100% dos vigentes.
      const pendentesFiscais = resultadoNativo.documentosPendentesFiscais ?? [];
      if (resultadoNativo.documentosAptos.length > 0 || pendentesFiscais.length > 0) {
        emitirEventoExecucao(batchId, {
          type: 'execution:stage',
          empresa_id: key,
          stage: 'sefin_exportacao_downloads',
          message: 'Exportando XMLs SEFIN para downloads…',
        });
        const tExport = cronometro;
        tExport.marcar('export_inicio');
        const raizFiscal = resolverRaizFiscalNativaProduto();
        const repositorioExport = new RepositorioFiscalNfse(criarResolvedorRaizInjetada(raizFiscal));
        const exportacao = await exportarSefinParaDownloadsOperacionais({
          inventario: resultadoNativo.inventario!,
          documentosAptos: resultadoNativo.documentosAptos,
          documentosPendentesFiscais: pendentesFiscais,
          repositorio: repositorioExport,
          periodoConsulta: resultadoNativo.periodoConsulta,
          downloadsBasePath: basePath,
          nomeContabilidade,
          mesExecucaoExtenso,
          nomeEmpresa,
        });
        tExport.marcar('export_fim');
        metricas.duracoes.persistenciaExportacaoMs = tExport.entre('export_inicio', 'export_fim');
        metricas.contadores.xmlsExportados = exportacao.copiados;
        metricas.contadores.xmlsJaExistentes = exportacao.jaIguais;
        info.chavesPendentesExportadas = exportacao.chavesPendentesExportadas;
        if (info.pendenciasFiscais?.length) {
          const exportadas = new Set(exportacao.chavesPendentesExportadas);
          info.pendenciasFiscais = info.pendenciasFiscais.map((p) => ({
            ...p,
            documento_exportado: p.documento_exportado || exportadas.has(p.chave_acesso),
          }));
        }
        if (!exportacao.ok) {
          metricas.duracoes.duracaoTotalMs = cronometro.totalAteAgora();
          info.metricasOperacionais = metricas;
          retenirProgressoFiscalDeInfo(info);
          throw new OrquestracaoNfseError('FALHA_EXPORTACAO', exportacao.motivo);
        }
        adicionarLog(exportacao.motivo);
      } else {
        metricas.contadores.xmlsExportados = 0;
        metricas.contadores.xmlsJaExistentes = 0;
        metricas.duracoes.persistenciaExportacaoMs = 0;
        info.chavesPendentesExportadas = [];
      }

      metricas.duracoes.duracaoTotalMs = cronometro.totalAteAgora();
      info.metricasOperacionais = metricas;

      const avaliacao = avaliarResultadoPortalSefin(resultadoNativo);
      if (!avaliacao.ok) {
        info.resultadoFinal = avaliacao.resultadoFinal;
        retenirProgressoFiscalDeInfo(info);
        throw new OrquestracaoNfseError(avaliacao.codigo, avaliacao.mensagem);
      }

      info.resultadoFinal = avaliacao.resultadoFinal;
      adicionarLog(avaliacao.mensagem);
    } else if (decisaoMotor.executarPortalSefin) {
      throw new OrquestracaoNfseError(
        'CONTEXTO_INVALIDO',
        'Portal+SEFIN solicitado mas o fluxo nativo não foi ativado.'
      );
    } else if (tipo === 'ambas' || tipo === 'emitidas') {
      emitirEventoExecucao(batchId, {
        type: 'execution:stage',
        empresa_id: key,
        stage: 'acessar_emitidas',
        message: 'Acessando notas emitidas…',
      });
      info.mensagem = 'Acessando notas emitidas…';
      assertPageUsable(page);
      const menuEmitidas = page.locator('li:nth-of-type(3) img').nth(0);
      await clicarMenuNotasEAguardar(page, menuEmitidas, 'Emitidas', {
        timeout: PLAYWRIGHT_TIMEOUT,
        log: adicionarLog,
      });

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

    if (!decisaoNativa.executarNativo && (tipo === 'ambas' || tipo === 'recebidas')) {
      emitirEventoExecucao(batchId, {
        type: 'execution:stage',
        empresa_id: key,
        stage: 'acessar_recebidas',
        message: 'Acessando notas recebidas…',
      });
      info.mensagem = 'Acessando notas recebidas…';
      assertPageUsable(page);
      const menuRecebidas = page.locator('li:nth-of-type(4) img').nth(0);
      await clicarMenuNotasEAguardar(page, menuRecebidas, 'Recebidas', {
        timeout: PLAYWRIGHT_TIMEOUT,
        log: adicionarLog,
      });

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
    } // fim else: sem homologação H2.2.1 — nativo ou legado

    let resultadoFinal = info.resultadoFinal;
    if (!resultadoFinal) {
      resultadoFinal = 'SEM_MOVIMENTO';
      if (ponteHomologacao.encerrarEtapaFiscal) {
        if (ponteHomologacao.estadoOperacional === 'BLOQUEADA') {
          resultadoFinal = 'HOMOLOGACAO_DISCOVERY_ONLY_BLOQUEADA';
        } else if (ponteHomologacao.estadoOperacional === 'CONCLUIDA') {
          resultadoFinal = 'HOMOLOGACAO_DISCOVERY_ONLY_CONCLUIDA';
        } else if (ponteHomologacao.estadoOperacional === 'INCOMPLETA') {
          resultadoFinal = 'HOMOLOGACAO_DISCOVERY_ONLY_INCOMPLETA';
        } else if (ponteHomologacao.estadoOperacional === 'CANCELADA') {
          resultadoFinal = 'HOMOLOGACAO_DISCOVERY_ONLY_CANCELADA';
        } else {
          resultadoFinal = 'HOMOLOGACAO_DISCOVERY_ONLY_PREPARADA';
        }
      } else if (info.qtdNotasEmitidas > 0 && info.qtdNotasRecebidas > 0) {
        resultadoFinal = 'NFS_ENCONTRADAS';
      } else if (info.qtdNotasEmitidas > 0) {
        resultadoFinal = 'NOTAS_EMITIDAS';
      } else if (info.qtdNotasRecebidas > 0) {
        resultadoFinal = 'NOTAS_RECEBIDAS';
      }
    }

    logWorker(empresaId, 'DOWNLOADS DONE');

    emitirEventoExecucao(batchId, {
      type: 'execution:stage',
      empresa_id: key,
      stage: 'finalizando',
      message: 'Finalizando…',
    });

    info.status = 'concluido';
    info.progresso = 100;
    info.resultadoFinal = resultadoFinal;
    const motorRotulo =
      info.motorProcessamento === 'PORTAL_SEFIN'
        ? 'Portal + SEFIN'
        : info.motorProcessamento === 'ADN'
          ? 'ADN'
          : 'Playwright';
    info.mensagem =
      info.motorProcessamento === 'PORTAL_SEFIN'
        ? `Execução ${motorRotulo} concluída (${resultadoFinal}).`
        : 'Execução concluída com sucesso';
    adicionarLog(info.mensagem);
  } catch (e) {
    const err = e as Error;
    const msg = isTargetClosedError(e)
      ? 'Navegador/página fechou durante a automação — execução abortada'
      : err.message || 'Erro desconhecido';
    adicionarLog(`ERRO: ${msg}`);
    info.status = 'falhou';
    info.mensagem = msg;
    info.resultadoFinal = 'ERRO';
    const m = info.metricasOperacionais ?? metricasOperacionaisVazias();
    m.duracoes.duracaoTotalMs = cronometro.totalAteAgora();
    info.metricasOperacionais = m;
  } finally {
    await decidirFinalizacaoOuRetry({
      info,
      execucaoId: execucaoDbId,
      empresaId,
      cnpj,
      batchId,
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
    // Se o finally interno já agendou retry (status aguardando_retry) ou finalizou, não repetir.
    if (info.status === 'aguardando_retry' || finalizadosIds.has(execucaoDbId)) {
      return;
    }
    await decidirFinalizacaoOuRetry({
      info,
      execucaoId: execucaoDbId,
      empresaId,
      cnpj,
      batchId,
      startedAt,
      persistirMetrica,
    });
  }
}
