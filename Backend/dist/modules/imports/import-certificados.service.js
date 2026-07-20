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
exports.resolveConfirmAction = resolveConfirmAction;
/**
 * Serviço de importação em lote de certificados (Preview + Confirmar).
 * Classifica NEW / UPDATE_AVAILABLE / EXACT_DUPLICATE / etc. e exige ação explícita.
 */
const client_1 = require("../../db/client");
const supabase_1 = require("../../config/supabase");
const env_1 = require("../../config/env");
const certificado_parser_1 = require("../../utils/certificado.parser");
const crypto_1 = require("../../infrastructure/crypto");
const certRepo = __importStar(require("../../repositories/certificados"));
const certificado_storage_service_1 = require("../../services/certificado-storage.service");
const logger_1 = require("../../infrastructure/logger");
const import_session_store_1 = require("./import-session.store");
const import_certificados_classify_1 = require("./import-certificados-classify");
const logger = (0, logger_1.getLogger)('import-certificados');
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
async function baixarArquivoCertificado(arquivo) {
    if (!arquivo?.trim())
        return null;
    try {
        const supabase = (0, supabase_1.getSupabaseClient)();
        const bucket = env_1.env.CERT_STORAGE_BUCKET || 'certificados';
        const { data, error } = await supabase.storage.from(bucket).download(arquivo.trim());
        if (error || !data) {
            logger.warn({ path: arquivo, err: error?.message }, 'Falha ao baixar certificado existente para comparação');
            return null;
        }
        const ab = await data.arrayBuffer();
        return Buffer.from(ab);
    }
    catch (err) {
        logger.warn({ err, path: arquivo }, 'Exceção ao baixar certificado existente');
        return null;
    }
}
async function identityDoCertificadoExistente(cert) {
    const base = {
        valid_until: cert.dataValidade,
        thumbprint: null,
        serial: null,
    };
    if (!cert.arquivo || !cert.senhaCriptografada)
        return base;
    const buf = await baixarArquivoCertificado(cert.arquivo);
    if (!buf)
        return base;
    try {
        const senha = (0, crypto_1.decryptPassword)(cert.senhaCriptografada);
        const parsed = (0, certificado_parser_1.parseCertificado)(buf, senha);
        return {
            valid_until: parsed.data_validade ?? cert.dataValidade,
            thumbprint: parsed.thumbprint,
            serial: parsed.serial,
        };
    }
    catch (err) {
        logger.warn({ err }, 'Não foi possível parsear certificado existente');
        return base;
    }
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
    const metaPreview = [];
    for (let i = 0; i < validFiles.length; i++) {
        try {
            const parsed = (0, certificado_parser_1.parseCertificado)(validFiles[i].buffer, senha);
            const cnpjLimpo = normCnpj(parsed.cnpj);
            const [existeEmpresa, existingCert] = await Promise.all([
                client_1.prisma.empresa.findUnique({ where: { cnpj: cnpjLimpo } }),
                certRepo.obterPorCnpj(cnpjLimpo),
            ]);
            const incoming = {
                valid_until: parsed.data_validade,
                thumbprint: parsed.thumbprint,
                serial: parsed.serial,
            };
            let existingIdentity = null;
            if (existingCert) {
                existingIdentity = await identityDoCertificadoExistente(existingCert);
            }
            const classified = (0, import_certificados_classify_1.classifyIncomingCertificate)({
                incoming,
                existing: existingIdentity,
            });
            const item = {
                indice: i,
                cnpj: parsed.cnpj,
                razao_social: parsed.razao_social,
                data_validade: parsed.data_validade,
                existe_empresa: !!existeEmpresa,
                existe_certificado: !!existingCert,
                action: classified.action,
                can_confirm: classified.can_confirm,
                default_confirm_action: (0, import_certificados_classify_1.defaultConfirmAction)(classified.action),
                message: classified.message,
                days_delta: classified.days_delta,
                existing_cert_id: existingCert?.id ?? null,
                existing_valid_until: existingIdentity?.valid_until ?? existingCert?.dataValidade ?? null,
                thumbprint: parsed.thumbprint,
                serial: parsed.serial,
                acao: (0, import_certificados_classify_1.toLegacyAcao)(classified.action),
                ...(classified.can_confirm ? {} : { erro: classified.message }),
            };
            items.push(item);
            metaPreview.push({
                indice: i,
                action: classified.action,
                can_confirm: classified.can_confirm,
                cnpj: cnpjLimpo,
                existing_cert_id: existingCert?.id ?? null,
                existing_arquivo: existingCert?.arquivo ?? null,
                incoming_thumbprint: parsed.thumbprint,
                incoming_serial: parsed.serial,
                incoming_valid_until: parsed.data_validade,
                existing_valid_until: existingIdentity?.valid_until ?? existingCert?.dataValidade ?? null,
                days_delta: classified.days_delta,
                message: classified.message,
            });
        }
        catch (e) {
            const msg = e.message || 'Arquivo inválido';
            const action = /senha|password|mac|invalid|pfx|p12|pkcs/i.test(msg)
                ? 'INVALID_FILE'
                : 'ERROR';
            items.push({
                indice: i,
                cnpj: '',
                razao_social: '',
                data_validade: null,
                existe_empresa: false,
                existe_certificado: false,
                action,
                can_confirm: false,
                default_confirm_action: 'SKIP',
                message: msg,
                days_delta: null,
                existing_cert_id: null,
                existing_valid_until: null,
                thumbprint: null,
                serial: null,
                acao: 'ERRO',
                erro: msg,
            });
            metaPreview.push({
                indice: i,
                action,
                can_confirm: false,
                cnpj: '',
                existing_cert_id: null,
                existing_arquivo: null,
                incoming_thumbprint: null,
                incoming_serial: null,
                incoming_valid_until: null,
                existing_valid_until: null,
                days_delta: null,
                message: msg,
            });
        }
    }
    (0, import_session_store_1.saveSessionMeta)(sessionId, { preview: metaPreview, processed: [] });
    return { session_id: sessionId, items };
}
function parseConfirmAction(raw) {
    if (raw === 'CREATE' || raw === 'REPLACE_EXISTING' || raw === 'SKIP')
        return raw;
    // Compat: itens só com indice → trata como CREATE (legado)
    if (raw == null || raw === undefined)
        return null;
    return null;
}
async function confirmarCertificados(input) {
    const { session_id, senha, itens, contabilidade_id } = input;
    if (!senha?.trim()) {
        throw new Error('Senha é obrigatória no confirmar');
    }
    let files;
    try {
        files = (0, import_session_store_1.getSessionFiles)(session_id);
    }
    catch (e) {
        throw new Error(e.message);
    }
    const meta = (0, import_session_store_1.loadSessionMeta)(session_id);
    const processed = new Set(meta.processed);
    const erros = [];
    let importados = 0;
    let atualizados = 0;
    let ignorados = 0;
    const newlyProcessed = [];
    for (const item of itens) {
        const i = item.indice;
        if (i < 0 || i >= files.length) {
            erros.push({ indice: i, mensagem: 'Índice inválido' });
            continue;
        }
        const action = item.action;
        if (action === 'SKIP') {
            ignorados++;
            newlyProcessed.push(i);
            continue;
        }
        if (processed.has(i)) {
            // Idempotente: já processado nesta sessão
            if (action === 'CREATE')
                importados++;
            else if (action === 'REPLACE_EXISTING')
                atualizados++;
            continue;
        }
        try {
            const result = await processarItemConfirmado({
                file: files[i],
                senha,
                action,
                contabilidade_id,
                previewMeta: meta.preview.find((p) => p.indice === i) ?? null,
            });
            if (result === 'created')
                importados++;
            else if (result === 'replaced')
                atualizados++;
            newlyProcessed.push(i);
        }
        catch (e) {
            erros.push({ indice: i, mensagem: e.message });
        }
    }
    if (newlyProcessed.length > 0) {
        (0, import_session_store_1.markIndicesProcessed)(session_id, newlyProcessed);
    }
    const metaAfter = (0, import_session_store_1.loadSessionMeta)(session_id);
    if (metaAfter.processed.length >= files.length) {
        (0, import_session_store_1.destroySession)(session_id);
    }
    return { importados, atualizados, ignorados, erros };
}
async function processarItemConfirmado(opts) {
    const { file, senha, action, contabilidade_id } = opts;
    const parsed = (0, certificado_parser_1.parseCertificado)(file.buffer, senha);
    const cnpjLimpo = normCnpj(parsed.cnpj);
    const incoming = {
        valid_until: parsed.data_validade,
        thumbprint: parsed.thumbprint,
        serial: parsed.serial,
    };
    const existingCert = await certRepo.obterPorCnpj(cnpjLimpo);
    let existingIdentity = null;
    if (existingCert) {
        existingIdentity = await identityDoCertificadoExistente(existingCert);
    }
    const classified = (0, import_certificados_classify_1.classifyIncomingCertificate)({
        incoming,
        existing: existingIdentity,
    });
    if (action === 'CREATE') {
        if (existingCert) {
            throw new Error('CNPJ já possui certificado. Use REPLACE_EXISTING para atualizar explicitamente.');
        }
        if (!classified.can_confirm || classified.action !== 'NEW') {
            throw new Error(classified.message || 'Certificado não pode ser cadastrado');
        }
        await criarCertificadoNovo({
            buffer: file.buffer,
            senha,
            parsed,
            cnpjLimpo,
            contabilidade_id,
        });
        return 'created';
    }
    if (action === 'REPLACE_EXISTING') {
        if (!existingCert) {
            throw new Error('Não há certificado existente para substituir. Use CREATE para cadastrar.');
        }
        if (classified.action === 'EXACT_DUPLICATE') {
            throw new Error('Certificado idêntico ao cadastrado — substituição desnecessária');
        }
        if (classified.action === 'EXPIRED_CERTIFICATE') {
            throw new Error('Certificado enviado já está vencido — substituição bloqueada');
        }
        if (classified.action !== 'UPDATE_AVAILABLE') {
            throw new Error(classified.message ||
                'Substituição só é permitida quando o novo certificado tem validade superior');
        }
        await substituirCertificadoSeguro({
            buffer: file.buffer,
            senha,
            parsed,
            cnpjLimpo,
            contabilidade_id,
            existingCert,
        });
        return 'replaced';
    }
    throw new Error(`Ação inválida: ${action}`);
}
async function ensureEmpresa(cnpjLimpo, razaoSocial, contabilidade_id) {
    let empresa = await client_1.prisma.empresa.findUnique({ where: { cnpj: cnpjLimpo } });
    if (!empresa) {
        empresa = await client_1.prisma.empresa.create({
            data: {
                cnpj: cnpjLimpo,
                razaoSocial,
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
    return empresa;
}
async function criarCertificadoNovo(opts) {
    const { buffer, senha, parsed, cnpjLimpo, contabilidade_id } = opts;
    const empresa = await ensureEmpresa(cnpjLimpo, parsed.razao_social, contabilidade_id);
    const storagePath = gerarStoragePath(cnpjLimpo, contabilidade_id);
    const supabase = (0, supabase_1.getSupabaseClient)();
    const bucket = env_1.env.CERT_STORAGE_BUCKET || 'certificados';
    const { error: uploadError } = await supabase.storage
        .from(bucket)
        .upload(storagePath, buffer, {
        upsert: false,
        contentType: 'application/x-pkcs12',
    });
    if (uploadError) {
        throw new Error(`Upload: ${uploadError.message}`);
    }
    try {
        await client_1.prisma.certificado.create({
            data: {
                cnpj: cnpjLimpo,
                arquivo: storagePath,
                senhaCriptografada: (0, crypto_1.encryptPassword)(senha),
                dataValidade: parsed.data_validade ?? undefined,
                empresaId: String(empresa.id),
                contabilidadeId: contabilidade_id ?? undefined,
            },
        });
    }
    catch (err) {
        await (0, certificado_storage_service_1.removerArquivosCertificado)([storagePath]);
        throw err;
    }
}
/**
 * Substituição segura: upload novo → atualiza DB → só então remove arquivo antigo.
 * Se DB falhar após upload, remove o arquivo novo e mantém o antigo.
 */
async function substituirCertificadoSeguro(opts) {
    const { buffer, senha, parsed, cnpjLimpo, contabilidade_id, existingCert } = opts;
    const empresa = await ensureEmpresa(cnpjLimpo, parsed.razao_social, contabilidade_id);
    const oldPath = existingCert.arquivo?.trim() || null;
    const newPath = gerarStoragePath(cnpjLimpo, contabilidade_id);
    const supabase = (0, supabase_1.getSupabaseClient)();
    const bucket = env_1.env.CERT_STORAGE_BUCKET || 'certificados';
    const { error: uploadError } = await supabase.storage
        .from(bucket)
        .upload(newPath, buffer, {
        upsert: false,
        contentType: 'application/x-pkcs12',
    });
    if (uploadError) {
        throw new Error(`Upload do novo certificado: ${uploadError.message}`);
    }
    try {
        await client_1.prisma.certificado.update({
            where: { id: existingCert.id },
            data: {
                arquivo: newPath,
                senhaCriptografada: (0, crypto_1.encryptPassword)(senha),
                dataValidade: parsed.data_validade ?? undefined,
                empresaId: String(empresa.id),
                contabilidadeId: contabilidade_id ?? undefined,
            },
        });
    }
    catch (err) {
        await (0, certificado_storage_service_1.removerArquivosCertificado)([newPath]);
        throw new Error(`Falha ao atualizar certificado no banco (arquivo antigo preservado): ${err.message}`);
    }
    // DB ok — remove arquivo antigo (se diferente do novo)
    if (oldPath && oldPath !== newPath) {
        const cleanup = await (0, certificado_storage_service_1.removerArquivosCertificado)([oldPath]);
        if (cleanup.failed.length > 0) {
            logger.warn({ oldPath, failed: cleanup.failed }, 'Certificado atualizado, mas falha ao remover arquivo antigo do Storage');
        }
    }
    // Remove extras do mesmo CNPJ (órfãos), mantendo o registro atualizado
    const todos = await certRepo.listarPorCnpjNormalizado(cnpjLimpo);
    const extras = todos.filter((c) => c.id !== existingCert.id);
    if (extras.length > 0) {
        const extraPaths = extras.map((c) => c.arquivo);
        await client_1.prisma.certificado.deleteMany({
            where: { id: { in: extras.map((c) => c.id) } },
        });
        await (0, certificado_storage_service_1.removerArquivosCertificado)(extraPaths);
    }
}
/** Expõe parse de ação para o controller (com fallback legado). */
function resolveConfirmAction(raw, hasExplicitAction) {
    const parsed = parseConfirmAction(raw);
    if (parsed)
        return parsed;
    // Legado: só { indice } → CREATE
    if (!hasExplicitAction)
        return 'CREATE';
    throw new Error('action deve ser CREATE, REPLACE_EXISTING ou SKIP');
}
//# sourceMappingURL=import-certificados.service.js.map