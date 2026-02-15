"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cadastrarPorCredencial = cadastrarPorCredencial;
/**
 * Serviço de cadastro de empresa via credencial (CNPJ/CPF + senha).
 */
const client_1 = require("../../../db/client");
const crypto_1 = require("../../../utils/crypto");
function normCnpj(cnpj) {
    return cnpj.replace(/[.\/\-\s]/g, '').trim();
}
async function cadastrarPorCredencial(input) {
    const cnpjLimpo = normCnpj(input.cnpj);
    if (cnpjLimpo.length !== 14) {
        throw new Error('CNPJ deve conter 14 dígitos');
    }
    if (!input.senha || !input.senha.trim()) {
        throw new Error('Senha é obrigatória');
    }
    const tipo = input.tipo || 'CNPJ_SENHA';
    const usuario = (input.usuario && normCnpj(input.usuario)) || cnpjLimpo;
    if (tipo === 'CNPJ_SENHA' && usuario.length !== 14) {
        throw new Error('Usuário (CNPJ) deve conter 14 dígitos');
    }
    if (tipo === 'CPF_SENHA' && usuario.length !== 11) {
        throw new Error('Usuário (CPF) deve conter 11 dígitos');
    }
    let empresa = await client_1.prisma.empresa.findUnique({
        where: { cnpj: cnpjLimpo },
    });
    if (!empresa) {
        const razao = (input.razao_social ?? '').trim();
        if (!razao || razao.length < 2) {
            throw new Error('razao_social é obrigatório quando a empresa não existe');
        }
        empresa = await client_1.prisma.empresa.create({
            data: {
                cnpj: cnpjLimpo,
                razaoSocial: razao,
                contabilidadeId: input.contabilidade_id ?? undefined,
            },
        });
    }
    else if (input.contabilidade_id != null && input.contabilidade_id > 0) {
        await client_1.prisma.empresa.update({
            where: { id: empresa.id },
            data: { contabilidadeId: input.contabilidade_id },
        });
        empresa = await client_1.prisma.empresa.findUniqueOrThrow({
            where: { id: empresa.id },
        });
    }
    const senhaCriptografada = (0, crypto_1.encrypt)(input.senha);
    const existing = await client_1.prisma.credencial.findUnique({
        where: { empresaId_tipo: { empresaId: empresa.id, tipo } },
    });
    if (existing) {
        await client_1.prisma.credencial.update({
            where: { id: existing.id },
            data: { usuario, senhaCriptografada },
        });
    }
    else {
        await client_1.prisma.credencial.create({
            data: {
                empresaId: empresa.id,
                tipo,
                usuario,
                senhaCriptografada,
            },
        });
    }
    const cnps = [normCnpj(empresa.cnpj)];
    const [certs, creds] = await Promise.all([
        client_1.prisma.certificado.findMany({
            where: { cnpj: { in: cnps } },
            select: { dataValidade: true },
        }),
        client_1.prisma.credencial.findMany({
            where: { empresaId: empresa.id },
            orderBy: [{ ultimoTesteEm: 'desc' }, { updatedAt: 'desc' }],
        }),
    ]);
    const certValidade = certs
        .map((c) => c.dataValidade)
        .filter(Boolean)
        .sort()
        .pop();
    return {
        empresa: {
            id: empresa.id,
            cnpj: empresa.cnpj,
            razao_social: empresa.razaoSocial,
            regime: empresa.regime,
            contabilidade_id: empresa.contabilidadeId,
        },
        has_cert: certs.length > 0,
        has_cred: true,
        cert_validade: certValidade ?? null,
        cred_status: creds[0]?.status ?? null,
    };
}
//# sourceMappingURL=cadastro-credencial.service.js.map