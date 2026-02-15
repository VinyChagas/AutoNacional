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

const logger = getLogger('execution-service');

const RESULTADOS = [
  'SEM_MOVIMENTO',
  'NOTAS_EMITIDAS',
  'NOTAS_RECEBIDAS',
  'NFS_ENCONTRADAS',
] as const;

interface ExecucaoInfo {
  empresaId: number;
  cnpj: string;
  periodoInicio: string;
  periodoFim: string;
  tipo: string;
  headless: boolean;
  execucaoDbId: number;
  status: string;
  etapaAtual: string;
  progresso: number;
  logs: string[];
  mensagem: string;
  qtdNotasEmitidas: number;
  qtdNotasRecebidas: number;
  resultadoFinal: string | null;
  page?: Page;
  browser?: Browser;
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
 */
export async function adicionarExecucao(
  empresaId: number,
  cnpj: string,
  dataInicio: string,
  dataFim: string,
  tipo: string,
  headless?: boolean,
  certificado?: CertificadoEmMemoria
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

  execucoesAtivas.set(String(empresaId), {
    empresaId,
    cnpj,
    periodoInicio: dataInicio,
    periodoFim: dataFim,
    tipo: tipo || 'ambas',
    headless: headlessFinal,
    execucaoDbId: exec.id,
    status: 'pendente',
    etapaAtual: 'inicio',
    progresso: 0,
    logs: [],
    mensagem: 'Aguardando execução...',
    qtdNotasEmitidas: 0,
    qtdNotasRecebidas: 0,
    resultadoFinal: null,
  });

  fila.add(async () => {
    await executarFluxoCompleto(
      empresaId,
      cnpj,
      dataInicio,
      dataFim,
      tipo || 'ambas',
      headlessFinal,
      exec.id,
      certificado
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
    status: info.status,
    etapa_atual: info.etapaAtual,
    progresso: info.progresso,
    logs: info.logs,
    mensagem: info.mensagem,
    qtd_notas_emitidas: info.qtdNotasEmitidas,
    qtd_notas_recebidas: info.qtdNotasRecebidas,
    resultado_final: info.resultadoFinal,
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
  certificadoFornecido?: CertificadoEmMemoria
): Promise<void> {
  const key = String(empresaId);
  const info = execucoesAtivas.get(key);
  if (!info) return;

  const adicionarLog = (msg: string) => {
    info.logs.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
    logger.info(`Empresa ${empresaId}: ${msg}`);
  };

  info.status = 'em_execucao';
  info.etapaAtual = 'autenticacao';
  info.progresso = 10;
  info.mensagem = 'Iniciando autenticação...';
  await execucoesRepo.atualizar(execucaoDbId, {
    status: 'em_execucao',
    etapaAtual: 'autenticacao',
    dataInicio: new Date(),
  });

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
    await execucoesRepo.atualizar(execucaoDbId, {
      status: 'falhou',
      mensagemErro: err,
      dataFim: new Date(),
    });
    execucoesAtivas.delete(key);
    return;
  }

  try {
    const config = await settingsRepo.obterConfiguracoes();
    const timeout = (config?.companyTimeoutSeconds ?? 300) * 1000;
    const viewport =
      config?.viewportPreset === 'CUSTOM' && config?.viewportWidth && config?.viewportHeight
        ? { width: config.viewportWidth, height: config.viewportHeight }
        : config?.viewportPreset === 'HD'
          ? { width: 1280, height: 720 }
          : { width: 1920, height: 1080 };

    adicionarLog('Chamando autenticação via certificado...');
    const resultadoAuth = await abrirDashboardNfse(certificado, {
      headless,
      timeout: timeout || PLAYWRIGHT_TIMEOUT,
      viewport,
    });

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
    info.mensagem = 'Autenticação concluída';

    if (config?.downloadsBasePath) {
      setDownloadsBasePath(config.downloadsBasePath);
    }
    if (config?.minActionDelayMs) {
      setMinActionDelayMs(config.minActionDelayMs);
    }

    const nomeEmpresa = await obterNomeEmpresa(cnpj);
    const competencia = `${dataInicio.slice(3, 5)}/${dataInicio.slice(6, 10)}`;

    info.etapaAtual = 'processamento_emitidas';
    info.progresso = 40;
    adicionarLog(`Processando notas (${tipo})...`);

    if (tipo === 'ambas' || tipo === 'emitidas') {
      const menuEmitidas = resultadoAuth.page.locator('li:nth-of-type(3) img').nth(0);
      await menuEmitidas.click();
      await resultadoAuth.page.waitForURL('**/Notas/Emitidas', { timeout: 15000 });
      await resultadoAuth.page.waitForLoadState('networkidle', { timeout: 15000 });
      await resultadoAuth.page.waitForTimeout(1000);
      await preencherDatasEFiltrar(resultadoAuth.page, dataInicio, dataFim);

      const resEmitidas = await processarTabelaEmitidas(
        resultadoAuth.page,
        competencia,
        nomeEmpresa
      );
      info.qtdNotasEmitidas = resEmitidas.qtd_baixadas;
    }

    if (tipo === 'ambas' || tipo === 'recebidas') {
      const menuRecebidas = resultadoAuth.page.locator('li:nth-of-type(4) img').nth(0);
      await menuRecebidas.click();
      await resultadoAuth.page.waitForURL('**/Notas/Recebidas', { timeout: 15000 });
      await resultadoAuth.page.waitForLoadState('networkidle', { timeout: 15000 });
      await resultadoAuth.page.waitForTimeout(1000);
      await preencherDatasEFiltrar(resultadoAuth.page, dataInicio, dataFim);

      const resRecebidas = await processarTabelaRecebidas(
        resultadoAuth.page,
        competencia,
        nomeEmpresa
      );
      info.qtdNotasRecebidas = resRecebidas.qtd_baixadas;
    }

    let resultadoFinal = 'SEM_MOVIMENTO';
    if (info.qtdNotasEmitidas > 0 && info.qtdNotasRecebidas > 0) {
      resultadoFinal = 'NFS_ENCONTRADAS';
    } else if (info.qtdNotasEmitidas > 0) {
      resultadoFinal = 'NOTAS_EMITIDAS';
    } else if (info.qtdNotasRecebidas > 0) {
      resultadoFinal = 'NOTAS_RECEBIDAS';
    }

    info.status = 'concluido';
    info.progresso = 100;
    info.mensagem = 'Execução concluída com sucesso';
    info.resultadoFinal = resultadoFinal;
    adicionarLog('Execução concluída com sucesso');

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
    execucoesAtivas.delete(key);
  }
}
