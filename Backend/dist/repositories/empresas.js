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
function limparCnpj(cnpj) {
    return cnpj.replace(/[.\/\-]/g, '').trim();
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
async function deletarEmpresa(empresaId) {
    try {
        await client_1.prisma.empresa.delete({
            where: { id: empresaId },
        });
        return true;
    }
    catch {
        return false;
    }
}
async function verificarCnpjTemCertificado(cnpj) {
    const cnpjLimpo = limparCnpj(cnpj);
    const count = await client_1.prisma.certificado.count({
        where: { cnpj: cnpjLimpo },
    });
    return count > 0;
}
//# sourceMappingURL=empresas.js.map