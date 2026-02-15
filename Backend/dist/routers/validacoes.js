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
 * Jobs em memória com suporte a polling.
 */
const express_1 = require("express");
const zod_1 = require("zod");
const logger_1 = require("../infrastructure/logger");
const error_handler_1 = require("../middleware/error-handler");
const response_1 = require("../middleware/response");
const validacoesService = __importStar(require("../services/validacoes-service"));
const logger = (0, logger_1.getLogger)('validacoes');
const router = (0, express_1.Router)();
const StartSchema = zod_1.z.object({
    targets: zod_1.z.array(zod_1.z.enum(['CERTIFICADO', 'CREDENCIAL'])).min(1),
    scope: zod_1.z.object({
        mode: zod_1.z.enum(['SELECTED', 'FILTERED', 'ALL']),
        empresa_ids: zod_1.z.array(zod_1.z.number().int().positive()).optional(),
    }),
    filters: zod_1.z
        .object({
        search: zod_1.z.string().optional(),
        contabilidade_id: zod_1.z.number().optional(),
        has_cert: zod_1.z.boolean().optional(),
        has_cred: zod_1.z.boolean().optional(),
        sem_cert: zod_1.z.boolean().optional(),
        sem_cred: zod_1.z.boolean().optional(),
        sem_metodo: zod_1.z.boolean().optional(),
        sort: zod_1.z.string().optional(),
        order: zod_1.z.enum(['asc', 'desc']).optional(),
    })
        .optional(),
    options: zod_1.z
        .object({
        concurrency: zod_1.z.number().int().min(1).max(8).optional(),
        timeoutSeconds: zod_1.z.number().int().min(10).max(300).optional(),
        stopOnConsecutiveErrors: zod_1.z.number().int().min(1).max(20).optional(),
    })
        .optional(),
});
router.post('/start', (0, error_handler_1.asyncHandler)(async (req, res) => {
    const parsed = StartSchema.safeParse(req.body);
    if (!parsed.success) {
        (0, response_1.jsonError)(res, parsed.error.issues?.[0]?.message ?? 'Payload inválido', 400);
        return;
    }
    const jobId = await validacoesService.iniciarValidacao(parsed.data);
    logger.info({ jobId }, 'Validação iniciada');
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
        ok: job.ok,
        errors: job.errors,
        processed: job.processed,
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