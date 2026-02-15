"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listarContabilidades = listarContabilidades;
exports.obterPorId = obterPorId;
exports.obterPorCnpj = obterPorCnpj;
exports.criar = criar;
exports.atualizar = atualizar;
exports.deletar = deletar;
exports.contarCertificados = contarCertificados;
exports.contarEmpresas = contarEmpresas;
exports.obterTotalVinculados = obterTotalVinculados;
exports.obterTotalVinculadosPorIds = obterTotalVinculadosPorIds;
/**
 * Repositório de contabilidades.
 */
const client_1 = require("../db/client");
function limparCnpj(cnpj) {
    return cnpj.replace(/[.\/\-\s]/g, '').trim();
}
async function listarContabilidades(skip = 0, limit = 100) {
    return client_1.prisma.contabilidade.findMany({
        orderBy: { nomeContabilidade: 'asc' },
        skip,
        take: limit,
    });
}
async function obterPorId(id) {
    return client_1.prisma.contabilidade.findUnique({
        where: { id },
    });
}
async function obterPorCnpj(cnpj) {
    const cnpjLimpo = limparCnpj(cnpj);
    return client_1.prisma.contabilidade.findUnique({
        where: { cnpj: cnpjLimpo },
    });
}
async function criar(data) {
    const cnpjLimpo = limparCnpj(data.cnpj);
    return client_1.prisma.contabilidade.create({
        data: {
            nomeContabilidade: data.nomeContabilidade,
            cnpj: cnpjLimpo,
            email: data.email,
            telefone: data.telefone,
            responsavel: data.responsavel,
        },
    });
}
async function atualizar(id, data) {
    try {
        return await client_1.prisma.contabilidade.update({
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
        await client_1.prisma.contabilidade.delete({ where: { id } });
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Conta certificados vinculados a uma contabilidade.
 */
async function contarCertificados(contabilidadeId) {
    return client_1.prisma.certificado.count({
        where: { contabilidadeId },
    });
}
/**
 * Conta empresas vinculadas a uma contabilidade.
 */
async function contarEmpresas(contabilidadeId) {
    return client_1.prisma.empresa.count({
        where: { contabilidadeId },
    });
}
/**
 * Total de empresas vinculadas (certificados + empresas) para uma contabilidade.
 */
async function obterTotalVinculados(contabilidadeId) {
    const [certs, empresas] = await Promise.all([
        contarCertificados(contabilidadeId),
        contarEmpresas(contabilidadeId),
    ]);
    return certs + empresas;
}
/**
 * Total de vinculados para múltiplas contabilidades (em batch).
 */
async function obterTotalVinculadosPorIds(contabilidadeIds) {
    if (contabilidadeIds.length === 0)
        return {};
    const [certCounts, empCounts] = await Promise.all([
        client_1.prisma.certificado.groupBy({
            by: ['contabilidadeId'],
            where: { contabilidadeId: { in: contabilidadeIds } },
            _count: { id: true },
        }),
        client_1.prisma.empresa.groupBy({
            by: ['contabilidadeId'],
            where: { contabilidadeId: { in: contabilidadeIds } },
            _count: { id: true },
        }),
    ]);
    const result = {};
    const allIds = new Set();
    for (const row of certCounts) {
        if (row.contabilidadeId != null) {
            allIds.add(row.contabilidadeId);
            result[row.contabilidadeId] = (result[row.contabilidadeId] ?? 0) + row._count.id;
        }
    }
    for (const row of empCounts) {
        if (row.contabilidadeId != null) {
            allIds.add(row.contabilidadeId);
            result[row.contabilidadeId] =
                (result[row.contabilidadeId] ?? 0) + row._count.id;
        }
    }
    for (const id of allIds) {
        if (result[id] == null)
            result[id] = 0;
    }
    return result;
}
//# sourceMappingURL=contabilidades.js.map