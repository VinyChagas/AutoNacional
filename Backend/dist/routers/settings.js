"use strict";
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
exports.DEFAULT_SETTINGS = void 0;
/**
 * Router de configurações de automação.
 * Endpoints: GET, PUT, GET /defaults, POST /reset, POST /test-paths
 */
const express_1 = require("express");
const path = __importStar(require("path"));
const fs = __importStar(require("fs/promises"));
const logger_1 = require("../infrastructure/logger");
const native_folder_picker_1 = require("../utils/native-folder-picker");
const path_resolve_1 = require("../utils/path-resolve");
const repo = __importStar(require("../repositories/settings"));
const logger = (0, logger_1.getLogger)('settings');
const router = (0, express_1.Router)();
/** Valores padrão "factory" para comparação e reset */
exports.DEFAULT_SETTINGS = {
    headless: false,
    companyTimeoutSeconds: 3600,
    maxRetriesPerStep: 3,
    minActionDelayMs: 500,
    maxConcurrentBrowsers: 5,
    defaultConcurrentBrowsers: 3,
    browserLaunchDelayMs: 1000,
    viewportPreset: 'FULLHD',
    viewportWidth: null,
    viewportHeight: null,
    downloadsBasePath: './downloads',
    downloadsPattern: '{cnpj}/{ano}/{mes}',
    logsPath: './logs',
    tempPath: './temp',
    logLevel: 'INFO',
    saveErrorScreenshots: true,
    generatePdfReport: true,
    logRetentionDays: 30,
    maxErrorsInPanel: 100,
};
function toResponse(s) {
    return {
        id: 'id' in s ? s.id : undefined,
        execution: {
            headless: s.headless,
            companyTimeoutSeconds: s.companyTimeoutSeconds,
            maxRetriesPerStep: s.maxRetriesPerStep,
            minActionDelayMs: s.minActionDelayMs,
        },
        browsers: {
            maxConcurrentBrowsers: s.maxConcurrentBrowsers,
            defaultConcurrentBrowsers: s.defaultConcurrentBrowsers,
            browserLaunchDelayMs: s.browserLaunchDelayMs,
            viewportPreset: s.viewportPreset,
            viewportWidth: s.viewportWidth,
            viewportHeight: s.viewportHeight,
        },
        paths: {
            downloadsBasePath: s.downloadsBasePath,
            downloadsPattern: s.downloadsPattern,
            logsPath: s.logsPath,
            tempPath: s.tempPath,
        },
        logs: {
            logLevel: s.logLevel,
            saveErrorScreenshots: s.saveErrorScreenshots,
            generatePdfReport: s.generatePdfReport,
            logRetentionDays: s.logRetentionDays,
            maxErrorsInPanel: s.maxErrorsInPanel,
        },
        // Flat para compatibilidade com frontend que pode esperar formato antigo
        headless: s.headless,
        companyTimeoutSeconds: s.companyTimeoutSeconds,
        maxRetriesPerStep: s.maxRetriesPerStep,
        minActionDelayMs: s.minActionDelayMs,
        maxConcurrentBrowsers: s.maxConcurrentBrowsers,
        defaultConcurrentBrowsers: s.defaultConcurrentBrowsers,
        browserLaunchDelayMs: s.browserLaunchDelayMs,
        viewportPreset: s.viewportPreset,
        viewportWidth: s.viewportWidth,
        viewportHeight: s.viewportHeight,
        downloadsBasePath: s.downloadsBasePath,
        downloadsPattern: s.downloadsPattern,
        logsPath: s.logsPath,
        tempPath: s.tempPath,
        logLevel: s.logLevel,
        saveErrorScreenshots: s.saveErrorScreenshots,
        generatePdfReport: s.generatePdfReport,
        logRetentionDays: s.logRetentionDays,
        maxErrorsInPanel: s.maxErrorsInPanel,
    };
}
function parseBodyToUpdate(body) {
    const data = {};
    if (body.headless != null)
        data.headless = Boolean(body.headless);
    if (body.companyTimeoutSeconds != null)
        data.companyTimeoutSeconds = Number(body.companyTimeoutSeconds);
    if (body.maxRetriesPerStep != null)
        data.maxRetriesPerStep = Number(body.maxRetriesPerStep);
    if (body.minActionDelayMs != null)
        data.minActionDelayMs = Number(body.minActionDelayMs);
    if (body.maxConcurrentBrowsers != null)
        data.maxConcurrentBrowsers = Number(body.maxConcurrentBrowsers);
    if (body.defaultConcurrentBrowsers != null)
        data.defaultConcurrentBrowsers = Number(body.defaultConcurrentBrowsers);
    if (body.browserLaunchDelayMs != null)
        data.browserLaunchDelayMs = Number(body.browserLaunchDelayMs);
    if (body.viewportPreset != null)
        data.viewportPreset = String(body.viewportPreset);
    if (body.viewportWidth != null)
        data.viewportWidth = body.viewportWidth === null ? null : Number(body.viewportWidth);
    if (body.viewportHeight != null)
        data.viewportHeight = body.viewportHeight === null ? null : Number(body.viewportHeight);
    if (body.downloadsBasePath != null)
        data.downloadsBasePath = String(body.downloadsBasePath);
    if (body.downloadsPattern != null)
        data.downloadsPattern = String(body.downloadsPattern);
    if (body.logsPath != null)
        data.logsPath = String(body.logsPath);
    if (body.tempPath != null)
        data.tempPath = String(body.tempPath);
    if (body.logLevel != null)
        data.logLevel = String(body.logLevel);
    if (body.saveErrorScreenshots != null)
        data.saveErrorScreenshots = Boolean(body.saveErrorScreenshots);
    if (body.generatePdfReport != null)
        data.generatePdfReport = Boolean(body.generatePdfReport);
    if (body.logRetentionDays != null)
        data.logRetentionDays = Number(body.logRetentionDays);
    if (body.maxErrorsInPanel != null)
        data.maxErrorsInPanel = Number(body.maxErrorsInPanel);
    return data;
}
/** Validações server-side para PUT */
function validateSettings(data) {
    const errors = [];
    const maxC = data.maxConcurrentBrowsers ?? 5;
    const defC = data.defaultConcurrentBrowsers ?? 3;
    if (defC > maxC) {
        errors.push({
            field: 'defaultConcurrentBrowsers',
            message: 'Padrão de navegadores não pode ser maior que o máximo',
        });
    }
    if (data.viewportPreset === 'CUSTOM') {
        const w = data.viewportWidth ?? 0;
        const h = data.viewportHeight ?? 0;
        if (!w || !h || w < 1 || h < 1) {
            errors.push({
                field: 'viewportWidth',
                message: 'Com viewport CUSTOM, largura e altura são obrigatórias e devem ser > 0',
            });
        }
    }
    return { valid: errors.length === 0, errors };
}
/** Resolve pattern de downloads com placeholders */
function resolveDownloadsPattern(basePath, pattern, sample) {
    const cnpjRaw = (sample.cnpj || '00.000.000/0001-00').replace(/\D/g, '');
    const comp = sample.competencia || '2026-01';
    const [ano, mes] = comp.includes('/')
        ? comp.split('/').reverse()
        : comp.includes('-')
            ? comp.split('-')
            : [comp.slice(4), comp.slice(0, 2)];
    let resolved = pattern
        .replace(/\{cnpj\}/gi, cnpjRaw)
        .replace(/\{ano\}/gi, ano || '2026')
        .replace(/\{mes\}/gi, mes || '01');
    const full = path.join(basePath, resolved);
    return path.normalize(full);
}
/** Verifica se diretório existe (ou pode ser criado) e tem permissão de escrita */
async function checkPathWritable(dirPath) {
    try {
        const normalized = (0, path_resolve_1.resolveStoragePath)(dirPath);
        try {
            await fs.mkdir(normalized, { recursive: true });
        }
        catch {
            /* pode já existir */
        }
        const stat = await fs.stat(normalized);
        if (!stat.isDirectory()) {
            return { ok: false, error: 'Não é um diretório' };
        }
        const testFile = path.join(normalized, `.write-test-${Date.now()}`);
        await fs.writeFile(testFile, 'test', 'utf8');
        await fs.unlink(testFile);
        return { ok: true };
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: msg };
    }
}
/** Verifica se consegue criar subpastas */
async function checkCanCreateSubfolders(dirPath) {
    try {
        const normalized = (0, path_resolve_1.resolveStoragePath)(dirPath);
        try {
            await fs.mkdir(normalized, { recursive: true });
        }
        catch {
            /* pode já existir */
        }
        const testDir = path.join(normalized, `test-sub-${Date.now()}`);
        await fs.mkdir(testDir, { recursive: true });
        await fs.rmdir(testDir);
        return { ok: true };
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: msg };
    }
}
/**
 * GET /api/settings
 */
router.get('/', async (_req, res) => {
    try {
        const config = await repo.obterConfiguracoes();
        if (!config) {
            res.status(500).json({ detail: 'Erro ao obter configurações' });
            return;
        }
        res.json(toResponse(config));
    }
    catch (error) {
        logger.error({ err: error }, 'Erro ao obter configurações');
        res.status(500).json({ detail: 'Erro ao obter configurações' });
    }
});
/**
 * GET /api/settings/defaults
 */
router.get('/defaults', (_req, res) => {
    res.json(toResponse(exports.DEFAULT_SETTINGS));
});
/**
 * PUT /api/settings
 */
router.put('/', async (req, res) => {
    try {
        const body = req.body;
        const data = parseBodyToUpdate(body);
        const validation = validateSettings(data);
        if (!validation.valid) {
            res.status(422).json({
                detail: 'Validação falhou',
                errors: validation.errors,
            });
            return;
        }
        const config = await repo.atualizarConfiguracoes(data);
        res.json(toResponse(config));
    }
    catch (error) {
        logger.error({ err: error }, 'Erro ao atualizar configurações');
        res.status(500).json({ detail: 'Erro ao atualizar configurações' });
    }
});
/**
 * POST /api/settings/reset
 */
router.post('/reset', async (_req, res) => {
    try {
        const config = await repo.atualizarConfiguracoes(exports.DEFAULT_SETTINGS);
        res.json(toResponse(config));
    }
    catch (error) {
        logger.error({ err: error }, 'Erro ao resetar configurações');
        res.status(500).json({ detail: 'Erro ao resetar configurações' });
    }
});
/**
 * POST /api/settings/test-paths
 * Body: { downloadsBasePath, downloadsPattern, logsPath, tempPath, sample?: { cnpj, competencia } }
 */
router.post('/test-paths', async (req, res) => {
    try {
        const body = req.body;
        const basePath = body.downloadsBasePath ?? './downloads';
        const pattern = body.downloadsPattern ?? '{cnpj}/{ano}/{mes}';
        const logsPath = body.logsPath ?? './logs';
        const tempPath = body.tempPath ?? './temp';
        const sample = body.sample ?? { cnpj: '00.000.000/0001-00', competencia: '2026-01' };
        const baseResolved = (0, path_resolve_1.resolveStoragePath)(basePath);
        const previewResolvedPath = resolveDownloadsPattern(baseResolved, pattern, sample);
        const [downloadsCheck, logsCheck, tempCheck] = await Promise.all([
            checkPathWritable(basePath),
            checkPathWritable(logsPath),
            checkPathWritable(tempPath),
        ]);
        const canCreateSubfolders = (await checkCanCreateSubfolders(basePath)).ok;
        const errors = [];
        if (!downloadsCheck.ok)
            errors.push(`Downloads: ${downloadsCheck.error}`);
        if (!logsCheck.ok)
            errors.push(`Logs: ${logsCheck.error}`);
        if (!tempCheck.ok)
            errors.push(`Temp: ${tempCheck.error}`);
        res.json({
            previewResolvedPath,
            checks: {
                downloadsWritable: downloadsCheck.ok,
                logsWritable: logsCheck.ok,
                tempWritable: tempCheck.ok,
                canCreateSubfolders,
                errors,
            },
        });
    }
    catch (error) {
        logger.error({ err: error }, 'Erro ao testar diretórios');
        res.status(500).json({ detail: 'Erro ao testar diretórios' });
    }
});
/**
 * POST /api/settings/select-folder
 * Abre seletor nativo de pasta no servidor e retorna o caminho absoluto.
 * Requer que o backend rode na mesma máquina do usuário (ex: desenvolvimento local).
 */
router.post('/select-folder', async (_req, res) => {
    try {
        const selectedPath = await (0, native_folder_picker_1.openNativeFolderPicker)();
        if (!selectedPath) {
            res.status(400).json({ detail: 'Nenhuma pasta selecionada', path: null });
            return;
        }
        res.json({ path: selectedPath });
    }
    catch (error) {
        logger.error({ err: error }, 'Erro ao abrir seletor de pasta');
        res.status(500).json({ detail: 'Erro ao abrir seletor de pasta', path: null });
    }
});
exports.default = router;
//# sourceMappingURL=settings.js.map