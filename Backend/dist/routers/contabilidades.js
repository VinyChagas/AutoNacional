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
 * Router de contabilidades.
 * Rotas de contabilidades.
 */
const express_1 = require("express");
const logger_1 = require("../infrastructure/logger");
const repo = __importStar(require("../repositories/contabilidades"));
const logger = (0, logger_1.getLogger)('contabilidades');
const router = (0, express_1.Router)();
function limparCnpj(cnpj) {
    return cnpj.replace(/[.\/\-\s]/g, '').trim();
}
function toResponse(item) {
    if (!item)
        return null;
    return {
        id: item.id,
        nome_contabilidade: item.nomeContabilidade,
        cnpj: item.cnpj,
        email: item.email,
        telefone: item.telefone,
        responsavel: item.responsavel,
        data_cadastro: item.dataCadastro?.toISOString?.() ?? null,
        certificados_vinculados: item.certificados_vinculados ?? 0,
    };
}
// POST / - Criar contabilidade
router.post('/', async (req, res) => {
    try {
        const cnpj = limparCnpj(req.body.cnpj ?? '');
        if (cnpj.length !== 14 || !/^\d+$/.test(cnpj)) {
            res.status(400).json({ detail: 'CNPJ deve conter exatamente 14 dígitos' });
            return;
        }
        const nome = String(req.body.nome_contabilidade ?? req.body.nomeContabilidade ?? '').trim();
        if (!nome) {
            res.status(400).json({ detail: 'nome_contabilidade é obrigatório' });
            return;
        }
        const existente = await repo.obterPorCnpj(cnpj);
        if (existente) {
            res.status(400).json({ detail: 'Já existe contabilidade com este CNPJ' });
            return;
        }
        const cont = await repo.criar({
            nomeContabilidade: nome,
            cnpj,
            email: req.body.email,
            telefone: req.body.telefone,
            responsavel: req.body.responsavel,
        });
        const vinculados = await repo.obterTotalVinculados(cont.id);
        res.status(201).json(toResponse({ ...cont, certificados_vinculados: vinculados }));
    }
    catch (error) {
        logger.error({ err: error }, 'Erro ao criar contabilidade');
        res.status(500).json({ detail: 'Erro ao criar contabilidade' });
    }
});
// GET / - Listar contabilidades
router.get('/', async (req, res) => {
    try {
        const skip = Math.max(0, parseInt(String(req.query.skip ?? 0), 10));
        const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? 100), 10)));
        const contabilidades = await repo.listarContabilidades(skip, limit);
        const ids = contabilidades.map((c) => c.id);
        const vinculadosMap = await repo.obterTotalVinculadosPorIds(ids);
        const items = contabilidades.map((c) => toResponse({ ...c, certificados_vinculados: vinculadosMap[c.id] ?? 0 }));
        res.json({
            contabilidades: items,
            total: items.length,
        });
    }
    catch (error) {
        logger.error({ err: error }, 'Erro ao listar contabilidades');
        res.status(500).json({ detail: 'Erro ao listar contabilidades' });
    }
});
// GET /:contabilidade_id - Obter por ID
router.get('/:contabilidade_id', async (req, res) => {
    try {
        const id = parseInt(String(req.params.contabilidade_id ?? ''), 10);
        if (isNaN(id) || id < 1) {
            res.status(400).json({ detail: 'ID inválido' });
            return;
        }
        const cont = await repo.obterPorId(id);
        if (!cont) {
            res.status(404).json({ detail: 'Contabilidade não encontrada' });
            return;
        }
        const vinculados = await repo.obterTotalVinculados(cont.id);
        res.json(toResponse({ ...cont, certificados_vinculados: vinculados }));
    }
    catch (error) {
        logger.error({ err: error }, 'Erro ao obter contabilidade');
        res.status(500).json({ detail: 'Erro ao obter contabilidade' });
    }
});
// PUT /:contabilidade_id - Atualizar
router.put('/:contabilidade_id', async (req, res) => {
    try {
        const id = parseInt(String(req.params.contabilidade_id ?? ''), 10);
        if (isNaN(id) || id < 1) {
            res.status(400).json({ detail: 'ID inválido' });
            return;
        }
        const data = {};
        if (req.body.nome_contabilidade != null)
            data.nomeContabilidade = req.body.nome_contabilidade;
        if (req.body.nomeContabilidade != null)
            data.nomeContabilidade = req.body.nomeContabilidade;
        if (req.body.email != null)
            data.email = req.body.email;
        if (req.body.telefone != null)
            data.telefone = req.body.telefone;
        if (req.body.responsavel != null)
            data.responsavel = req.body.responsavel;
        if (Object.keys(data).length === 0) {
            res.status(400).json({ detail: 'Nenhuma alteração informada' });
            return;
        }
        const cont = await repo.atualizar(id, data);
        if (!cont) {
            res.status(404).json({ detail: 'Contabilidade não encontrada após atualização' });
            return;
        }
        const vinculados = await repo.obterTotalVinculados(cont.id);
        res.json(toResponse({ ...cont, certificados_vinculados: vinculados }));
    }
    catch (error) {
        logger.error({ err: error }, 'Erro ao atualizar contabilidade');
        res.status(500).json({ detail: 'Erro ao atualizar contabilidade' });
    }
});
// DELETE /:contabilidade_id - Excluir
router.delete('/:contabilidade_id', async (req, res) => {
    try {
        const id = parseInt(String(req.params.contabilidade_id ?? ''), 10);
        if (isNaN(id) || id < 1) {
            res.status(400).json({ detail: 'ID inválido' });
            return;
        }
        const exists = await repo.obterPorId(id);
        if (!exists) {
            res.status(404).json({ detail: 'Contabilidade não encontrada' });
            return;
        }
        await repo.deletar(id);
        res.status(204).send();
    }
    catch (error) {
        logger.error({ err: error }, 'Erro ao excluir contabilidade');
        res.status(500).json({ detail: 'Erro ao excluir contabilidade' });
    }
});
exports.default = router;
//# sourceMappingURL=contabilidades.js.map