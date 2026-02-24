"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listarExecucoes = listarExecucoes;
exports.obterPorId = obterPorId;
exports.obterUltimaPorEmpresa = obterUltimaPorEmpresa;
exports.criar = criar;
exports.atualizar = atualizar;
/**
 * Repositório de execuções.
 */
const client_1 = require("../db/client");
async function listarExecucoes(opts) {
    const where = {};
    if (opts?.status)
        where.status = opts.status;
    if (opts?.empresaId != null)
        where.empresaId = opts.empresaId;
    return client_1.prisma.execucao.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: opts?.skip ?? 0,
        take: opts?.limit ?? 100,
    });
}
async function obterPorId(id) {
    return client_1.prisma.execucao.findUnique({
        where: { id },
    });
}
async function obterUltimaPorEmpresa(empresaId) {
    const list = await client_1.prisma.execucao.findMany({
        where: { empresaId },
        orderBy: { createdAt: 'desc' },
        take: 1,
    });
    return list[0] ?? null;
}
async function criar(data) {
    return client_1.prisma.execucao.create({
        data: {
            empresaId: data.empresaId,
            cnpj: data.cnpj,
            periodoInicio: data.periodoInicio,
            periodoFim: data.periodoFim,
            tipo: data.tipo ?? 'ambas',
            status: 'pendente',
        },
    });
}
async function atualizar(id, data) {
    try {
        return await client_1.prisma.execucao.update({
            where: { id },
            data,
        });
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=execucoes.js.map