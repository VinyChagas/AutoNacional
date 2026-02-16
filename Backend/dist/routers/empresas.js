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
 * Router legado de empresas: CRUD básico (POST criar, PUT atualizar, DELETE excluir).
 * Listagem e detalhes ficam no módulo unificado (empresas.routes).
 */
const express_1 = require("express");
const zod_1 = require("zod");
const logger_1 = require("../infrastructure/logger");
const error_handler_1 = require("../middleware/error-handler");
const response_1 = require("../middleware/response");
const repo = __importStar(require("../repositories/empresas"));
const cnpj_1 = require("../utils/cnpj");
const logger = (0, logger_1.getLogger)('empresas');
const router = (0, express_1.Router)();
const EmpresaCreateSchema = zod_1.z.object({
    cnpj: zod_1.z.string().refine((v) => (0, cnpj_1.normalizeCnpj)(v).length === 14 && /^\d+$/.test((0, cnpj_1.normalizeCnpj)(v)), { message: 'CNPJ deve conter 14 dígitos' }),
    razao_social: zod_1.z.string().min(1).optional(),
    razaoSocial: zod_1.z.string().min(1).optional(),
    regime: zod_1.z.string().optional(),
    contabilidade_id: zod_1.z.number().int().positive().optional().nullable(),
    contabilidadeId: zod_1.z.number().int().positive().optional().nullable(),
});
function toResponse(empresa) {
    return {
        id: String(empresa.id),
        cnpj: empresa.cnpj,
        razao_social: empresa.razaoSocial,
        regime: empresa.regime,
        contabilidade_id: empresa.contabilidadeId,
        created_at: empresa.createdAt.toISOString(),
        updated_at: empresa.updatedAt.toISOString(),
    };
}
// POST / - Criar empresa (legado)
router.post('/', (0, error_handler_1.asyncHandler)(async (req, res) => {
    const parsed = EmpresaCreateSchema.safeParse(req.body);
    if (!parsed.success) {
        (0, response_1.jsonError)(res, parsed.error.issues?.[0]?.message ?? 'Dados inválidos', 400);
        return;
    }
    const { cnpj, razao_social, razaoSocial, regime, contabilidade_id, contabilidadeId } = parsed.data;
    const razaoSocialVal = razao_social ?? razaoSocial;
    if (!razaoSocialVal) {
        (0, response_1.jsonError)(res, 'razao_social é obrigatório', 400);
        return;
    }
    if (await repo.verificarCnpjTemCertificado(cnpj)) {
        (0, response_1.jsonError)(res, `CNPJ ${cnpj} já possui certificado digital cadastrado. Empresas com certificado não podem ser cadastradas via credenciais.`, 400);
        return;
    }
    const empresa = await repo.criarEmpresa({
        cnpj: (0, cnpj_1.normalizeCnpj)(cnpj),
        razaoSocial: razaoSocialVal,
        regime: regime ?? undefined,
        contabilidadeId: contabilidade_id ?? contabilidadeId ?? undefined,
    });
    (0, response_1.jsonCreated)(res, toResponse(empresa), 'Empresa criada');
}));
// PUT /:id - Atualizar empresa (legado)
router.put('/:id', (0, error_handler_1.asyncHandler)(async (req, res) => {
    const id = parseInt(String(req.params.id ?? ''), 10);
    if (isNaN(id) || id < 1) {
        (0, response_1.jsonError)(res, 'ID de empresa inválido', 400);
        return;
    }
    const data = {};
    if (req.body.razao_social != null)
        data.razaoSocial = req.body.razao_social;
    if (req.body.razaoSocial != null)
        data.razaoSocial = req.body.razaoSocial;
    if (req.body.regime != null)
        data.regime = req.body.regime;
    if (req.body.contabilidade_id != null)
        data.contabilidadeId = req.body.contabilidade_id;
    if (req.body.contabilidadeId != null)
        data.contabilidadeId = req.body.contabilidadeId;
    const empresa = await repo.atualizarEmpresa(id, data);
    if (!empresa) {
        (0, response_1.jsonError)(res, `Empresa com ID ${id} não encontrada`, 404);
        return;
    }
    (0, response_1.jsonSuccess)(res, toResponse(empresa));
}));
// DELETE /:id - Deletar empresa individual (legado) → 204 No Content
router.delete('/:id', (0, error_handler_1.asyncHandler)(async (req, res) => {
    const id = parseInt(String(req.params.id ?? ''), 10);
    if (isNaN(id) || id < 1) {
        (0, response_1.jsonError)(res, 'ID de empresa inválido', 400);
        return;
    }
    const empresaAntes = await repo.obterEmpresaPorId(id);
    if (!empresaAntes) {
        (0, response_1.jsonError)(res, `Empresa com ID ${id} não encontrada`, 404);
        return;
    }
    const ok = await repo.deletarEmpresa(id);
    if (!ok) {
        (0, response_1.jsonError)(res, 'Falha ao deletar empresa', 500);
        return;
    }
    res.status(204).send();
}));
exports.default = router;
//# sourceMappingURL=empresas.js.map