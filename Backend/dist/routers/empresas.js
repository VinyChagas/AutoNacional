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
 * Router de empresas.
 */
const express_1 = require("express");
const zod_1 = require("zod");
const logger_1 = require("../infrastructure/logger");
const repo = __importStar(require("../repositories/empresas"));
const logger = (0, logger_1.getLogger)('empresas');
const router = (0, express_1.Router)();
const EmpresaCreateSchema = zod_1.z.object({
    cnpj: zod_1.z.string().refine((v) => v.replace(/[.\/\-\s]/g, '').length === 14 && /^\d+$/.test(v.replace(/[.\/\-\s]/g, '')), { message: 'CNPJ deve conter 14 dígitos' }),
    razao_social: zod_1.z.string().min(1).optional(),
    razaoSocial: zod_1.z.string().min(1).optional(),
    regime: zod_1.z.string().optional(),
    contabilidade_id: zod_1.z.number().int().positive().optional().nullable(),
    contabilidadeId: zod_1.z.number().int().positive().optional().nullable(),
});
function limparCnpj(cnpj) {
    return cnpj.replace(/[.\/\-]/g, '').trim();
}
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
// GET / - Listar empresas
router.get('/', async (_req, res) => {
    try {
        const skip = parseInt(String(_req.query.skip || 0), 10);
        const limit = Math.min(parseInt(String(_req.query.limit || 100), 10), 100);
        const empresas = await repo.listarEmpresas(skip, limit);
        res.json(empresas.map(toResponse));
    }
    catch (error) {
        logger.error({ err: error }, 'Erro ao listar empresas');
        res.status(500).json({ detail: 'Erro ao listar empresas' });
    }
});
// GET /contabilidade/:contabilidade_id - Listar por contabilidade (antes de /:id)
router.get('/contabilidade/:contabilidade_id', async (req, res) => {
    try {
        const contabilidadeId = parseInt(String(req.params.contabilidade_id ?? ''), 10);
        if (isNaN(contabilidadeId) || contabilidadeId < 1) {
            res.status(400).json({ detail: 'ID de contabilidade inválido' });
            return;
        }
        const skip = parseInt(String(req.query.skip || 0), 10);
        const limit = Math.min(parseInt(String(req.query.limit || 100), 10), 1000);
        const empresas = await repo.listarEmpresasPorContabilidade(contabilidadeId, skip, limit);
        res.json(empresas.map(toResponse));
    }
    catch (error) {
        logger.error({ err: error }, 'Erro ao listar empresas por contabilidade');
        res.status(500).json({ detail: 'Erro ao listar empresas' });
    }
});
// GET /cnpj/:cnpj - Obter por CNPJ (antes de /:id para evitar conflito)
router.get('/cnpj/:cnpj', async (req, res) => {
    try {
        const cnpj = limparCnpj(String(req.params.cnpj ?? ''));
        const empresa = await repo.obterEmpresaPorCnpj(cnpj);
        if (!empresa) {
            res.status(404).json({ detail: `Empresa com CNPJ ${cnpj} não encontrada` });
            return;
        }
        res.json(toResponse(empresa));
    }
    catch (error) {
        logger.error({ err: error }, 'Erro ao obter empresa por CNPJ');
        res.status(500).json({ detail: 'Erro ao obter empresa' });
    }
});
// GET /:empresa_id - Obter por ID
router.get('/:empresa_id', async (req, res) => {
    try {
        const id = parseInt(String(req.params.empresa_id ?? ''), 10);
        if (isNaN(id)) {
            res.status(400).json({ detail: 'ID de empresa inválido' });
            return;
        }
        const empresa = await repo.obterEmpresaPorId(id);
        if (!empresa) {
            res.status(404).json({ detail: `Empresa com ID ${id} não encontrada` });
            return;
        }
        res.json(toResponse(empresa));
    }
    catch (error) {
        logger.error({ err: error }, 'Erro ao obter empresa');
        res.status(500).json({ detail: 'Erro ao obter empresa' });
    }
});
// POST / - Criar empresa
router.post('/', async (req, res) => {
    try {
        const parsed = EmpresaCreateSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ detail: parsed.error.issues?.[0]?.message ?? 'Dados inválidos' });
            return;
        }
        const { cnpj, razao_social, razaoSocial, regime, contabilidade_id, contabilidadeId } = parsed.data;
        const razaoSocialVal = razao_social ?? razaoSocial;
        if (!razaoSocialVal) {
            res.status(400).json({ detail: 'razao_social é obrigatório' });
            return;
        }
        if (await repo.verificarCnpjTemCertificado(cnpj)) {
            res
                .status(400)
                .json({
                detail: `CNPJ ${cnpj} já possui certificado digital cadastrado. Empresas com certificado não podem ser cadastradas via credenciais.`,
            });
            return;
        }
        const empresa = await repo.criarEmpresa({
            cnpj: limparCnpj(cnpj),
            razaoSocial: razaoSocialVal,
            regime: regime ?? undefined,
            contabilidadeId: contabilidade_id ?? contabilidadeId ?? undefined,
        });
        res.status(201).json(toResponse(empresa));
    }
    catch (error) {
        logger.error({ err: error }, 'Erro ao criar empresa');
        res.status(500).json({ detail: 'Erro ao criar empresa' });
    }
});
// PUT /:empresa_id - Atualizar empresa
router.put('/:empresa_id', async (req, res) => {
    try {
        const id = parseInt(String(req.params.empresa_id ?? ''), 10);
        if (isNaN(id)) {
            res.status(400).json({ detail: 'ID de empresa inválido' });
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
            res.status(404).json({ detail: `Empresa com ID ${id} não encontrada` });
            return;
        }
        res.json(toResponse(empresa));
    }
    catch (error) {
        logger.error({ err: error }, 'Erro ao atualizar empresa');
        res.status(500).json({ detail: 'Erro ao atualizar empresa' });
    }
});
// DELETE /:empresa_id - Deletar empresa
router.delete('/:empresa_id', async (req, res) => {
    try {
        const id = parseInt(String(req.params.empresa_id ?? ''), 10);
        if (isNaN(id)) {
            res.status(400).json({ detail: 'ID de empresa inválido' });
            return;
        }
        const empresaAntes = await repo.obterEmpresaPorId(id);
        if (!empresaAntes) {
            res.status(404).json({ detail: `Empresa com ID ${id} não encontrada` });
            return;
        }
        const ok = await repo.deletarEmpresa(id);
        if (!ok) {
            res.status(500).json({ detail: 'Falha ao deletar empresa' });
            return;
        }
        res.status(204).send();
    }
    catch (error) {
        logger.error({ err: error }, 'Erro ao deletar empresa');
        res.status(500).json({ detail: 'Erro ao deletar empresa' });
    }
});
exports.default = router;
//# sourceMappingURL=empresas.js.map