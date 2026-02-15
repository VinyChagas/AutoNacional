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
 * Router de execução orquestrada (playwright + processar_notas).
 * Rotas de execução de automação.
 */
const express_1 = require("express");
const logger_1 = require("../infrastructure/logger");
const empresasRepo = __importStar(require("../repositories/empresas"));
const certificadosRepo = __importStar(require("../repositories/certificados"));
const execution_service_1 = require("../services/execution-service");
const logger = (0, logger_1.getLogger)('execucao');
const router = (0, express_1.Router)({ mergeParams: true });
function limparCnpj(v) {
    return v.replace(/[.\/\-\s]/g, '').trim();
}
const DATA_REGEX = /^\d{2}\/\d{2}\/\d{4}$/;
// POST /api/execucao/multiplas - DEVE vir antes de /:empresa_id
router.post('/multiplas', async (req, res) => {
    try {
        const body = req.body;
        const empresas = body.empresas || [];
        const dataInicio = body.dataInicio;
        const dataFim = body.dataFim;
        const tipo = body.tipo || 'ambas';
        const headless = body.headless ?? false;
        if (empresas.length === 0) {
            res.status(400).json({ detail: 'Lista de empresas não pode estar vazia' });
            return;
        }
        if (!dataInicio || !dataFim || !DATA_REGEX.test(dataInicio) || !DATA_REGEX.test(dataFim)) {
            res.status(400).json({
                detail: 'dataInicio e dataFim obrigatórios no formato DD/MM/YYYY',
            });
            return;
        }
        const resultados = [];
        const erros = [];
        for (const emp of empresas) {
            const cnpjLimpo = limparCnpj(emp.cnpj);
            if (cnpjLimpo.length !== 14) {
                erros.push({ empresa_id: emp.empresa_id, cnpj: emp.cnpj, erro: 'CNPJ inválido' });
                continue;
            }
            try {
                // empresa_id pode vir como ID numérico ou CNPJ (14 dígitos)
                const empresaIdRaw = emp.empresa_id;
                const parsed = parseInt(empresaIdRaw, 10);
                const isCnpjFormat = empresaIdRaw && String(empresaIdRaw).replace(/\D/g, '').length === 14;
                let empresaId;
                if (isCnpjFormat || isNaN(parsed) || parsed > 2147483647) {
                    let empresaByCnpj = await empresasRepo.obterEmpresaPorCnpj(cnpjLimpo);
                    if (!empresaByCnpj) {
                        const cert = await certificadosRepo.obterPorCnpj(cnpjLimpo);
                        if (cert) {
                            empresaByCnpj = await empresasRepo.criarEmpresa({
                                cnpj: cnpjLimpo,
                                razaoSocial: `Empresa ${cnpjLimpo}`,
                                contabilidadeId: cert.contabilidadeId ?? undefined,
                            });
                        }
                    }
                    empresaId = empresaByCnpj?.id ?? 0;
                    if (empresaId === 0) {
                        erros.push({
                            empresa_id: emp.empresa_id,
                            cnpj: emp.cnpj,
                            erro: 'Empresa não encontrada. Cadastre a empresa ou importe o certificado primeiro.',
                        });
                        continue;
                    }
                }
                else {
                    empresaId = parsed;
                    const existe = await empresasRepo.obterEmpresaPorId(empresaId);
                    if (!existe) {
                        erros.push({
                            empresa_id: emp.empresa_id,
                            cnpj: emp.cnpj,
                            erro: 'Empresa não encontrada',
                        });
                        continue;
                    }
                }
                await (0, execution_service_1.adicionarExecucao)(empresaId, cnpjLimpo, dataInicio, dataFim, tipo, headless);
                const status = (0, execution_service_1.obterStatus)(String(empresaId));
                resultados.push({
                    empresa_id: String(empresaId),
                    cnpj: cnpjLimpo,
                    status: status?.status || 'pendente',
                    etapa_atual: status?.etapa_atual || 'inicio',
                    progresso: status?.progresso ?? 0,
                    logs: status?.logs || [],
                });
            }
            catch (e) {
                erros.push({
                    empresa_id: emp.empresa_id,
                    cnpj: emp.cnpj,
                    erro: e.message,
                });
            }
        }
        res.status(202).json({
            sucesso: resultados.length,
            erros: erros.length,
            execucoes: resultados,
            detalhes_erros: erros,
        });
    }
    catch (error) {
        logger.error({ err: error }, 'Erro ao adicionar múltiplas execuções');
        res.status(500).json({ detail: 'Erro ao adicionar múltiplas execuções' });
    }
});
// POST /api/execucao/:empresa_id - Iniciar execução
router.post('/:empresa_id', async (req, res) => {
    try {
        const empresaIdParam = String(req.params.empresa_id ?? '');
        const dataInicio = String(req.query.dataInicio || req.body?.dataInicio || '');
        const dataFim = String(req.query.dataFim || req.body?.dataFim || '');
        const tipo = String(req.query.tipo || req.body?.tipo || 'ambas');
        const headless = req.query.headless === 'true' || req.body?.headless === true;
        if (!dataInicio || !dataFim) {
            res.status(400).json({
                detail: 'dataInicio e dataFim são obrigatórios (formato DD/MM/YYYY)',
            });
            return;
        }
        if (!DATA_REGEX.test(dataInicio) || !DATA_REGEX.test(dataFim)) {
            res.status(400).json({
                detail: 'Datas devem estar no formato DD/MM/YYYY (ex: 01/12/2025)',
            });
            return;
        }
        let empresa = null;
        const idNum = parseInt(empresaIdParam, 10);
        if (!isNaN(idNum)) {
            empresa = await empresasRepo.obterEmpresaPorId(idNum);
        }
        if (!empresa) {
            const cnpjLimpo = limparCnpj(empresaIdParam);
            if (cnpjLimpo.length === 14 && /^\d+$/.test(cnpjLimpo)) {
                empresa = await empresasRepo.obterEmpresaPorCnpj(cnpjLimpo);
            }
        }
        if (!empresa) {
            res.status(404).json({
                detail: `Empresa com ID/CNPJ ${empresaIdParam} não encontrada`,
            });
            return;
        }
        const cnpj = empresa.cnpj || limparCnpj(empresaIdParam);
        if (!cnpj || cnpj.length !== 14) {
            res.status(400).json({ detail: 'Empresa não possui CNPJ cadastrado' });
            return;
        }
        const execucaoId = await (0, execution_service_1.adicionarExecucao)(empresa.id, cnpj, dataInicio, dataFim, tipo, headless);
        const status = (0, execution_service_1.obterStatus)(String(empresa.id));
        res.status(202).json({
            id: execucaoId,
            empresa_id: String(empresa.id),
            cnpj,
            status: status?.status || 'pendente',
            etapa_atual: status?.etapa_atual || 'inicio',
            progresso: status?.progresso ?? 0,
            logs: status?.logs || [],
            mensagem: status?.mensagem || 'Aguardando execução...',
        });
    }
    catch (error) {
        logger.error({ err: error }, 'Erro ao iniciar execução');
        res.status(500).json({ detail: 'Erro ao iniciar execução' });
    }
});
// GET /api/execucao/:empresa_id/status
router.get('/:empresa_id/status', async (req, res) => {
    try {
        const empresaId = String(req.params.empresa_id ?? '');
        let status = (0, execution_service_1.obterStatus)(empresaId);
        if (!status) {
            const cnpjLimpo = limparCnpj(empresaId);
            if (cnpjLimpo.length === 14) {
                const emp = await empresasRepo.obterEmpresaPorCnpj(cnpjLimpo);
                if (emp) {
                    status = (0, execution_service_1.obterStatus)(String(emp.id));
                    if (status) {
                        res.json({ ...status, empresa_id: String(emp.id), cnpj: emp.cnpj });
                        return;
                    }
                }
            }
            res.status(404).json({
                detail: `Execução para empresa/CNPJ ${empresaId} não encontrada`,
            });
            return;
        }
        res.json({ ...status, empresa_id: empresaId });
    }
    catch (error) {
        logger.error({ err: error }, 'Erro ao obter status');
        res.status(500).json({ detail: 'Erro ao obter status' });
    }
});
exports.default = router;
//# sourceMappingURL=execucao.js.map