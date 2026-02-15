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
exports.cadastrarPorCertificado = cadastrarPorCertificado;
/**
 * Serviço de cadastro de empresa via certificado digital.
 */
const client_1 = require("../../db/client");
const supabase_1 = require("../../config/supabase");
const env_1 = require("../../config/env");
const certificado_parser_1 = require("../../utils/certificado.parser");
const certRepo = __importStar(require("../../repositories/certificados"));
const logger_1 = require("../../infrastructure/logger");
const logger = (0, logger_1.getLogger)('cadastro-certificado');
function normCnpj(cnpj) {
    return cnpj.replace(/[.\/\-\s]/g, '').trim();
}
/**
 * Gera path padronizado no Storage.
 * contabilidade/{id}/empresa/{cnpj}/certs/{timestamp}.pfx ou empresa/{cnpj}/certs/{timestamp}.pfx
 */
function gerarStoragePath(cnpj, contabilidadeId) {
    const cn = normCnpj(cnpj);
    const ts = Date.now();
    if (contabilidadeId != null && contabilidadeId > 0) {
        return `contabilidade/${contabilidadeId}/empresa/${cn}/certs/${ts}.pfx`;
    }
    return `empresa/${cn}/certs/${ts}.pfx`;
}
async function cadastrarPorCertificado(input) {
    const { buffer, senha, contabilidade_id } = input;
    const parsed = (0, certificado_parser_1.parseCertificado)(buffer, senha);
    const cnpjLimpo = normCnpj(parsed.cnpj);
    let empresa = await client_1.prisma.empresa.findUnique({
        where: { cnpj: cnpjLimpo },
    });
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
        empresa = await client_1.prisma.empresa.findUniqueOrThrow({
            where: { id: empresa.id },
        });
    }
    const storagePath = gerarStoragePath(cnpjLimpo, contabilidade_id);
    const supabase = (0, supabase_1.getSupabaseClient)();
    const bucket = env_1.env.CERT_STORAGE_BUCKET || 'certificados';
    const { error: uploadError } = await supabase.storage
        .from(bucket)
        .upload(storagePath, buffer, {
        upsert: true,
        contentType: 'application/x-pkcs12',
    });
    if (uploadError) {
        logger.error({ err: uploadError }, 'Erro ao fazer upload do certificado');
        throw new Error(`Falha ao fazer upload no Storage: ${uploadError.message}`);
    }
    const existingCert = await certRepo.obterPorCnpj(cnpjLimpo);
    if (existingCert) {
        await client_1.prisma.certificado.update({
            where: { id: existingCert.id },
            data: {
                arquivo: storagePath,
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
                dataValidade: parsed.data_validade ?? undefined,
                empresaId: String(empresa.id),
                contabilidadeId: contabilidade_id ?? undefined,
            },
        });
    }
    const [creds] = await Promise.all([
        client_1.prisma.credencial.findMany({
            where: { empresaId: empresa.id },
            orderBy: [{ ultimoTesteEm: 'desc' }, { updatedAt: 'desc' }],
        }),
    ]);
    return {
        empresa: {
            id: empresa.id,
            cnpj: empresa.cnpj,
            razao_social: empresa.razaoSocial,
            regime: empresa.regime,
            contabilidade_id: empresa.contabilidadeId,
        },
        has_cert: true,
        has_cred: creds.length > 0,
        cert_validade: parsed.data_validade,
        cred_status: creds[0]?.status ?? null,
    };
}
//# sourceMappingURL=cadastro-certificado.service.js.map