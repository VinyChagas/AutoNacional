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
 * Router de validações (certificados e credenciais).
 * Suporta SSE para progresso em tempo real.
 */
const express_1 = require("express");
const zod_1 = require("zod");
const logger_1 = require("../infrastructure/logger");
const error_handler_1 = require("../middleware/error-handler");
const response_1 = require("../middleware/response");
const validacoesService = __importStar(require("../services/validacoes-service"));
const logger = (0, logger_1.getLogger)('validacoes');
const router = (0, express_1.Router)();
const IniciarSchema = zod_1.z.object({
    empresa_ids: zod_1.z.array(zod_1.z.number().int().positive()).min(1),
    validar_certificados: zod_1.z.boolean(),
    validar_credenciais: zod_1.z.boolean(),
    headless: zod_1.z.boolean().optional().default(true),
});
router.post('/iniciar', (0, error_handler_1.asyncHandler)(async (req, res) => {
    logger.info({ body: req.body }, 'POST /validacoes/iniciar recebido');
    const parsed = IniciarSchema.safeParse(req.body);
    if (!parsed.success) {
        logger.warn({ issues: parsed.error.issues }, 'Payload inválido');
        (0, response_1.jsonError)(res, parsed.error.issues?.[0]?.message ?? 'Payload inválido', 400);
        return;
    }
    const jobId = await validacoesService.iniciarValidacao(parsed.data);
    logger.info({ jobId, empresaIds: parsed.data.empresa_ids.length, validarCred: parsed.data.validar_credenciais }, 'Validação iniciada');
    (0, response_1.jsonCreated)(res, { job_id: jobId }, 'Validação iniciada');
}));
router.get('/stream/:job_id', (0, error_handler_1.asyncHandler)(async (req, res) => {
    const jobId = String(req.params.job_id ?? '').trim();
    if (!jobId) {
        (0, response_1.jsonError)(res, 'job_id é obrigatório', 400);
        return;
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    validacoesService.registrarClienteSSE(jobId, res);
}));
router.post('/start', (0, error_handler_1.asyncHandler)(async (req, res) => {
    const StartSchema = zod_1.z.object({
        targets: zod_1.z.array(zod_1.z.enum(['CERTIFICADO', 'CREDENCIAL'])).min(1),
        scope: zod_1.z.object({
            mode: zod_1.z.enum(['SELECTED', 'FILTERED', 'ALL']),
            empresa_ids: zod_1.z.array(zod_1.z.number().int().positive()).optional(),
        }),
        filters: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).optional(),
    });
    const parsed = StartSchema.safeParse(req.body);
    if (!parsed.success) {
        (0, response_1.jsonError)(res, parsed.error.issues?.[0]?.message ?? 'Payload inválido', 400);
        return;
    }
    const jobId = await validacoesService.iniciarValidacaoLegacy(parsed.data);
    logger.info({ jobId }, 'Validação iniciada (legacy)');
    (0, response_1.jsonCreated)(res, { job_id: jobId }, 'Validação iniciada');
}));
router.get('/:job_id', (0, error_handler_1.asyncHandler)(async (req, res) => {
    const jobId = String(req.params.job_id ?? '').trim();
    if (!jobId) {
        (0, response_1.jsonError)(res, 'job_id é obrigatório', 400);
        return;
    }
    const job = validacoesService.obterJob(jobId);
    if (!job) {
        (0, response_1.jsonError)(res, `Job ${jobId} não encontrado`, 404);
        return;
    }
    (0, response_1.jsonSuccess)(res, {
        job_id: jobId,
        status: job.status,
        progress: job.progress,
        total: job.total,
        done: job.processed,
        ok: job.ok,
        invalidas: job.invalidas,
        errors: job.erros,
        processed: job.processed,
        items: job.items ?? [],
    });
}));
router.post('/:job_id/cancel', (0, error_handler_1.asyncHandler)(async (req, res) => {
    const jobId = String(req.params.job_id ?? '').trim();
    if (!jobId) {
        (0, response_1.jsonError)(res, 'job_id é obrigatório', 400);
        return;
    }
    const ok = validacoesService.cancelarJob(jobId);
    if (!ok) {
        (0, response_1.jsonError)(res, `Job ${jobId} não encontrado ou já finalizado`, 404);
        return;
    }
    (0, response_1.jsonSuccess)(res, { cancelled: true });
}));
exports.default = router;
//# sourceMappingURL=validacoes.js.map