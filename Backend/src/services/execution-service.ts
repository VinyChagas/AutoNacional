/**
 * Service de orquestração de execuções de automação NFSe.
 *
 * Gerencia fila de execuções e coordena: playwright_nfse → processar_notas → salvamento.
 */

import PQueue from 'p-queue';
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
import { setDownloadsBasePath, setMinActionDelayMs } from '../automation/processar-notas-competencia';
import {
  processarTabelaEmitidas,
  processarTabelaRecebidas,
  preencherDatasEFiltrar,
} from '../automation/processar-notas-competencia';
import { formatarMesExecucaoParaPasta } from '../automation/download-manager';
import { abrirDashboardNfseComCredencial } from '../automation/login-credencial-nfse';
import * as credenciaisRepo from '../repositories/credenciais';
import { emitirEventoExecucao } from './execution-events.service';
import { persistirExecution } from './automation-metrics.service';

const logger = getLogger('execution-service');

/** DD/MM/YYYY -> YYYY-MM */
function competenciaFromDataInicio(dataInicio: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dataInicio);
  if (m) return `${m[3]}-${m[2]}`;
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** Resolve viewport a partir das settings */
function resolveViewport(config: Awaited<ReturnType<typeof settingsRepo.obterConfiguracoes>>): {
  width: number;
  height: number;
} {
  if (
    config?.viewportPreset === 'CUSTOM' &&
    config?.viewportWidth &&
    config?.viewportHeight
  ) {
    return { width: config.viewportWidth, height: config.viewportHeight };
  }
  switch (config?.viewportPreset) {
    case 'DESKTOP_1366x768':
      return { width: 1366, height: 768 };
    case 'HD':
      return { width: 1280, height: 720 };
    case 'QHD':
      return { width: 2560, height: 1440 };
    case 'FULLHD':
    default:
      return { width: 1920, height: 1080 };
  }
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

/**
 * Obtém o limite de concorrência das configurações.
 */
async function obterLimiteConcorrencia(): Promise<number> {
  const config = await settingsRepo.obterConfiguracoes();
  if (config) {
    let limite = config.defaultConcurrentBrowsers ?? 3;
    if (config.maxConcurrentBrowsers && limite > config.maxConcurrentBrowsers) {
      limite = config.maxConcurrentBrowsers;
    }
    return limite;
  }
  return 3;
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
  tipoAutenticacao?: TipoAutenticacao
): Promise<number> {
  const config = await settingsRepo.obterConfiguracoes();
  const headlessFinal = headless ?? config?.headless ?? PLAYWRIGHT_HEADLESS;

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

  // Atualiza concorrência da fila com valor das configurações (Máx. e Padrão de navegadores)
  const limite = await obterLimiteConcorrencia();
  fila.concurrency = limite;

  fila.add(async () => {
    await executarFluxoCompleto(
      empresaId,
      cnpj,
      dataInicio,
      dataFim,
      tipo || 'ambas',
      headlessFinal,
      exec.id,
      certificado,
      tipoAuth
    );
  });

  return exec.id;
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

async function executarFluxoCompleto(
  empresaId: number,
  cnpj: string,
  dataInicio: string,
  dataFim: string,
  tipo: string,
  headless: boolean,
  execucaoDbId: number,
  certificadoFornecido?: CertificadoEmMemoria,
  tipoAutenticacao: TipoAutenticacao = 'certificado'
): Promise<void> {
  const key = String(empresaId);
  const info = execucoesAtivas.get(key);
  if (!info) return;

  const startedAt = new Date();
  info.startedAt = startedAt;
  const competencia = competenciaFromDataInicio(dataInicio);
  const empresaComContab = await empresasRepo.obterEmpresaComContabilidade(empresaId);
  const contabilidadeId = (empresaComContab as { contabilidadeId?: number | null })?.contabilidadeId ?? null;

  const adicionarLog = (msg: string) => {
    info.logs.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
    logger.info(`Empresa ${empresaId}: ${msg}`);
  };

  const batchId = info.batchId;
  const razaoSocial = await obterNomeEmpresa(cnpj);
  const metodo: 'CERTIFICADO' | 'CREDENCIAL' = tipoAutenticacao === 'credenciais' ? 'CREDENCIAL' : 'CERTIFICADO';

  const persistirMetrica = (status: 'OK' | 'ERRO', erroResumo?: string) => {
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
    type: 'execution:started',
    empresa_id: key,
    cnpj,
    razao_social: razaoSocial,
    metodo,
  });
  emitirEventoExecucao(batchId, {
    type: 'execution:stage',
    empresa_id: key,
    stage: 'abrir_navegador',
    message: 'Abrindo navegador…',
  });

  info.status = 'em_execucao';
  info.etapaAtual = 'autenticacao';
  info.progresso = 10;
  info.mensagem = 'Abrindo navegador…';
  await execucoesRepo.atualizar(execucaoDbId, {
    status: 'em_execucao',
    etapaAtual: 'autenticacao',
    dataInicio: new Date(),
  });

  let resultadoAuth: Awaited<ReturnType<typeof abrirDashboardNfse>>;

  if (tipoAutenticacao === 'credenciais') {
    const credencial = await credenciaisRepo.obterPrimeiraPorEmpresa(empresaId);
    if (!credencial) {
      const err = `Nenhuma credencial encontrada para a empresa (CNPJ ${cnpj})`;
      adicionarLog(`ERRO: ${err}`);
      emitirEventoExecucao(batchId, {
        type: 'execution:finished',
        empresa_id: key,
        status: 'ERRO',
        message: err,
      });
      info.status = 'falhou';
      info.mensagem = err;
      await execucoesRepo.atualizar(execucaoDbId, {
        status: 'falhou',
        mensagemErro: err,
        dataFim: new Date(),
      });
      persistirMetrica('ERRO', err.length > 200 ? err.slice(0, 197) + '...' : err);
      execucoesAtivas.delete(key);
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
    const viewport = resolveViewport(config);
    resultadoAuth = await abrirDashboardNfseComCredencial(documento, senha, {
      headless,
      timeout: timeout || PLAYWRIGHT_TIMEOUT,
      viewport,
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
      emitirEventoExecucao(batchId, {
        type: 'execution:finished',
        empresa_id: key,
        status: 'ERRO',
        message: err,
      });
      info.status = 'falhou';
      info.mensagem = err;
      await execucoesRepo.atualizar(execucaoDbId, {
        status: 'falhou',
        mensagemErro: err,
        dataFim: new Date(),
      });
      persistirMetrica('ERRO', err.length > 200 ? err.slice(0, 197) + '...' : err);
      execucoesAtivas.delete(key);
      return;
    }
    const config = await settingsRepo.obterConfiguracoes();
    const timeout = (config?.companyTimeoutSeconds ?? 300) * 1000;
    const viewport = resolveViewport(config);
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
      viewport,
    });
  }

  try {
    const config = await settingsRepo.obterConfiguracoes();

    if (!resultadoAuth.sucesso) {
      throw new NFSeAutenticacaoError(resultadoAuth.mensagem || 'Falha na autenticação');
    }

    if (!resultadoAuth.page) {
      throw new Error('Página do navegador não foi criada corretamente');
    }

    info.page = resultadoAuth.page;
    info.browser = resultadoAuth.browser;
    for (const logMsg of resultadoAuth.logs) adicionarLog(logMsg);
    info.progresso = 30;
    info.mensagem = 'Autenticação concluída.';
    emitirEventoExecucao(batchId, {
      type: 'execution:stage',
      empresa_id: key,
      stage: 'auth_ok',
      message: 'Autenticação concluída.',
    });

    if (config?.downloadsBasePath) {
      setDownloadsBasePath(config.downloadsBasePath);
    }
    if (config?.minActionDelayMs) {
      setMinActionDelayMs(config.minActionDelayMs);
    }

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
      const menuEmitidas = resultadoAuth.page.locator('li:nth-of-type(3) img').nth(0);
      await menuEmitidas.click();
      await resultadoAuth.page.waitForURL('**/Notas/Emitidas', { timeout: 15000 });
      await resultadoAuth.page.waitForLoadState('networkidle', { timeout: 15000 });
      await resultadoAuth.page.waitForTimeout(1000);

      emitirEventoExecucao(batchId, {
        type: 'execution:stage',
        empresa_id: key,
        stage: 'pesquisar_emitidas',
        message: 'Pesquisando notas emitidas…',
      });
      info.mensagem = 'Pesquisando notas emitidas…';
      await preencherDatasEFiltrar(resultadoAuth.page, dataInicio, dataFim);

      emitirEventoExecucao(batchId, {
        type: 'execution:stage',
        empresa_id: key,
        stage: 'baixar_emitidas',
        message: 'Baixando notas emitidas…',
      });
      info.mensagem = 'Baixando notas emitidas…';
      const resEmitidas = await processarTabelaEmitidas(
        resultadoAuth.page,
        nomeContabilidade,
        mesExecucaoExtenso,
        nomeEmpresa
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
      const menuRecebidas = resultadoAuth.page.locator('li:nth-of-type(4) img').nth(0);
      await menuRecebidas.click();
      await resultadoAuth.page.waitForURL('**/Notas/Recebidas', { timeout: 15000 });
      await resultadoAuth.page.waitForLoadState('networkidle', { timeout: 15000 });
      await resultadoAuth.page.waitForTimeout(1000);

      emitirEventoExecucao(batchId, {
        type: 'execution:stage',
        empresa_id: key,
        stage: 'pesquisar_recebidas',
        message: 'Pesquisando notas recebidas…',
      });
      info.mensagem = 'Pesquisando notas recebidas…';
      await preencherDatasEFiltrar(resultadoAuth.page, dataInicio, dataFim);

      emitirEventoExecucao(batchId, {
        type: 'execution:stage',
        empresa_id: key,
        stage: 'baixar_recebidas',
        message: 'Baixando notas recebidas…',
      });
      info.mensagem = 'Baixando notas recebidas…';
      const resRecebidas = await processarTabelaRecebidas(
        resultadoAuth.page,
        nomeContabilidade,
        mesExecucaoExtenso,
        nomeEmpresa
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

    emitirEventoExecucao(batchId, {
      type: 'execution:finished',
      empresa_id: key,
      status: 'OK',
      qtd_emitidas: info.qtdNotasEmitidas,
      qtd_recebidas: info.qtdNotasRecebidas,
      qtd_canceladas: info.qtdNotasCanceladas,
    });

    await execucoesRepo.atualizar(execucaoDbId, {
      status: 'concluido',
      etapaAtual: 'finalizacao',
      progresso: 100,
      mensagem: info.mensagem,
      dataFim: new Date(),
      qtdNotasEmitidas: info.qtdNotasEmitidas,
      qtdNotasRecebidas: info.qtdNotasRecebidas,
      resultadoFinal,
    });
  } catch (e) {
    const err = e as Error;
    const msg = err.message || 'Erro desconhecido';
    adicionarLog(`ERRO: ${msg}`);
    const msgResumo = msg.length > 80 ? msg.slice(0, 77) + '...' : msg;
    emitirEventoExecucao(batchId, {
      type: 'execution:finished',
      empresa_id: key,
      status: 'ERRO',
      message: msgResumo,
    });
    info.status = 'falhou';
    info.mensagem = msg;

    await execucoesRepo.atualizar(execucaoDbId, {
      status: 'falhou',
      mensagemErro: msg.slice(0, 500),
      dataFim: new Date(),
    });
  } finally {
    try {
      if (info.page) await info.page.close().catch(() => {});
      if (info.browser) await info.browser.close().catch(() => {});
    } catch {
      /* ignore */
    }
    const statusFinal = info.status === 'concluido' ? 'OK' : 'ERRO';
    persistirMetrica(statusFinal, statusFinal === 'ERRO' ? (info.mensagem?.slice(0, 200) ?? undefined) : undefined);
    execucoesAtivas.delete(key);
  }
}
