"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.previewCredenciais = previewCredenciais;
exports.confirmarCredenciais = confirmarCredenciais;
/**
 * Serviço de importação em lote de credenciais via planilha.
 * Fluxo: Preview (session) → Confirmar (linhas aprovadas).
 */
const crypto_1 = require("crypto");
const client_1 = require("../../db/client");
const crypto_2 = require("../../infrastructure/crypto");
const documento_utils_1 = require("../../utils/documento.utils");
const planilha_parser_1 = require("../../utils/planilha.parser");
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 min
const sessions = new Map();
function limparSessionsExpiradas() {
    const agora = Date.now();
    for (const [id, data] of sessions.entries()) {
        if (agora - data.createdAt > SESSION_TTL_MS) {
            sessions.delete(id);
        }
    }
}
function getSession(sessionId) {
    limparSessionsExpiradas();
    const data = sessions.get(sessionId);
    if (!data)
        return null;
    if (Date.now() - data.createdAt > SESSION_TTL_MS) {
        sessions.delete(sessionId);
        return null;
    }
    return data;
}
async function previewCredenciais(buffer) {
    const linhas = (0, planilha_parser_1.parsePlanilhaCredenciais)(buffer);
    const items = [];
    let validos = 0;
    let erros = 0;
    for (const row of linhas) {
        const doc = (0, documento_utils_1.normalizarDocumento)(row.cnpj_ou_cpf);
        const tipoRaw = String(row.tipo_login ?? 'CNPJ').toUpperCase().trim();
        const tipo = tipoRaw === 'CPF' ? 'CPF' : tipoRaw === 'CNPJ' ? 'CNPJ' : 'CNPJ';
        // Validar Tipo de Login
        if (tipoRaw !== 'CNPJ' && tipoRaw !== 'CPF') {
            items.push({
                linha: row.linha,
                razao_social: row.razao_social,
                documento: row.cnpj_ou_cpf,
                tipo: tipoRaw || '(vazio)',
                existe_empresa: false,
                existe_credencial: false,
                acao: 'ERRO',
                erro: 'Tipo de Login deve ser CNPJ ou CPF',
            });
            erros++;
            continue;
        }
        // Validar Razão Social
        if (!row.razao_social?.trim()) {
            items.push({
                linha: row.linha,
                razao_social: row.razao_social || '',
                documento: doc,
                tipo,
                existe_empresa: false,
                existe_credencial: false,
                acao: 'ERRO',
                erro: 'Razão Social é obrigatória',
            });
            erros++;
            continue;
        }
        // Validar documento
        if (tipo === 'CNPJ' && !(0, documento_utils_1.validarCNPJ)(row.cnpj_ou_cpf)) {
            items.push({
                linha: row.linha,
                razao_social: row.razao_social,
                documento: doc || '(vazio)',
                tipo,
                existe_empresa: false,
                existe_credencial: false,
                acao: 'ERRO',
                erro: 'CNPJ deve conter 14 dígitos',
            });
            erros++;
            continue;
        }
        if (tipo === 'CPF' && !(0, documento_utils_1.validarCPF)(row.cnpj_ou_cpf)) {
            items.push({
                linha: row.linha,
                razao_social: row.razao_social,
                documento: doc || '(vazio)',
                tipo,
                existe_empresa: false,
                existe_credencial: false,
                acao: 'ERRO',
                erro: 'CPF deve conter 11 dígitos',
            });
            erros++;
            continue;
        }
        // Validar Senha
        if (!row.senha?.trim()) {
            items.push({
                linha: row.linha,
                razao_social: row.razao_social,
                documento: doc,
                tipo,
                existe_empresa: false,
                existe_credencial: false,
                acao: 'ERRO',
                erro: 'Senha é obrigatória',
            });
            erros++;
            continue;
        }
        const cnpjEmp = (0, documento_utils_1.cnpjParaEmpresa)(row.cnpj_ou_cpf, tipo);
        const tipoCred = tipo === 'CPF' ? 'CPF_SENHA' : 'CNPJ_SENHA';
        const empresa = await client_1.prisma.empresa.findUnique({
            where: { cnpj: cnpjEmp },
        });
        const credencial = empresa &&
            (await client_1.prisma.credencial.findUnique({
                where: { empresaId_tipo: { empresaId: empresa.id, tipo: tipoCred } },
            }));
        const existe_empresa = !!empresa;
        const existe_credencial = !!credencial;
        let acao;
        if (!empresa) {
            acao = 'CRIAR_EMPRESA';
        }
        else if (!credencial) {
            acao = 'CRIAR_CREDENCIAL';
        }
        else {
            acao = 'ATUALIZAR_CREDENCIAL';
        }
        items.push({
            linha: row.linha,
            razao_social: row.razao_social,
            documento: doc,
            tipo,
            existe_empresa,
            existe_credencial,
            acao,
        });
        validos++;
    }
    const session_id = (0, crypto_1.randomUUID)();
    sessions.set(session_id, {
        linhas,
        items,
        createdAt: Date.now(),
    });
    return {
        session_id,
        total: linhas.length,
        validos,
        erros,
        items,
    };
}
async function confirmarCredenciais(input) {
    const session = getSession(input.session_id);
    if (!session) {
        throw new Error('Sessão inválida ou expirada. Faça o preview novamente.');
    }
    const linhasAprovadas = new Set(input.linhas_aprovadas);
    const linhasParaProcessar = session.linhas.filter((l) => linhasAprovadas.has(l.linha));
    // Validar que as linhas aprovadas não têm ERRO
    const itensValidos = session.items.filter((i) => linhasAprovadas.has(i.linha) && i.acao !== 'ERRO');
    if (itensValidos.length !== linhasParaProcessar.length) {
        throw new Error('Algumas linhas aprovadas contêm erro. Faça o preview novamente.');
    }
    let criadas = 0;
    let atualizadas = 0;
    let erros = 0;
    for (const row of linhasParaProcessar) {
        try {
            const doc = (0, documento_utils_1.normalizarDocumento)(row.cnpj_ou_cpf);
            const tipo = row.tipo_login;
            const cnpjEmp = (0, documento_utils_1.cnpjParaEmpresa)(row.cnpj_ou_cpf, tipo);
            const tipoCred = tipo === 'CPF' ? 'CPF_SENHA' : 'CNPJ_SENHA';
            let empresa = await client_1.prisma.empresa.findUnique({
                where: { cnpj: cnpjEmp },
            });
            if (!empresa) {
                empresa = await client_1.prisma.empresa.create({
                    data: {
                        cnpj: cnpjEmp,
                        razaoSocial: row.razao_social.trim(),
                        regime: row.regime?.trim() || null,
                    },
                });
                criadas++;
            }
            else {
                const updates = {};
                const razaoNova = row.razao_social?.trim();
                const regimeNovo = row.regime?.trim() || null;
                if (razaoNova && razaoNova !== empresa.razaoSocial) {
                    updates.razaoSocial = razaoNova;
                }
                if (regimeNovo !== (empresa.regime ?? null)) {
                    updates.regime = regimeNovo;
                }
                if (Object.keys(updates).length > 0) {
                    await client_1.prisma.empresa.update({
                        where: { id: empresa.id },
                        data: updates,
                    });
                }
            }
            const senhaCriptografada = (0, crypto_2.encryptPassword)(row.senha);
            const credencial = await client_1.prisma.credencial.findUnique({
                where: { empresaId_tipo: { empresaId: empresa.id, tipo: tipoCred } },
            });
            if (credencial) {
                await client_1.prisma.credencial.update({
                    where: { id: credencial.id },
                    data: { usuario: doc, senhaCriptografada },
                });
                atualizadas++;
            }
            else {
                await client_1.prisma.credencial.create({
                    data: {
                        empresaId: empresa.id,
                        tipo: tipoCred,
                        usuario: doc,
                        senhaCriptografada,
                    },
                });
                criadas++;
            }
        }
        catch (e) {
            erros++;
            // Não interrompe o processamento
        }
    }
    sessions.delete(input.session_id);
    return {
        success: true,
        criadas,
        atualizadas,
        erros,
    };
}
//# sourceMappingURL=import-credenciais.service.js.map