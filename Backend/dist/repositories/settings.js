"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.obterConfiguracoes = obterConfiguracoes;
exports.atualizarConfiguracoes = atualizarConfiguracoes;
/**
 * Repositório de configurações (Settings).
 */
const client_1 = require("../db/client");
async function obterConfiguracoes() {
    return client_1.prisma.settings.findFirst();
}
async function atualizarConfiguracoes(data) {
    const existing = await client_1.prisma.settings.findFirst();
    const clean = {};
    for (const [k, v] of Object.entries(data)) {
        if (v !== undefined)
            clean[k] = v;
    }
    if (existing) {
        return client_1.prisma.settings.update({
            where: { id: existing.id },
            data: clean,
        });
    }
    return client_1.prisma.settings.create({
        data: {
            headless: data.headless ?? false,
            companyTimeoutSeconds: data.companyTimeoutSeconds ?? 300,
            maxRetriesPerStep: data.maxRetriesPerStep ?? 3,
            minActionDelayMs: data.minActionDelayMs ?? 500,
            maxConcurrentBrowsers: data.maxConcurrentBrowsers ?? 5,
            defaultConcurrentBrowsers: data.defaultConcurrentBrowsers ?? 3,
            browserLaunchDelayMs: data.browserLaunchDelayMs ?? 1000,
            viewportPreset: data.viewportPreset ?? 'FULLHD',
            viewportWidth: data.viewportWidth ?? null,
            viewportHeight: data.viewportHeight ?? null,
            downloadsBasePath: data.downloadsBasePath ?? './downloads',
            downloadsPattern: data.downloadsPattern ?? '{cnpj}/{ano}/{mes}',
            logsPath: data.logsPath ?? './logs',
            tempPath: data.tempPath ?? './temp',
            logLevel: data.logLevel ?? 'INFO',
            saveErrorScreenshots: data.saveErrorScreenshots ?? true,
            generatePdfReport: data.generatePdfReport ?? true,
            logRetentionDays: data.logRetentionDays ?? 30,
            maxErrorsInPanel: data.maxErrorsInPanel ?? 100,
        },
    });
}
//# sourceMappingURL=settings.js.map