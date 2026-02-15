"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.seedDefaultSettings = seedDefaultSettings;
/**
 * Inicialização do banco de dados.
 * Cria registros padrão (Settings) se não existirem.
 */
const client_1 = require("./client");
const logger_1 = require("../infrastructure/logger");
const logger = (0, logger_1.getLogger)('db:init');
async function seedDefaultSettings() {
    const count = await client_1.prisma.settings.count();
    if (count === 0) {
        await client_1.prisma.settings.create({
            data: {
                headless: false,
                companyTimeoutSeconds: 300,
                maxRetriesPerStep: 3,
                minActionDelayMs: 500,
                maxConcurrentBrowsers: 5,
                defaultConcurrentBrowsers: 3,
                browserLaunchDelayMs: 1000,
                viewportPreset: 'FULLHD',
                downloadsBasePath: './downloads',
                downloadsPattern: '{cnpj}/{ano}/{mes}',
                logsPath: './logs',
                tempPath: './temp',
                logLevel: 'INFO',
                saveErrorScreenshots: true,
                generatePdfReport: true,
                logRetentionDays: 30,
                maxErrorsInPanel: 100,
            },
        });
        logger.info('Settings padrão criadas');
    }
}
//# sourceMappingURL=init.js.map