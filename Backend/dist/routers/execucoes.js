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
 * Router de execuções (histórico).
 * Orquestração real vem na Fase 4.
 */
const express_1 = require("express");
const logger_1 = require("../infrastructure/logger");
const repo = __importStar(require("../repositories/execucoes"));
const logger = (0, logger_1.getLogger)('execucoes');
const router = (0, express_1.Router)();
function toResponse(e) {
    return {
        id: e.id,
        empresa_id: e.empresaId,
        cnpj: e.cnpj,
        status: e.status,
        etapa_atual: e.etapaAtual,
        progresso: e.progresso,
        periodo_inicio: e.periodoInicio,
        periodo_fim: e.periodoFim,
        tipo: e.tipo,
        mensagem: e.mensagem,
        data_inicio: e.dataInicio?.toISOString() ?? null,
        data_fim: e.dataFim?.toISOString() ?? null,
        mensagem_erro: e.mensagemErro,
        qtd_notas_emitidas: e.qtdNotasEmitidas,
        qtd_notas_recebidas: e.qtdNotasRecebidas,
        resultado_final: e.resultadoFinal,
        created_at: e.createdAt.toISOString(),
        atualizado_em: e.atualizadoEm.toISOString(),
    };
}
// GET / - Listar execuções
router.get('/', async (req, res) => {
    try {
        const skip = parseInt(String(req.query.skip ?? 0), 10);
        const limit = Math.min(parseInt(String(req.query.limit ?? 100), 10), 100);
        const status = req.query.status;
        const empresaId = req.query.empresa_id
            ? parseInt(String(req.query.empresa_id), 10)
            : undefined;
        const execucoes = await repo.listarExecucoes({
            skip,
            limit,
            status: status || undefined,
            empresaId: empresaId && !isNaN(empresaId) ? empresaId : undefined,
        });
        res.json(execucoes.map(toResponse));
    }
    catch (error) {
        logger.error({ err: error }, 'Erro ao listar execuções');
        res.status(500).json({ detail: 'Erro ao listar execuções' });
    }
});
// GET /:id - Obter execução por ID
router.get('/:id', async (req, res) => {
    try {
        const id = parseInt(String(req.params.id ?? ''), 10);
        if (isNaN(id)) {
            res.status(400).json({ detail: 'ID inválido' });
            return;
        }
        const exec = await repo.obterPorId(id);
        if (!exec) {
            res.status(404).json({ detail: 'Execução não encontrada' });
            return;
        }
        res.json(toResponse(exec));
    }
    catch (error) {
        logger.error({ err: error }, 'Erro ao obter execução');
        res.status(500).json({ detail: 'Erro ao obter execução' });
    }
});
// POST / - Criar execução (início - orquestração real na Fase 4)
router.post('/', async (req, res) => {
    try {
        const empresaId = parseInt(req.body.empresa_id ?? req.body.empresaId, 10);
        if (isNaN(empresaId)) {
            res.status(400).json({ detail: 'empresa_id é obrigatório' });
            return;
        }
        const exec = await repo.criar({
            empresaId,
            cnpj: req.body.cnpj,
            periodoInicio: req.body.periodo_inicio ?? req.body.periodoInicio,
            periodoFim: req.body.periodo_fim ?? req.body.periodoFim,
            tipo: req.body.tipo ?? 'ambas',
        });
        res.status(201).json(toResponse(exec));
    }
    catch (error) {
        logger.error({ err: error }, 'Erro ao criar execução');
        res.status(500).json({ detail: 'Erro ao criar execução' });
    }
});
exports.default = router;
//# sourceMappingURL=execucoes.js.map