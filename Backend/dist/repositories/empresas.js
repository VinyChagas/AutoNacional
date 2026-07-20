"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listarEmpresas = listarEmpresas;
exports.listarEmpresasPorContabilidade = listarEmpresasPorContabilidade;
exports.obterEmpresaPorId = obterEmpresaPorId;
exports.obterEmpresaComContabilidade = obterEmpresaComContabilidade;
exports.obterEmpresaPorCnpj = obterEmpresaPorCnpj;
exports.criarEmpresa = criarEmpresa;
exports.atualizarEmpresa = atualizarEmpresa;
exports.deletarEmpresa = deletarEmpresa;
exports.verificarCnpjTemCertificado = verificarCnpjTemCertificado;
/**
 * Repositório de empresas.
 */
const client_1 = require("../db/client");
const documento_certificado_1 = require("../utils/documento-certificado");
const certificado_storage_service_1 = require("../services/certificado-storage.service");
const logger_1 = require("../infrastructure/logger");
const logger = (0, logger_1.getLogger)('empresas-repo');
function limparCnpj(cnpj) {
    return (0, documento_certificado_1.limparDocumento)(cnpj);
}
async function listarEmpresas(skip = 0, limit = 100) {
    return client_1.prisma.empresa.findMany({
        orderBy: { razaoSocial: 'asc' },
        skip,
        take: limit,
    });
}
async function listarEmpresasPorContabilidade(contabilidadeId, skip = 0, limit = 100) {
    return client_1.prisma.empresa.findMany({
        where: { contabilidadeId },
        orderBy: { razaoSocial: 'asc' },
        skip,
        take: limit,
    });
}
async function obterEmpresaPorId(empresaId) {
    return client_1.prisma.empresa.findUnique({
        where: { id: empresaId },
    });
}
/** Empresa com relação contabilidade (para nome da pasta de downloads). */
async function obterEmpresaComContabilidade(empresaId) {
    return client_1.prisma.empresa.findUnique({
        where: { id: empresaId },
        include: { contabilidade: true },
    });
}
async function obterEmpresaPorCnpj(cnpj) {
    const cnpjLimpo = limparCnpj(cnpj);
    return client_1.prisma.empresa.findUnique({
        where: { cnpj: cnpjLimpo },
    });
}
async function criarEmpresa(data) {
    const cnpjLimpo = limparCnpj(data.cnpj);
    return client_1.prisma.empresa.create({
        data: {
            cnpj: cnpjLimpo,
            razaoSocial: data.razaoSocial,
            regime: data.regime,
            contabilidadeId: data.contabilidadeId,
        },
    });
}
async function atualizarEmpresa(empresaId, data) {
    try {
        return await client_1.prisma.empresa.update({
            where: { id: empresaId },
            data,
        });
    }
    catch {
        return null;
    }
}
/**
 * Exclui empresa + credenciais (cascade FK) + certificados (sem FK) + Storage.
 * Certificados são buscados por empresaId e por CNPJ equivalente (legado).
 */
async function deletarEmpresa(empresaId) {
    const empresa = await client_1.prisma.empresa.findUnique({
        where: { id: empresaId },
        select: { id: true, cnpj: true },
    });
    if (!empresa)
        return false;
    const empresaIdStr = String(empresa.id);
    const variantes = (0, documento_certificado_1.variantesDocumento)(empresa.cnpj);
    const certs = await client_1.prisma.certificado.findMany({
        where: {
            OR: [
                { empresaId: empresaIdStr },
                ...variantes.map((v) => ({ cnpj: v })),
                { cnpj: { contains: limparCnpj(empresa.cnpj) } },
            ],
        },
    });
    const certsFiltrados = certs.filter((c) => c.empresaId === empresaIdStr ||
        (0, documento_certificado_1.documentosEquivalentes)(c.cnpj, empresa.cnpj));
    const certIds = certsFiltrados.map((c) => c.id);
    const paths = certsFiltrados.map((c) => c.arquivo);
    try {
        await client_1.prisma.$transaction(async (tx) => {
            if (certIds.length > 0) {
                await tx.certificado.deleteMany({ where: { id: { in: certIds } } });
            }
            // Credenciais: onDelete Cascade na FK
            await tx.empresa.delete({ where: { id: empresaId } });
        });
    }
    catch (err) {
        logger.error({ err, empresaId, cnpjMasked: maskDoc(empresa.cnpj) }, 'Falha ao excluir empresa na transação');
        return false;
    }
    const storage = await (0, certificado_storage_service_1.removerArquivosCertificado)(paths);
    if (storage.failed.length > 0) {
        logger.error({
            empresaId,
            failedCount: storage.failed.length,
            cnpjMasked: maskDoc(empresa.cnpj),
        }, 'Empresa excluída no banco, mas falhou limpeza parcial no Storage');
    }
    else {
        logger.info({
            empresaId,
            certsRemoved: certIds.length,
            cnpjMasked: maskDoc(empresa.cnpj),
        }, 'Empresa excluída com certificados e Storage');
    }
    return true;
}
async function verificarCnpjTemCertificado(cnpj) {
    const limpo = limparCnpj(cnpj);
    const variantes = (0, documento_certificado_1.variantesDocumento)(limpo);
    const candidates = await client_1.prisma.certificado.findMany({
        where: {
            OR: [
                ...variantes.map((v) => ({ cnpj: v })),
                { cnpj: { contains: limpo } },
            ],
        },
        select: { cnpj: true },
    });
    return candidates.some((c) => (0, documento_certificado_1.documentosEquivalentes)(c.cnpj, limpo));
}
function maskDoc(doc) {
    const d = limparCnpj(doc);
    if (d.length < 6)
        return '***';
    return `${d.slice(0, 4)}***${d.slice(-2)}`;
}
//# sourceMappingURL=empresas.js.map