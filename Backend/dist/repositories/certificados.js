"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listarCertificados = listarCertificados;
exports.listarPorCnpjNormalizado = listarPorCnpjNormalizado;
exports.obterPorCnpj = obterPorCnpj;
exports.existeCertificadoAtivoParaCnpj = existeCertificadoAtivoParaCnpj;
exports.obterPorId = obterPorId;
exports.listarPorEmpresaId = listarPorEmpresaId;
exports.criar = criar;
exports.atualizar = atualizar;
exports.deletar = deletar;
exports.removerTodosPorCnpj = removerTodosPorCnpj;
exports.deletarPorCnpj = deletarPorCnpj;
/**
 * Repositório de metadados de certificados digitais.
 */
const client_1 = require("../db/client");
const documento_certificado_1 = require("../utils/documento-certificado");
const certificado_storage_service_1 = require("../services/certificado-storage.service");
const logger_1 = require("../infrastructure/logger");
const logger = (0, logger_1.getLogger)('certificados-repo');
function limparCnpj(cnpj) {
    return (0, documento_certificado_1.limparDocumento)(cnpj);
}
async function listarCertificados() {
    return client_1.prisma.certificado.findMany({
        orderBy: { dataCadastro: 'desc' },
    });
}
/**
 * Lista todos os certificados cujo CNPJ/CPF é equivalente ao documento informado.
 * Cobre formatação, CPF com/sem pad e múltiplos registros (sem unique no schema).
 */
async function listarPorCnpjNormalizado(cnpj) {
    const limpo = limparCnpj(cnpj);
    if (!limpo)
        return [];
    const variantes = (0, documento_certificado_1.variantesDocumento)(limpo);
    const candidates = await client_1.prisma.certificado.findMany({
        where: {
            OR: [
                ...variantes.map((v) => ({ cnpj: v })),
                // Legado: CNPJ formatado contendo os dígitos
                { cnpj: { contains: limpo } },
                ...(limpo.length === 14 && limpo.startsWith('000')
                    ? [{ cnpj: { contains: limpo.slice(3) } }]
                    : []),
            ],
        },
        orderBy: { dataCadastro: 'desc' },
    });
    return candidates.filter((c) => (0, documento_certificado_1.documentosEquivalentes)(c.cnpj, limpo));
}
async function obterPorCnpj(cnpj) {
    const list = await listarPorCnpjNormalizado(cnpj);
    return list[0] ?? null;
}
async function existeCertificadoAtivoParaCnpj(cnpj) {
    const list = await listarPorCnpjNormalizado(cnpj);
    return list.length > 0;
}
async function obterPorId(id) {
    return client_1.prisma.certificado.findUnique({
        where: { id },
    });
}
async function listarPorEmpresaId(empresaId) {
    const idStr = String(empresaId);
    return client_1.prisma.certificado.findMany({
        where: { empresaId: idStr },
        orderBy: { dataCadastro: 'desc' },
    });
}
async function criar(data) {
    const cnpjLimpo = limparCnpj(data.cnpj);
    return client_1.prisma.certificado.create({
        data: {
            cnpj: cnpjLimpo,
            arquivo: data.arquivo,
            senhaCriptografada: data.senhaCriptografada,
            dataValidade: data.dataValidade,
            empresaId: data.empresaId,
            contabilidadeId: data.contabilidadeId,
        },
    });
}
async function atualizar(id, data) {
    try {
        return await client_1.prisma.certificado.update({
            where: { id },
            data,
        });
    }
    catch {
        return null;
    }
}
async function deletar(id) {
    try {
        await client_1.prisma.certificado.delete({ where: { id } });
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Remove TODOS os certificados equivalentes ao CNPJ/CPF + arquivos no Storage.
 * Empresa e credenciais não são tocadas.
 */
async function removerTodosPorCnpj(cnpj) {
    const certs = await listarPorCnpjNormalizado(cnpj);
    if (certs.length === 0)
        return null;
    const ids = certs.map((c) => c.id);
    const paths = certs.map((c) => c.arquivo);
    await client_1.prisma.certificado.deleteMany({
        where: { id: { in: ids } },
    });
    const storage = await (0, certificado_storage_service_1.removerArquivosCertificado)(paths);
    logger.info({
        deletedCount: ids.length,
        certificadoIds: ids,
        storageFailed: storage.failed.length,
        cnpjMasked: maskDoc(cnpj),
    }, 'Certificados removidos por CNPJ');
    return {
        deletedCount: ids.length,
        certificadoIds: ids,
        storage: {
            attempted: storage.attempted,
            removed: storage.removed,
            failed: storage.failed,
        },
    };
}
/** @deprecated Use removerTodosPorCnpj — mantido para compatibilidade. */
async function deletarPorCnpj(cnpj) {
    const result = await removerTodosPorCnpj(cnpj);
    return result != null && result.deletedCount > 0;
}
function maskDoc(doc) {
    const d = limparCnpj(doc);
    if (d.length < 6)
        return '***';
    return `${d.slice(0, 4)}***${d.slice(-2)}`;
}
//# sourceMappingURL=certificados.js.map