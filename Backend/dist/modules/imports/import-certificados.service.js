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
/**
 * Serviço de importação em lote de certificados (Preview + Confirmar).
 */
const client_1 = require("../../db/client");
const supabase_1 = require("../../config/supabase");
const env_1 = require("../../config/env");
const certificado_parser_1 = require("../../utils/certificado.parser");
const crypto_1 = require("../../infrastructure/crypto");
const certRepo = __importStar(require("../../repositories/certificados"));
const import_session_store_1 = require("./import-session.store");
function normCnpj(cnpj) {
    return cnpj.replace(/[.\/\-\s]/g, '').trim();
}
function gerarStoragePath(cnpj, contabilidadeId) {
    const cn = normCnpj(cnpj);
    const ts = Date.now();
    if (contabilidadeId != null && contabilidadeId > 0) {
        return `contabilidade/${contabilidadeId}/empresa/${cn}/certs/${ts}.pfx`;
    }
    return `empresa/${cn}/certs/${ts}.pfx`;
}
async function previewCertificados(files, senha) {
    if (!senha?.trim()) {
        throw new Error('Senha é obrigatória');
    }
    const validFiles = files?.filter((f) => f?.buffer?.length) ?? [];
    if (validFiles.length === 0) {
        throw new Error('Nenhum arquivo .pfx ou .p12 enviado');
    }
    const sessionId = (0, import_session_store_1.createSession)(validFiles);
    const items = [];
    for (let i = 0; i < validFiles.length; i++) {
        try {
            const parsed = (0, certificado_parser_1.parseCertificado)(validFiles[i].buffer, senha);
            const cnpjLimpo = normCnpj(parsed.cnpj);
            const existeEmpresa = !!(await client_1.prisma.empresa.findUnique({
                where: { cnpj: cnpjLimpo },
            }));
            items.push({
                indice: i,
                cnpj: parsed.cnpj,
                razao_social: parsed.razao_social,
                data_validade: parsed.data_validade,
                existe_empresa: existeEmpresa,
                acao: 'IMPORTAR',
            });
        }
        catch (e) {
            items.push({
                indice: i,
                cnpj: '',
                razao_social: '',
                data_validade: null,
                existe_empresa: false,
                acao: 'ERRO',
                erro: e.message,
            });
        }
    }
    return { session_id: sessionId, items };
}
async function confirmarCertificados(input) {
    const { session_id, senha, itens, contabilidade_id } = input;
    if (!senha?.trim()) {
        throw new Error('Senha é obrigatória no confirmar');
    }
    const indices = new Set(itens.map((x) => x.indice));
    let files;
    try {
        files = (0, import_session_store_1.getSessionFiles)(session_id);
    }
    catch (e) {
        throw new Error(e.message);
    }
    const supabase = (0, supabase_1.getSupabaseClient)();
    const bucket = env_1.env.CERT_STORAGE_BUCKET || 'certificados';
    const erros = [];
    let importados = 0;
    for (let i = 0; i < files.length; i++) {
        if (!indices.has(i))
            continue;
        try {
            const parsed = (0, certificado_parser_1.parseCertificado)(files[i].buffer, senha);
            const cnpjLimpo = normCnpj(parsed.cnpj);
            let empresa = await client_1.prisma.empresa.findUnique({ where: { cnpj: cnpjLimpo } });
            if (!empresa) {
                empresa = await client_1.prisma.empresa.create({
                    data: {
                        cnpj: cnpjLimpo,
                        razaoSocial: parsed.razao_social,
                        contabilidadeId: contabilidade_id ?? undefined,
                    },
                });
            }
            else if (contabilidade_id != null && contabilidade_id > 0) {
                await client_1.prisma.empresa.update({
                    where: { id: empresa.id },
                    data: { contabilidadeId: contabilidade_id },
                });
                empresa = await client_1.prisma.empresa.findUniqueOrThrow({ where: { id: empresa.id } });
            }
            const storagePath = gerarStoragePath(cnpjLimpo, contabilidade_id);
            const { error: uploadError } = await supabase.storage
                .from(bucket)
                .upload(storagePath, files[i].buffer, {
                upsert: true,
                contentType: 'application/x-pkcs12',
            });
            if (uploadError) {
                erros.push({ indice: i, mensagem: `Upload: ${uploadError.message}` });
                continue;
            }
            const senhaCriptografada = (0, crypto_1.encryptPassword)(senha);
            const existingCert = await certRepo.obterPorCnpj(cnpjLimpo);
            if (existingCert) {
                await client_1.prisma.certificado.update({
                    where: { id: existingCert.id },
                    data: {
                        arquivo: storagePath,
                        senhaCriptografada,
                        dataValidade: parsed.data_validade ?? undefined,
                        empresaId: String(empresa.id),
                        contabilidadeId: contabilidade_id ?? undefined,
                    },
                });
            }
            else {
                await client_1.prisma.certificado.create({
                    data: {
                        cnpj: cnpjLimpo,
                        arquivo: storagePath,
                        senhaCriptografada,
                        dataValidade: parsed.data_validade ?? undefined,
                        empresaId: String(empresa.id),
                        contabilidadeId: contabilidade_id ?? undefined,
                    },
                });
            }
            importados++;
        }
        catch (e) {
            erros.push({ indice: i, mensagem: e.message });
        }
    }
    (0, import_session_store_1.destroySession)(session_id);
    return { importados, erros };
}
//# sourceMappingURL=import-certificados.service.js.map