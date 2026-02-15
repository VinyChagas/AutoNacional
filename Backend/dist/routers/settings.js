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
/**
 * Router de configurações de automação.
 */
const express_1 = require("express");
const logger_1 = require("../infrastructure/logger");
const repo = __importStar(require("../repositories/settings"));
const logger = (0, logger_1.getLogger)('settings');
const router = (0, express_1.Router)();
function toResponse(s) {
    return {
        id: s.id,
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
/**
 * GET /api/settings
 */
router.get('/', async (_req, res) => {
    try {
        logger.info('Endpoint GET /api/settings chamado');
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
 * PUT /api/settings
 * Converte camelCase do frontend para o repositório.
 */
router.put('/', async (req, res) => {
    try {
        logger.info('Endpoint PUT /api/settings chamado');
        const body = req.body;
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
        const config = await repo.atualizarConfiguracoes(data);
        res.json(toResponse(config));
    }
    catch (error) {
        logger.error({ err: error }, 'Erro ao atualizar configurações');
        res.status(500).json({ detail: 'Erro ao atualizar configurações' });
    }
});
exports.default = router;
//# sourceMappingURL=settings.js.map