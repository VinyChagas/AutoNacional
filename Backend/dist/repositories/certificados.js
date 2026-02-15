"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listarCertificados = listarCertificados;
exports.obterPorCnpj = obterPorCnpj;
exports.obterPorId = obterPorId;
exports.criar = criar;
exports.atualizar = atualizar;
exports.deletar = deletar;
exports.deletarPorCnpj = deletarPorCnpj;
/**
 * Repositório de metadados de certificados digitais.
 * Apenas metadados - upload/download de .pfx vem na Fase 5.
 */
const client_1 = require("../db/client");
function limparCnpj(cnpj) {
    return cnpj.replace(/[.\/\-\s]/g, '').trim();
}
async function listarCertificados() {
    return client_1.prisma.certificado.findMany({
        orderBy: { dataCadastro: 'desc' },
    });
}
async function obterPorCnpj(cnpj) {
    const cnpjLimpo = limparCnpj(cnpj);
    return client_1.prisma.certificado.findFirst({
        where: { cnpj: cnpjLimpo },
    });
}
async function obterPorId(id) {
    return client_1.prisma.certificado.findUnique({
        where: { id },
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
async function deletarPorCnpj(cnpj) {
    const cnpjLimpo = limparCnpj(cnpj);
    const cert = await obterPorCnpj(cnpjLimpo);
    if (!cert)
        return false;
    return deletar(cert.id);
}
//# sourceMappingURL=certificados.js.map