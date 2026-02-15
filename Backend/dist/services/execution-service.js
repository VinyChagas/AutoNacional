"use strict";
/**
 * Service de orquestração de execuções de automação NFSe.
 *
 * Gerencia fila de execuções e coordena: playwright_nfse → processar_notas → salvamento.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setCertificateLoader = setCertificateLoader;
exports.obterCertificadoPorCnpj = obterCertificadoPorCnpj;
exports.adicionarExecucao = adicionarExecucao;
exports.obterStatus = obterStatus;
const p_queue_1 = __importDefault(require("p-queue"));
const logger_1 = require("../infrastructure/logger");
const config_1 = require("../infrastructure/config");
const execucoesRepo = __importStar(require("../repositories/execucoes"));
const empresasRepo = __importStar(require("../repositories/empresas"));
const settingsRepo = __importStar(require("../repositories/settings"));
const playwright_nfse_1 = require("../automation/playwright-nfse");
const processar_notas_competencia_1 = require("../automation/processar-notas-competencia");
const processar_notas_competencia_2 = require("../automation/processar-notas-competencia");
const logger = (0, logger_1.getLogger)('execution-service');
const RESULTADOS = [
    'SEM_MOVIMENTO',
    'NOTAS_EMITIDAS',
    'NOTAS_RECEBIDAS',
    'NFS_ENCONTRADAS',
];
let certificateLoader = null;
/**
 * Define a função para carregar certificado (será usada quando CertificateService estiver pronto - Fase 5).
 */
function setCertificateLoader(loader) {
    certificateLoader = loader;
}
/**
 * Obtém certificado por CNPJ (usa o loader configurado).
 * Usado pelo router NFSe e pelo fluxo de execução.
 */
async function obterCertificadoPorCnpj(cnpj) {
    if (!certificateLoader) {
        throw new Error('CertificateService não configurado. Execute a Etapa 5.2 da migração.');
    }
    return certificateLoader(cnpj);
}
/**
 * Obtém o limite de concorrência das configurações.
 */
async function obterLimiteConcorrencia() {
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
async function obterNomeEmpresa(cnpj) {
    const empresa = await empresasRepo.obterEmpresaPorCnpj(cnpj);
    if (empresa?.razaoSocial?.trim()) {
        return empresa.razaoSocial.trim();
    }
    return cnpj;
}
/**
 * Adiciona uma execução à fila.
 */
async function adicionarExecucao(empresaId, cnpj, dataInicio, dataFim, tipo, headless, certificado) {
    const config = await settingsRepo.obterConfiguracoes();
    const headlessFinal = headless ?? config?.headless ?? config_1.PLAYWRIGHT_HEADLESS;
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
        await executarFluxoCompleto(empresaId, cnpj, dataInicio, dataFim, tipo || 'ambas', headlessFinal, exec.id, certificado);
    });
    return exec.id;
}
/**
 * Obtém o status de uma execução em andamento.
 */
function obterStatus(empresaId) {
    const info = execucoesAtivas.get(empresaId);
    if (!info)
        return null;
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
const execucoesAtivas = new Map();
const fila = new p_queue_1.default({
    concurrency: 3,
    autoStart: true,
});
async function executarFluxoCompleto(empresaId, cnpj, dataInicio, dataFim, tipo, headless, execucaoDbId, certificadoFornecido) {
    const key = String(empresaId);
    const info = execucoesAtivas.get(key);
    if (!info)
        return;
    const adicionarLog = (msg) => {
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
    let certificado;
    if (certificadoFornecido) {
        certificado = certificadoFornecido;
    }
    else if (certificateLoader) {
        certificado = await certificateLoader(cnpj);
    }
    else {
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
        const viewport = config?.viewportPreset === 'CUSTOM' && config?.viewportWidth && config?.viewportHeight
            ? { width: config.viewportWidth, height: config.viewportHeight }
            : config?.viewportPreset === 'HD'
                ? { width: 1280, height: 720 }
                : { width: 1920, height: 1080 };
        adicionarLog('Chamando autenticação via certificado...');
        const resultadoAuth = await (0, playwright_nfse_1.abrirDashboardNfse)(certificado, {
            headless,
            timeout: timeout || config_1.PLAYWRIGHT_TIMEOUT,
            viewport,
        });
        if (!resultadoAuth.sucesso) {
            throw new playwright_nfse_1.NFSeAutenticacaoError(resultadoAuth.mensagem || 'Falha na autenticação');
        }
        if (!resultadoAuth.page) {
            throw new Error('Página do navegador não foi criada corretamente');
        }
        info.page = resultadoAuth.page;
        info.browser = resultadoAuth.browser;
        for (const logMsg of resultadoAuth.logs)
            adicionarLog(logMsg);
        info.progresso = 30;
        info.mensagem = 'Autenticação concluída';
        if (config?.downloadsBasePath) {
            (0, processar_notas_competencia_1.setDownloadsBasePath)(config.downloadsBasePath);
        }
        if (config?.minActionDelayMs) {
            (0, processar_notas_competencia_1.setMinActionDelayMs)(config.minActionDelayMs);
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
            await (0, processar_notas_competencia_2.preencherDatasEFiltrar)(resultadoAuth.page, dataInicio, dataFim);
            const resEmitidas = await (0, processar_notas_competencia_2.processarTabelaEmitidas)(resultadoAuth.page, competencia, nomeEmpresa);
            info.qtdNotasEmitidas = resEmitidas.qtd_baixadas;
        }
        if (tipo === 'ambas' || tipo === 'recebidas') {
            const menuRecebidas = resultadoAuth.page.locator('li:nth-of-type(4) img').nth(0);
            await menuRecebidas.click();
            await resultadoAuth.page.waitForURL('**/Notas/Recebidas', { timeout: 15000 });
            await resultadoAuth.page.waitForLoadState('networkidle', { timeout: 15000 });
            await resultadoAuth.page.waitForTimeout(1000);
            await (0, processar_notas_competencia_2.preencherDatasEFiltrar)(resultadoAuth.page, dataInicio, dataFim);
            const resRecebidas = await (0, processar_notas_competencia_2.processarTabelaRecebidas)(resultadoAuth.page, competencia, nomeEmpresa);
            info.qtdNotasRecebidas = resRecebidas.qtd_baixadas;
        }
        let resultadoFinal = 'SEM_MOVIMENTO';
        if (info.qtdNotasEmitidas > 0 && info.qtdNotasRecebidas > 0) {
            resultadoFinal = 'NFS_ENCONTRADAS';
        }
        else if (info.qtdNotasEmitidas > 0) {
            resultadoFinal = 'NOTAS_EMITIDAS';
        }
        else if (info.qtdNotasRecebidas > 0) {
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
    }
    catch (e) {
        const err = e;
        const msg = err.message || 'Erro desconhecido';
        adicionarLog(`ERRO: ${msg}`);
        info.status = 'falhou';
        info.mensagem = msg;
        await execucoesRepo.atualizar(execucaoDbId, {
            status: 'falhou',
            mensagemErro: msg.slice(0, 500),
            dataFim: new Date(),
        });
    }
    finally {
        try {
            if (info.page)
                await info.page.close().catch(() => { });
            if (info.browser)
                await info.browser.close().catch(() => { });
        }
        catch {
            /* ignore */
        }
        execucoesAtivas.delete(key);
    }
}
//# sourceMappingURL=execution-service.js.map