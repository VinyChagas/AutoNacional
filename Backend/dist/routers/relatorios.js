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
 * Router de relatórios de execuções.
 * Rotas de relatórios.
 */
const express_1 = require("express");
const logger_1 = require("../infrastructure/logger");
const client_1 = require("../db/client");
const empresasRepo = __importStar(require("../repositories/empresas"));
const logger = (0, logger_1.getLogger)('relatorios');
const router = (0, express_1.Router)();
// GET /execucoes/resumo - Resumo das execuções
router.get('/execucoes/resumo', async (req, res) => {
    try {
        const competencia = req.query.competencia || null;
        const statusFiltro = req.query.status_filtro || 'concluido';
        const where = {
            status: statusFiltro,
        };
        if (competencia && competencia.length === 6 && /^\d+$/.test(competencia)) {
            const mes = competencia.slice(0, 2);
            const ano = competencia.slice(2, 6);
            where.periodoInicio = { contains: `/${mes}/${ano}` };
        }
        const execucoes = await client_1.prisma.execucao.findMany({
            where,
            orderBy: { createdAt: 'desc' },
        });
        const empresasComMovimento = [];
        const empresasSemMovimento = [];
        for (const exec of execucoes) {
            const qtdEmitidas = exec.qtdNotasEmitidas ?? 0;
            const qtdRecebidas = exec.qtdNotasRecebidas ?? 0;
            let nomeEmpresa = null;
            if (exec.empresaId) {
                try {
                    const empresa = await empresasRepo.obterEmpresaPorId(exec.empresaId);
                    nomeEmpresa = empresa?.razaoSocial ?? null;
                }
                catch {
                    /* ignore */
                }
            }
            const resumo = {
                cnpj: exec.cnpj ?? String(exec.empresaId),
                nome: nomeEmpresa,
                qtd_notas_emitidas: qtdEmitidas,
                qtd_notas_recebidas: qtdRecebidas,
            };
            if (qtdEmitidas > 0 || qtdRecebidas > 0) {
                empresasComMovimento.push(resumo);
            }
            else {
                empresasSemMovimento.push(resumo);
            }
        }
        const resultado = {
            competencia: competencia ?? null,
            total_empresas: execucoes.length,
            com_movimento: empresasComMovimento.length,
            sem_movimento: empresasSemMovimento.length,
            empresas_com_movimento: empresasComMovimento,
            empresas_sem_movimento: empresasSemMovimento,
        };
        res.json(resultado);
    }
    catch (error) {
        logger.error({ err: error }, 'Erro ao gerar resumo de execuções');
        res.status(500).json({ detail: 'Erro ao gerar resumo de execuções' });
    }
});
// GET /execucoes/resumo/csv - Download CSV do resumo
router.get('/execucoes/resumo/csv', async (req, res) => {
    try {
        const competencia = req.query.competencia || null;
        const statusFiltro = req.query.status_filtro || 'concluido';
        const where = {
            status: statusFiltro,
        };
        if (competencia && competencia.length === 6 && /^\d+$/.test(competencia)) {
            const mes = competencia.slice(0, 2);
            const ano = competencia.slice(2, 6);
            where.periodoInicio = { contains: `/${mes}/${ano}` };
        }
        const execucoes = await client_1.prisma.execucao.findMany({
            where,
            orderBy: { createdAt: 'desc' },
        });
        const empresasComMovimento = [];
        const empresasSemMovimento = [];
        for (const exec of execucoes) {
            const qtdEmitidas = exec.qtdNotasEmitidas ?? 0;
            const qtdRecebidas = exec.qtdNotasRecebidas ?? 0;
            let nomeEmpresa = null;
            if (exec.empresaId) {
                try {
                    const empresa = await empresasRepo.obterEmpresaPorId(exec.empresaId);
                    nomeEmpresa = empresa?.razaoSocial ?? null;
                }
                catch {
                    /* ignore */
                }
            }
            const resumo = {
                cnpj: exec.cnpj ?? String(exec.empresaId),
                nome: nomeEmpresa,
                qtd_notas_emitidas: qtdEmitidas,
                qtd_notas_recebidas: qtdRecebidas,
            };
            if (qtdEmitidas > 0 || qtdRecebidas > 0) {
                empresasComMovimento.push(resumo);
            }
            else {
                empresasSemMovimento.push(resumo);
            }
        }
        const linhas = [];
        const enc = (v) => `"${String(v).replace(/"/g, '""')}"`;
        linhas.push(['CNPJ', 'Nome', 'Total Notas Emitidas', 'Total Notas Recebidas', 'Total Notas', 'Status'].map(enc).join(','));
        for (const emp of empresasComMovimento) {
            const total = emp.qtd_notas_emitidas + emp.qtd_notas_recebidas;
            linhas.push([emp.cnpj, emp.nome ?? '', emp.qtd_notas_emitidas, emp.qtd_notas_recebidas, total, 'Com movimento'].map(enc).join(','));
        }
        for (const emp of empresasSemMovimento) {
            linhas.push([emp.cnpj, emp.nome ?? '', emp.qtd_notas_emitidas, emp.qtd_notas_recebidas, 0, 'Sem movimento'].map(enc).join(','));
        }
        const csv = linhas.join('\n');
        const filename = `resumo_execucoes_${competencia ?? 'todas'}_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.csv`;
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csv);
    }
    catch (error) {
        logger.error({ err: error }, 'Erro ao gerar CSV de resumo');
        res.status(500).json({ detail: 'Erro ao gerar CSV de resumo' });
    }
});
exports.default = router;
//# sourceMappingURL=relatorios.js.map