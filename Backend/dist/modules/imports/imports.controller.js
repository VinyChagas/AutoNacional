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
exports.previewCertificados = previewCertificados;
exports.confirmarCertificados = confirmarCertificados;
exports.previewCredenciais = previewCredenciais;
exports.confirmarCredenciais = confirmarCredenciais;
const response_1 = require("../../middleware/response");
const certService = __importStar(require("./import-certificados.service"));
const credService = __importStar(require("./import-credenciais.service"));
// --- Certificados em lote ---
async function previewCertificados(req, res) {
    const files = (req.files ?? []);
    const senha = (req.body?.senha ?? '').trim();
    if (!senha) {
        (0, response_1.jsonError)(res, 'Campo "senha" é obrigatório', 400);
        return;
    }
    if (!files?.length) {
        (0, response_1.jsonError)(res, 'Envie um ou mais arquivos .pfx ou .p12 no campo "files"', 400);
        return;
    }
    try {
        const result = await certService.previewCertificados(files, senha);
        (0, response_1.jsonSuccess)(res, result);
    }
    catch (e) {
        (0, response_1.jsonError)(res, e.message, 400);
    }
}
async function confirmarCertificados(req, res) {
    const body = req.body;
    const session_id = typeof body.session_id === 'string' ? body.session_id.trim() : '';
    const senha = typeof body.senha === 'string' ? body.senha.trim() : '';
    const itensRaw = Array.isArray(body.itens) ? body.itens : [];
    const contabilidade_id = body.contabilidade_id != null && body.contabilidade_id !== ''
        ? parseInt(String(body.contabilidade_id), 10)
        : undefined;
    if (!session_id) {
        (0, response_1.jsonError)(res, 'session_id é obrigatório', 400);
        return;
    }
    if (!senha) {
        (0, response_1.jsonError)(res, 'senha é obrigatória no confirmar', 400);
        return;
    }
    const itens = itensRaw
        .filter((x) => x != null && typeof x === 'object' && 'indice' in x)
        .map((x) => ({ indice: Number(x.indice) }))
        .filter((x) => !isNaN(x.indice));
    if (itens.length === 0) {
        (0, response_1.jsonError)(res, 'Envie ao menos um item em itens com { indice }', 400);
        return;
    }
    try {
        const result = await certService.confirmarCertificados({
            session_id,
            senha,
            itens,
            contabilidade_id: contabilidade_id != null && !isNaN(contabilidade_id) && contabilidade_id > 0
                ? contabilidade_id
                : undefined,
        });
        (0, response_1.jsonCreated)(res, result, 'Importação de certificados concluída');
    }
    catch (e) {
        const msg = e.message;
        if (msg.includes('expirada') || msg.includes('inválida')) {
            (0, response_1.jsonError)(res, msg, 400);
            return;
        }
        throw e;
    }
}
// --- Credenciais via planilha ---
async function previewCredenciais(req, res) {
    const file = req.file;
    if (!file?.buffer?.length) {
        (0, response_1.jsonError)(res, 'Envie um arquivo .xlsx ou .csv no campo "arquivo"', 400);
        return;
    }
    const ext = (file.originalname || '').toLowerCase();
    if (!ext.endsWith('.xlsx') &&
        !ext.endsWith('.xls') &&
        !ext.endsWith('.csv')) {
        (0, response_1.jsonError)(res, 'Arquivo deve ser .xlsx, .xls ou .csv', 400);
        return;
    }
    try {
        const result = await credService.previewCredenciais(file.buffer);
        (0, response_1.jsonSuccess)(res, result);
    }
    catch (e) {
        (0, response_1.jsonError)(res, e.message, 400);
    }
}
async function confirmarCredenciais(req, res) {
    const body = req.body;
    const session_id = typeof body.session_id === 'string' ? body.session_id.trim() : '';
    const linhasRaw = Array.isArray(body.linhas_aprovadas)
        ? body.linhas_aprovadas
        : [];
    const linhas_aprovadas = linhasRaw
        .map((x) => (typeof x === 'number' ? x : parseInt(String(x), 10)))
        .filter((n) => !isNaN(n) && n > 0);
    if (!session_id) {
        (0, response_1.jsonError)(res, 'session_id é obrigatório', 400);
        return;
    }
    if (linhas_aprovadas.length === 0) {
        (0, response_1.jsonError)(res, 'Envie ao menos uma linha em linhas_aprovadas', 400);
        return;
    }
    try {
        const result = await credService.confirmarCredenciais({
            session_id,
            linhas_aprovadas,
        });
        (0, response_1.jsonCreated)(res, result, 'Importação de credenciais concluída');
    }
    catch (e) {
        (0, response_1.jsonError)(res, e.message, 400);
    }
}
//# sourceMappingURL=imports.controller.js.map