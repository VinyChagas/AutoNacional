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
 * Router de certificados (metadados e operações com arquivo PFX).
 * Usa middleware de upload centralizado (multer).
 */
const express_1 = require("express");
const logger_1 = require("../infrastructure/logger");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const repo = __importStar(require("../repositories/certificados"));
const empresasRepo = __importStar(require("../repositories/empresas"));
const certificado_utils_1 = require("../utils/certificado-utils");
const config_1 = require("../infrastructure/config");
const upload_1 = require("../middleware/upload");
const logger = (0, logger_1.getLogger)('certificados');
const router = (0, express_1.Router)();
function limparCnpj(cnpj) {
    return cnpj.replace(/[.\/\-\s]/g, '').trim();
}
// POST /extrair - Extrair informações do certificado (sem salvar) - ANTES das rotas paramétricas
router.post('/extrair', (0, upload_1.uploadSingle)('certificado'), async (req, res) => {
    try {
        const file = req.file;
        const senha = (req.body?.senha ?? '').trim();
        if (!file) {
            res.status(400).json({ success: false, message: 'Arquivo do certificado não enviado' });
            return;
        }
        if (!file.originalname?.toLowerCase().match(/\.(pfx|p12)$/)) {
            res.status(400).json({
                success: false,
                message: `Arquivo deve ser .pfx ou .p12. Recebido: ${file.originalname || 'sem nome'}`,
            });
            return;
        }
        if (!senha) {
            res.status(400).json({ success: false, message: 'Senha não pode estar vazia' });
            return;
        }
        if (!file.buffer?.length) {
            res.status(400).json({ success: false, message: 'Arquivo vazio ou não foi possível ler' });
            return;
        }
        const info = (0, certificado_utils_1.extrairInformacoesCertificado)(file.buffer, senha);
        if (!info.cnpj_limpo) {
            res.status(400).json({
                success: false,
                message: 'Não foi possível extrair o CNPJ do certificado. Verifique se é um certificado ICP-Brasil válido.',
            });
            return;
        }
        res.json({
            success: true,
            empresa: info.empresa ?? undefined,
            cnpj: info.cnpj ?? info.cnpj_limpo,
            dataVencimento: info.dataVencimento ?? undefined,
        });
    }
    catch (e) {
        const msg = e.message || '';
        logger.error({ err: e }, 'Erro ao extrair certificado');
        res.status(400).json({ success: false, message: msg });
    }
});
// POST /validar-lote - Validar múltiplos certificados (extrair info de cada)
router.post('/validar-lote', (0, upload_1.uploadArray)('certificados', 50), async (req, res) => {
    try {
        const files = req.files || [];
        const senha = (req.body?.senha ?? '').trim();
        const resultados = [];
        for (const file of files) {
            try {
                if (!file.buffer?.length || !file.originalname?.toLowerCase().match(/\.(pfx|p12)$/)) {
                    resultados.push({ nome_arquivo: file.originalname || 'sem nome', sucesso: false, mensagem_erro: 'Arquivo inválido' });
                    continue;
                }
                const info = (0, certificado_utils_1.extrairInformacoesCertificado)(file.buffer, senha);
                resultados.push({
                    nome_arquivo: file.originalname || 'sem nome',
                    sucesso: !!info.cnpj_limpo,
                    cnpj: info.cnpj ?? undefined,
                    empresa: info.empresa ?? undefined,
                    data_vencimento: info.dataVencimento ?? undefined,
                });
            }
            catch (e) {
                resultados.push({
                    nome_arquivo: file.originalname || 'sem nome',
                    sucesso: false,
                    mensagem_erro: e.message,
                });
            }
        }
        res.json({
            total: resultados.length,
            sucesso: resultados.filter((r) => r.sucesso).length,
            falha: resultados.filter((r) => !r.sucesso).length,
            resultados,
        });
    }
    catch (e) {
        logger.error({ err: e }, 'Erro ao validar lote');
        res.status(500).json({ detail: e.message });
    }
});
// POST /importar - Importar certificado e salvar (arquivo + metadado no banco)
router.post('/importar', (0, upload_1.uploadSingle)('certificado'), async (req, res) => {
    try {
        const file = req.file;
        const senha = (req.body?.senha ?? '').trim();
        const contabilidadeId = parseInt(String(req.body?.contabilidade_id ?? 0), 10);
        if (!file?.buffer?.length || !senha) {
            res.status(400).json({ success: false, message: 'Arquivo e senha obrigatórios' });
            return;
        }
        const info = (0, certificado_utils_1.extrairInformacoesCertificado)(file.buffer, senha);
        if (!info.cnpj_limpo) {
            res.status(400).json({ success: false, message: 'Não foi possível extrair CNPJ do certificado' });
            return;
        }
        const cnpjLimpo = info.cnpj_limpo;
        const existente = await repo.obterPorCnpj(cnpjLimpo);
        if (existente) {
            res.status(400).json({ success: false, message: `Certificado para CNPJ ${cnpjLimpo} já existe` });
            return;
        }
        const dir = config_1.CERTIFICATES_DIR;
        if (!fs.existsSync(dir))
            fs.mkdirSync(dir, { recursive: true });
        const nomeArquivo = `${cnpjLimpo}.pfx`;
        const caminho = path.join(dir, nomeArquivo);
        fs.writeFileSync(caminho, file.buffer);
        await repo.criar({
            cnpj: cnpjLimpo,
            arquivo: nomeArquivo,
            dataValidade: info.dataVencimento ?? undefined,
            contabilidadeId: contabilidadeId > 0 ? contabilidadeId : undefined,
        });
        res.json({
            success: true,
            empresa: info.empresa ?? undefined,
            cnpj: info.cnpj ?? cnpjLimpo,
            dataVencimento: info.dataVencimento ?? undefined,
        });
    }
    catch (e) {
        logger.error({ err: e }, 'Erro ao importar certificado');
        res.status(500).json({ success: false, message: e.message });
    }
});
// POST /importar-lote - Importar múltiplos certificados
router.post('/importar-lote', (0, upload_1.uploadArray)('certificados', 50), async (req, res) => {
    try {
        const files = req.files || [];
        const senha = (req.body?.senha ?? '').trim();
        const contabilidadeId = parseInt(String(req.body?.contabilidade_id ?? 0), 10);
        const resultados = [];
        const dir = config_1.CERTIFICATES_DIR;
        if (!fs.existsSync(dir))
            fs.mkdirSync(dir, { recursive: true });
        for (const file of files) {
            try {
                if (!file.buffer?.length || !file.originalname?.toLowerCase().match(/\.(pfx|p12)$/)) {
                    resultados.push({ nome_arquivo: file.originalname || 'sem nome', sucesso: false, mensagem_erro: 'Arquivo inválido' });
                    continue;
                }
                const info = (0, certificado_utils_1.extrairInformacoesCertificado)(file.buffer, senha);
                if (!info.cnpj_limpo) {
                    resultados.push({ nome_arquivo: file.originalname || 'sem nome', sucesso: false, mensagem_erro: 'CNPJ não encontrado no certificado' });
                    continue;
                }
                const existente = await repo.obterPorCnpj(info.cnpj_limpo);
                if (existente) {
                    resultados.push({ nome_arquivo: file.originalname || 'sem nome', sucesso: false, cnpj: info.cnpj ?? undefined, mensagem_erro: 'Certificado já cadastrado' });
                    continue;
                }
                const nomeArquivo = `${info.cnpj_limpo}.pfx`;
                fs.writeFileSync(path.join(dir, nomeArquivo), file.buffer);
                await repo.criar({
                    cnpj: info.cnpj_limpo,
                    arquivo: nomeArquivo,
                    dataValidade: info.dataVencimento ?? undefined,
                    contabilidadeId: contabilidadeId > 0 ? contabilidadeId : undefined,
                });
                resultados.push({
                    nome_arquivo: file.originalname || 'sem nome',
                    sucesso: true,
                    cnpj: info.cnpj ?? undefined,
                    empresa: info.empresa ?? undefined,
                    data_vencimento: info.dataVencimento ?? undefined,
                });
            }
            catch (e) {
                resultados.push({ nome_arquivo: file.originalname || 'sem nome', sucesso: false, mensagem_erro: e.message });
            }
        }
        res.json({
            total: resultados.length,
            sucesso: resultados.filter((r) => r.sucesso).length,
            falha: resultados.filter((r) => !r.sucesso).length,
            resultados,
        });
    }
    catch (e) {
        logger.error({ err: e }, 'Erro ao importar lote');
        res.status(500).json({ detail: e.message });
    }
});
// GET /contabilidade/:contabilidade_id - Listar por contabilidade
router.get('/contabilidade/:contabilidade_id', async (req, res) => {
    try {
        const id = parseInt(String(req.params.contabilidade_id ?? ''), 10);
        if (isNaN(id) || id < 1) {
            res.status(400).json({ detail: 'ID de contabilidade inválido' });
            return;
        }
        const certs = await repo.listarCertificados();
        const filtrados = certs.filter((c) => c.contabilidadeId === id || c.contabilidadeId == null);
        const empresasPorCnpj = new Map();
        for (const c of filtrados) {
            const cn = c.cnpj.replace(/[.\/\-\s]/g, '');
            if (!empresasPorCnpj.has(cn)) {
                const emp = await empresasRepo.obterEmpresaPorCnpj(c.cnpj);
                empresasPorCnpj.set(cn, emp?.razaoSocial ?? c.cnpj);
            }
        }
        res.json({
            certificados: filtrados.map((c) => {
                const cn = c.cnpj.replace(/[.\/\-\s]/g, '');
                return {
                    id: c.id,
                    cnpj: c.cnpj,
                    empresa: empresasPorCnpj.get(cn) ?? c.cnpj,
                    data_vencimento: c.dataValidade ?? undefined,
                    contabilidade_id: c.contabilidadeId ?? undefined,
                };
            }),
            total: filtrados.length,
        });
    }
    catch (e) {
        logger.error({ err: e }, 'Erro ao listar certificados por contabilidade');
        res.status(500).json({ detail: e.message });
    }
});
// GET / - Listar certificados
router.get('/', async (_req, res) => {
    try {
        const certs = await repo.listarCertificados();
        res.json(certs.map((c) => ({
            id: c.id,
            cnpj: c.cnpj,
            arquivo: c.arquivo,
            data_validade: c.dataValidade,
            empresa_id: c.empresaId,
            contabilidade_id: c.contabilidadeId,
            data_cadastro: c.dataCadastro.toISOString(),
        })));
    }
    catch (error) {
        logger.error({ err: error }, 'Erro ao listar certificados');
        res.status(500).json({ detail: 'Erro ao listar certificados' });
    }
});
// DELETE /cnpj/:cnpj - Deletar TODOS os certificados do CNPJ + Storage
router.delete('/cnpj/:cnpj', async (req, res) => {
    try {
        const cnpj = limparCnpj(String(req.params.cnpj ?? ''));
        const result = await repo.removerTodosPorCnpj(cnpj);
        if (!result) {
            res.status(404).json({ detail: `Certificado com CNPJ ${cnpj} não encontrado` });
            return;
        }
        if (result.storage.failed.length > 0) {
            logger.warn({
                deletedCount: result.deletedCount,
                storageFailed: result.storage.failed.length,
            }, 'Certificados removidos do banco; falha parcial na limpeza do Storage');
            res.status(200).json({
                deleted: result.deletedCount,
                storage_cleanup_failed: result.storage.failed.length,
                warning: 'Registros removidos do banco, mas alguns arquivos do Storage não puderam ser excluídos',
            });
            return;
        }
        res.status(204).send();
    }
    catch (error) {
        logger.error({ err: error }, 'Erro ao deletar certificado por CNPJ');
        res.status(500).json({ detail: 'Erro ao deletar certificado' });
    }
});
// GET /cnpj/:cnpj - Obter por CNPJ
router.get('/cnpj/:cnpj', async (req, res) => {
    try {
        const cnpj = limparCnpj(String(req.params.cnpj ?? ''));
        const cert = await repo.obterPorCnpj(cnpj);
        if (!cert) {
            res.status(404).json({ detail: `Certificado com CNPJ ${cnpj} não encontrado` });
            return;
        }
        res.json({
            id: cert.id,
            cnpj: cert.cnpj,
            arquivo: cert.arquivo,
            data_validade: cert.dataValidade,
            empresa_id: cert.empresaId,
            contabilidade_id: cert.contabilidadeId,
            data_cadastro: cert.dataCadastro.toISOString(),
        });
    }
    catch (error) {
        logger.error({ err: error }, 'Erro ao obter certificado');
        res.status(500).json({ detail: 'Erro ao obter certificado' });
    }
});
// POST / - Criar metadado (sem arquivo ainda)
router.post('/', async (req, res) => {
    try {
        const cnpj = limparCnpj(req.body.cnpj ?? '');
        if (cnpj.length !== 14) {
            res.status(400).json({ detail: 'CNPJ inválido' });
            return;
        }
        const cert = await repo.criar({
            cnpj,
            arquivo: req.body.arquivo,
            dataValidade: req.body.data_validade ?? req.body.dataValidade,
            empresaId: req.body.empresa_id ?? req.body.empresaId,
            contabilidadeId: req.body.contabilidade_id ?? req.body.contabilidadeId,
        });
        res.status(201).json({
            id: cert.id,
            cnpj: cert.cnpj,
            arquivo: cert.arquivo,
            data_validade: cert.dataValidade,
            data_cadastro: cert.dataCadastro.toISOString(),
        });
    }
    catch (error) {
        logger.error({ err: error }, 'Erro ao criar certificado');
        res.status(500).json({ detail: 'Erro ao criar certificado' });
    }
});
// PUT /:id - Atualizar metadado
router.put('/:id', async (req, res) => {
    try {
        const id = parseInt(String(req.params.id ?? ''), 10);
        if (isNaN(id)) {
            res.status(400).json({ detail: 'ID inválido' });
            return;
        }
        const data = {};
        if (req.body.arquivo != null)
            data.arquivo = req.body.arquivo;
        if (req.body.data_validade != null)
            data.dataValidade = req.body.data_validade;
        if (req.body.dataValidade != null)
            data.dataValidade = req.body.dataValidade;
        if (req.body.contabilidade_id != null)
            data.contabilidadeId = req.body.contabilidade_id;
        const cert = await repo.atualizar(id, data);
        if (!cert) {
            res.status(404).json({ detail: 'Certificado não encontrado' });
            return;
        }
        res.json({
            id: cert.id,
            cnpj: cert.cnpj,
            arquivo: cert.arquivo,
            data_validade: cert.dataValidade,
            data_cadastro: cert.dataCadastro.toISOString(),
        });
    }
    catch (error) {
        logger.error({ err: error }, 'Erro ao atualizar certificado');
        res.status(500).json({ detail: 'Erro ao atualizar certificado' });
    }
});
// DELETE /:id
router.delete('/:id', async (req, res) => {
    try {
        const id = parseInt(String(req.params.id ?? ''), 10);
        if (isNaN(id)) {
            res.status(400).json({ detail: 'ID inválido' });
            return;
        }
        const ok = await repo.deletar(id);
        if (!ok) {
            res.status(404).json({ detail: 'Certificado não encontrado' });
            return;
        }
        res.status(204).send();
    }
    catch (error) {
        logger.error({ err: error }, 'Erro ao deletar certificado');
        res.status(500).json({ detail: 'Erro ao deletar certificado' });
    }
});
exports.default = router;
//# sourceMappingURL=certificados.js.map