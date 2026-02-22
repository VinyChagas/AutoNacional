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
exports.listar = listar;
exports.obterPorId = obterPorId;
exports.listarPorContabilidade = listarPorContabilidade;
exports.obterPorCnpj = obterPorCnpj;
exports.cadastroCertificado = cadastroCertificado;
exports.excluirEmMassa = excluirEmMassa;
exports.cadastroCredencial = cadastroCredencial;
const service = __importStar(require("./empresas.service"));
const repo = __importStar(require("./empresas.repo"));
const repoLegacy = __importStar(require("../../../repositories/empresas"));
const cadastroCertificadoService = __importStar(require("./cadastro-certificado.service"));
const cadastroCredencialService = __importStar(require("./cadastro-credencial.service"));
const response_1 = require("../../../middleware/response");
const cnpj_1 = require("../../../utils/cnpj");
function toListagemItem(row) {
    return {
        id: String(row.id),
        cnpj: row.cnpj,
        razao_social: row.razao_social,
        regime: row.regime,
        contabilidade_id: row.contabilidade_id,
        contabilidade_nome: row.contabilidade_nome ?? null,
        ativo: row.ativo,
        created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
        updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
        has_certificado: Boolean(row.has_certificado),
        cert_validade: row.cert_validade ?? null,
        has_credenciais: Boolean(row.has_credenciais),
        cred_status: row.cred_status ?? null,
        cred_ultimo_teste_em: row.cred_ultimo_teste_em ?? null,
        cred_ultima_mensagem: row.cred_ultima_mensagem ?? null,
        status_geral: row.status_geral ?? null,
        status_geral_motivo: row.status_geral_motivo ?? null,
    };
}
async function listar(req, res) {
    const params = service.parseListarParams(req.query);
    const conflito = service.validarFiltrosConflitantes(params);
    if (conflito) {
        (0, response_1.jsonError)(res, conflito, 400);
        return;
    }
    const result = await service.listarEmpresas(params);
    (0, response_1.jsonSuccess)(res, {
        items: result.items.map(toListagemItem),
        total: result.total,
        page: result.page,
        limit: result.limit,
    });
}
async function obterPorId(req, res) {
    const id = parseInt(String(req.params.id ?? ''), 10);
    if (isNaN(id) || id < 1) {
        (0, response_1.jsonError)(res, 'ID de empresa inválido', 400);
        return;
    }
    const data = await service.obterEmpresaPorId(id);
    if (!data) {
        (0, response_1.jsonError)(res, `Empresa com ID ${id} não encontrada`, 404);
        return;
    }
    (0, response_1.jsonSuccess)(res, data);
}
async function listarPorContabilidade(req, res) {
    const contabilidadeId = parseInt(String(req.params.contabilidade_id ?? ''), 10);
    if (isNaN(contabilidadeId) || contabilidadeId < 1) {
        (0, response_1.jsonError)(res, 'ID de contabilidade inválido', 400);
        return;
    }
    const params = service.parseListarParams({ ...req.query, contabilidade_id: String(contabilidadeId) });
    const result = await service.listarEmpresas(params);
    (0, response_1.jsonSuccess)(res, {
        items: result.items.map(toListagemItem),
        total: result.total,
        page: result.page,
        limit: result.limit,
    });
}
async function obterPorCnpj(req, res) {
    const cnpj = (0, cnpj_1.normalizeCnpj)(String(req.params.cnpj ?? ''));
    const empresa = await repoLegacy.obterEmpresaPorCnpj(cnpj);
    if (!empresa) {
        (0, response_1.jsonError)(res, `Empresa com CNPJ ${cnpj} não encontrada`, 404);
        return;
    }
    const data = await service.obterEmpresaPorId(empresa.id);
    (0, response_1.jsonSuccess)(res, data);
}
async function cadastroCertificado(req, res) {
    const file = req.file;
    const senha = (req.body?.senha ?? '').trim();
    const contabilidadeIdRaw = req.body?.contabilidade_id;
    const contabilidadeId = contabilidadeIdRaw != null && contabilidadeIdRaw !== ''
        ? parseInt(String(contabilidadeIdRaw), 10)
        : undefined;
    if (!file?.buffer?.length) {
        (0, response_1.jsonError)(res, 'Arquivo do certificado (.pfx ou .p12) é obrigatório', 400);
        return;
    }
    if (!senha) {
        (0, response_1.jsonError)(res, 'Senha do certificado é obrigatória', 400);
        return;
    }
    if (contabilidadeId == null || isNaN(contabilidadeId) || contabilidadeId < 1) {
        (0, response_1.jsonError)(res, 'contabilidade_id é obrigatório e deve ser um número positivo', 400);
        return;
    }
    const ext = (file.originalname || '').toLowerCase();
    if (!ext.endsWith('.pfx') && !ext.endsWith('.p12')) {
        (0, response_1.jsonError)(res, 'Arquivo deve ser .pfx ou .p12', 400);
        return;
    }
    try {
        const result = await cadastroCertificadoService.cadastrarPorCertificado({
            buffer: file.buffer,
            senha,
            contabilidade_id: contabilidadeId,
        });
        (0, response_1.jsonCreated)(res, result, 'Certificado cadastrado com sucesso');
    }
    catch (err) {
        const msg = err.message;
        if (msg.includes('Senha') || msg.includes('password') || msg.includes('decrypt')) {
            (0, response_1.jsonError)(res, msg, 400);
            return;
        }
        if (msg.includes('CNPJ') || msg.includes('ICP-Brasil')) {
            (0, response_1.jsonError)(res, msg, 400);
            return;
        }
        throw err;
    }
}
async function excluirEmMassa(req, res) {
    const body = req.body;
    const rawIds = Array.isArray(body?.ids) ? body.ids : [];
    const ids = rawIds
        .map((x) => (typeof x === 'number' ? x : parseInt(String(x), 10)))
        .filter((n) => !isNaN(n) && n > 0);
    if (ids.length === 0) {
        (0, response_1.jsonError)(res, 'ids deve ser um array não vazio de IDs válidos', 400);
        return;
    }
    const deleted = await repo.deletarEmMassa(ids);
    (0, response_1.jsonSuccess)(res, { deleted });
}
async function cadastroCredencial(req, res) {
    const body = req.body;
    const cnpj = typeof body.cnpj === 'string' ? body.cnpj.trim() : '';
    const razao_social = typeof body.razao_social === 'string' ? body.razao_social : undefined;
    const senha = typeof body.senha === 'string' ? body.senha : '';
    let tipo = typeof body.tipo === 'string' && (body.tipo === 'CNPJ_SENHA' || body.tipo === 'CPF_SENHA')
        ? body.tipo
        : 'CNPJ_SENHA';
    const docDigitos = cnpj.replace(/\D/g, '').length;
    if (docDigitos === 11 && tipo === 'CNPJ_SENHA') {
        tipo = 'CPF_SENHA';
    }
    const usuario = typeof body.usuario === 'string' ? body.usuario : undefined;
    const contabilidade_idRaw = body.contabilidade_id;
    if (!cnpj) {
        (0, response_1.jsonError)(res, 'cnpj é obrigatório', 400);
        return;
    }
    if (!senha) {
        (0, response_1.jsonError)(res, 'senha é obrigatória', 400);
        return;
    }
    const contabilidade_id = contabilidade_idRaw != null && contabilidade_idRaw !== ''
        ? parseInt(String(contabilidade_idRaw), 10)
        : undefined;
    if (contabilidade_id != null && (isNaN(contabilidade_id) || contabilidade_id < 0)) {
        (0, response_1.jsonError)(res, 'contabilidade_id deve ser um número positivo', 400);
        return;
    }
    try {
        const result = await cadastroCredencialService.cadastrarPorCredencial({
            cnpj,
            razao_social,
            senha,
            tipo,
            usuario,
            contabilidade_id: contabilidade_id ?? null,
        });
        (0, response_1.jsonCreated)(res, result, 'Credencial cadastrada com sucesso');
    }
    catch (err) {
        const msg = err.message;
        if (msg.includes('CNPJ') ||
            msg.includes('CPF') ||
            msg.includes('obrigatório') ||
            msg.includes('razao_social') ||
            msg.includes('14 dígitos') ||
            msg.includes('11 dígitos')) {
            (0, response_1.jsonError)(res, msg, 400);
            return;
        }
        throw err;
    }
}
//# sourceMappingURL=empresas.controller.js.map