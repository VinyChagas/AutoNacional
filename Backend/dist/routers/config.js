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
 * Router de status do ambiente (READ-ONLY).
 * Nunca expõe chaves sensíveis.
 */
const express_1 = require("express");
const logger_1 = require("../infrastructure/logger");
const client_1 = require("@prisma/client");
const client_2 = require("../db/client");
const config_1 = require("../infrastructure/config");
const logger = (0, logger_1.getLogger)('config');
function isPlaywrightInstalled() {
    return Promise.resolve().then(() => __importStar(require('playwright'))).then(() => true)
        .catch(() => false);
}
/**
 * GET /api/config/status
 * Retorna status do ambiente sem expor segredos.
 */
const router = (0, express_1.Router)();
router.get('/status', async (_req, res) => {
    try {
        let dbConnected = false;
        try {
            await client_2.prisma.$queryRaw(client_1.Prisma.sql `SELECT 1`);
            dbConnected = true;
        }
        catch {
            dbConnected = false;
        }
        const playwrightOk = await isPlaywrightInstalled();
        res.json({
            apiUp: true,
            dbConnected,
            supabaseConfigured: Boolean(config_1.SUPABASE_URL && config_1.SUPABASE_URL.length > 0),
            playwrightOk,
            corsOrigins: config_1.CORS_ORIGINS,
            port: config_1.PORT,
            version: process.env.npm_package_version || '1.0.0',
        });
    }
    catch (error) {
        logger.error({ err: error }, 'Erro ao obter status');
        res.status(500).json({
            apiUp: true,
            dbConnected: false,
            supabaseConfigured: false,
            playwrightOk: false,
            error: 'Falha ao verificar status',
        });
    }
});
exports.default = router;
//# sourceMappingURL=config.js.map