"use strict";
/**
 * Gerenciador de downloads para automação NFSe.
 *
 * Fornece funções utilitárias para interceptar, identificar,
 * nomear e salvar downloads de forma robusta e reutilizável.
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.setDownloadsBasePath = setDownloadsBasePath;
exports.getDownloadBasePath = getDownloadBasePath;
exports.formatarMesExecucaoParaPasta = formatarMesExecucaoParaPasta;
exports.formatarCompetenciaParaPasta = formatarCompetenciaParaPasta;
exports.sanitizarNomeArquivo = sanitizarNomeArquivo;
exports.sanitizarNomePasta = sanitizarNomePasta;
exports.detectarExtensaoArquivo = detectarExtensaoArquivo;
exports.gerarNomeArquivo = gerarNomeArquivo;
exports.montarCaminhoCompleto = montarCaminhoCompleto;
exports.salvarDownloadDireto = salvarDownloadDireto;
exports.baixarArquivoDireto = baixarArquivoDireto;
const path = __importStar(require("path"));
const fs = __importStar(require("fs/promises"));
const logger_1 = require("../infrastructure/logger");
const path_resolve_1 = require("../utils/path-resolve");
const logger = (0, logger_1.getLogger)('download-manager');
const BACKEND_DIR = path.resolve(__dirname, '../..');
const DOWNLOADS_TESTE_DIR = path.join(BACKEND_DIR, 'downloads_teste');
let _downloadsBasePath = null;
/**
 * Define o caminho base para downloads.
 */
function setDownloadsBasePath(basePath) {
    _downloadsBasePath = (0, path_resolve_1.resolveStoragePath)(basePath);
    logger.info({ path: _downloadsBasePath }, 'Caminho base de downloads configurado');
}
/**
 * Obtém o caminho base para downloads.
 * Se não configurado, usa pasta de testes dentro do backend.
 */
function getDownloadBasePath() {
    if (_downloadsBasePath) {
        return _downloadsBasePath;
    }
    return DOWNLOADS_TESTE_DIR;
}
/** Mês por extenso em português (índice 1 = janeiro). */
const MESES_EXTENSO = [
    'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];
/**
 * Formata o mês da execução para uso como nome de pasta.
 * Usa o mês que está sendo executado (não a competência da nota).
 * Ex: (2026, 1) → "janeiro-2026"
 */
function formatarMesExecucaoParaPasta(ano, mes) {
    const mesIdx = Math.max(0, Math.min(mes - 1, 11));
    const nomeMes = MESES_EXTENSO[mesIdx];
    return `${nomeMes}-${ano}`;
}
/**
 * Formata a competência para uso como nome de pasta.
 * @deprecated Use formatarMesExecucaoParaPasta para nova estrutura (contabilidade/mês-ano/empresa).
 * Ex: "10/2025" → "10-2025"
 */
function formatarCompetenciaParaPasta(competencia) {
    return competencia.replace('/', '-');
}
/**
 * Sanitiza o nome do arquivo removendo caracteres inválidos.
 */
function sanitizarNomeArquivo(nome) {
    let result = nome.replace(/[<>:"/\\|?*]/g, '_');
    result = result.replace(/\s+/g, '_');
    return result.trim();
}
/**
 * Sanitiza o nome para uso como nome de pasta.
 */
function sanitizarNomePasta(nome) {
    let result = nome.trim();
    result = result.replace(/[^\w\s-]/g, '');
    result = result.replace(/\s+/g, ' ');
    return result;
}
/**
 * Detecta a extensão correta do arquivo baixado.
 */
async function detectarExtensaoArquivo(download) {
    try {
        await download.path();
        const url = download.url();
        if (url.toLowerCase().includes('xml') || url.toLowerCase().includes('application/xml')) {
            return '.xml';
        }
        if (url.toLowerCase().includes('pdf') || url.toLowerCase().includes('danfse')) {
            return '.pdf';
        }
    }
    catch {
        /* ignore */
    }
    try {
        const tempPath = await download.path();
        const fullBuffer = await fs.readFile(tempPath);
        const buffer = fullBuffer.subarray(0, 10);
        if (buffer[0] === 0x3c || (buffer[0] === 0x3f && buffer[1] === 0x78)) {
            return '.xml';
        }
        if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
            return '.pdf';
        }
    }
    catch {
        /* ignore */
    }
    logger.warn('Não foi possível detectar extensão. Usando .bin');
    return '.bin';
}
/**
 * Gera o nome final do arquivo.
 */
async function gerarNomeArquivo(download, extensao, prefixo) {
    const suggestedName = download.suggestedFilename();
    const nomeValido = suggestedName &&
        suggestedName.length <= 200 &&
        (suggestedName.endsWith('.xml') ||
            suggestedName.endsWith('.pdf') ||
            suggestedName.endsWith('.bin') ||
            /[a-zA-Z0-9]/.test(suggestedName));
    let nomeFinal;
    if (nomeValido) {
        const nomeBase = path.basename(suggestedName, path.extname(suggestedName));
        nomeFinal = `${nomeBase}${extensao}`;
    }
    else {
        nomeFinal = prefixo ? `${prefixo}${extensao}` : `nota_${Date.now()}${extensao}`;
    }
    return sanitizarNomeArquivo(nomeFinal);
}
/**
 * Monta o caminho completo seguindo a hierarquia definida.
 * Estrutura: {base_path}/{contabilidade}/{mes_extenso}-{ano}/{empresa}/{tipo_nota}/
 * - contabilidade: nome da contabilidade em execução
 * - mes_extenso: mês da execução por extenso (ex: janeiro-2026), NÃO a competência da nota
 */
function montarCaminhoCompleto(basePath, nomeContabilidade, mesExecucaoExtenso, empresa, tipoNota) {
    const tipo = tipoNota.trim();
    if (tipo !== 'Emitidas' && tipo !== 'Recebidas') {
        throw new Error(`tipo_nota deve ser 'Emitidas' ou 'Recebidas'. Recebido: ${tipo}`);
    }
    const contabFolder = sanitizarNomePasta(nomeContabilidade) || 'Contabilidade';
    const empresaFolder = sanitizarNomePasta(empresa);
    const caminhoCompleto = path.join(basePath, contabFolder, mesExecucaoExtenso, empresaFolder, tipo);
    return caminhoCompleto;
}
/**
 * Salva um download já interceptado no diretório correto.
 * Estrutura: {base}/{contabilidade}/{mes_extenso}-{ano}/{empresa}/{tipo}/
 */
async function salvarDownloadDireto(download, basePath, nomeContabilidade, mesExecucaoExtenso, empresa, tipoNota, nomeArquivoPrefixo) {
    const extensao = await detectarExtensaoArquivo(download);
    const nomeArquivo = await gerarNomeArquivo(download, extensao, nomeArquivoPrefixo);
    const dirDestino = montarCaminhoCompleto(basePath, nomeContabilidade, mesExecucaoExtenso, empresa, tipoNota);
    await fs.mkdir(dirDestino, { recursive: true });
    const caminhoFinal = path.join(dirDestino, nomeArquivo);
    await download.saveAs(caminhoFinal);
    logger.info({ caminho: caminhoFinal }, 'Arquivo salvo com sucesso');
    return caminhoFinal;
}
/**
 * Baixa um arquivo diretamente via requisição HTTP usando a sessão autenticada.
 * Estratégia RECOMENDADA para downloads.
 */
async function baixarArquivoDireto(page, seletorLink, basePath, nomeContabilidade, mesExecucaoExtenso, empresa, tipoNota) {
    const tipo = tipoNota.trim();
    if (tipo !== 'Emitidas' && tipo !== 'Recebidas') {
        throw new Error(`tipo_nota deve ser 'Emitidas' ou 'Recebidas'. Recebido: ${tipo}`);
    }
    const linkLocator = page.locator(seletorLink);
    if ((await linkLocator.count()) === 0) {
        throw new Error(`Link não encontrado com seletor: ${seletorLink}`);
    }
    const href = await linkLocator.nth(0).getAttribute('href');
    if (!href) {
        throw new Error(`Link encontrado mas href está vazio. Seletor: ${seletorLink}`);
    }
    const currentUrl = page.url();
    const fullUrl = new URL(href, currentUrl).href;
    const nomeChave = href.split('/').pop() || href;
    const response = await page.request.get(fullUrl);
    if (response.status() !== 200) {
        throw new Error(`Erro na requisição HTTP. Status: ${response.status()}, URL: ${fullUrl}`);
    }
    const contentType = (response.headers()['content-type'] || '').toLowerCase();
    const content = await response.body();
    let extensao;
    if (contentType.includes('xml')) {
        extensao = '.xml';
    }
    else if (contentType.includes('pdf')) {
        extensao = '.pdf';
    }
    else if (content[0] === 0x3c || (content[1] === 0x3f && content[2] === 0x78)) {
        extensao = '.xml';
    }
    else if (content[0] === 0x25 && content[1] === 0x50 && content[2] === 0x44) {
        extensao = '.pdf';
    }
    else {
        extensao = '.bin';
    }
    const contabFolder = sanitizarNomePasta(nomeContabilidade) || 'Contabilidade';
    const empresaFolder = sanitizarNomePasta(empresa);
    const pastaFinal = path.join(basePath, contabFolder, mesExecucaoExtenso, empresaFolder, tipo);
    await fs.mkdir(pastaFinal, { recursive: true });
    const nomeArquivo = sanitizarNomeArquivo(`${nomeChave}${extensao}`);
    const caminhoFinal = path.join(pastaFinal, nomeArquivo);
    await fs.writeFile(caminhoFinal, content);
    logger.info({ caminho: caminhoFinal, size: content.length }, 'Arquivo salvo com sucesso');
    return caminhoFinal;
}
//# sourceMappingURL=download-manager.js.map