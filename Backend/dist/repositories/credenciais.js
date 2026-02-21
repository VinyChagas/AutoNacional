"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listarPorEmpresa = listarPorEmpresa;
exports.obterPrimeiraPorEmpresa = obterPrimeiraPorEmpresa;
exports.obterPorId = obterPorId;
exports.criarOuAtualizar = criarOuAtualizar;
exports.atualizarStatus = atualizarStatus;
exports.atualizarCredencial = atualizarCredencial;
exports.deletarCredencial = deletarCredencial;
exports.descriptografarSenha = descriptografarSenha;
/**
 * Repositório de credenciais.
 * Suporta descriptografia de credenciais em formato CBC (iv:data) ou GCM (iv:authTag:data).
 */
const client_1 = require("../db/client");
const crypto_1 = require("../infrastructure/crypto");
const crypto_2 = require("../utils/crypto");
async function listarPorEmpresa(empresaId) {
    return client_1.prisma.credencial.findMany({
        where: { empresaId },
        orderBy: { createdAt: 'desc' },
    });
}
/**
 * Obtém a primeira credencial da empresa (para uso em automação).
 */
async function obterPrimeiraPorEmpresa(empresaId) {
    const creds = await client_1.prisma.credencial.findMany({
        where: { empresaId },
        orderBy: { updatedAt: 'desc' },
        take: 1,
    });
    return creds[0] ?? null;
}
async function obterPorId(credencialId) {
    return client_1.prisma.credencial.findUnique({
        where: { id: credencialId },
    });
}
async function criarOuAtualizar(empresaId, tipo, usuario, senha) {
    const senhaCriptografada = (0, crypto_1.encryptPassword)(senha);
    const usuarioLimpo = usuario.replace(/[.\/\-\s]/g, '');
    const existing = await client_1.prisma.credencial.findUnique({
        where: { empresaId_tipo: { empresaId, tipo } },
    });
    if (existing) {
        return client_1.prisma.credencial.update({
            where: { id: existing.id },
            data: { usuario: usuarioLimpo, senhaCriptografada },
        });
    }
    return client_1.prisma.credencial.create({
        data: {
            empresaId,
            tipo,
            usuario: usuarioLimpo,
            senhaCriptografada,
        },
    });
}
async function atualizarStatus(credencialId, status, ultimaMensagem) {
    try {
        const data = {
            status,
            ultimoTesteEm: new Date(),
        };
        if (ultimaMensagem !== undefined) {
            data.ultimaMensagem = ultimaMensagem;
        }
        return await client_1.prisma.credencial.update({
            where: { id: credencialId },
            data,
        });
    }
    catch {
        return null;
    }
}
async function atualizarCredencial(credencialId, senha) {
    try {
        const senhaCriptografada = (0, crypto_1.encryptPassword)(senha);
        return await client_1.prisma.credencial.update({
            where: { id: credencialId },
            data: { senhaCriptografada },
        });
    }
    catch {
        return null;
    }
}
async function deletarCredencial(credencialId) {
    try {
        await client_1.prisma.credencial.delete({ where: { id: credencialId } });
        return true;
    }
    catch {
        return false;
    }
}
function descriptografarSenha(credencial) {
    const enc = credencial.senhaCriptografada;
    if (!enc?.trim())
        return '';
    const parts = enc.split(':');
    if (parts.length === 3) {
        return (0, crypto_2.decrypt)(enc);
    }
    return (0, crypto_1.decryptPassword)(enc);
}
//# sourceMappingURL=credenciais.js.map