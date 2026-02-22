"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.previewCredenciais = previewCredenciais;
exports.confirmarCredenciais = confirmarCredenciais;
/**
 * Serviço de importação em lote de credenciais via planilha.
 * Fluxo: Preview (session) → Commit (linhas selecionadas + contabilidade).
 */
const crypto_1 = require("crypto");
const client_1 = require("../../db/client");
const crypto_2 = require("../../infrastructure/crypto");
const documento_utils_1 = require("../../utils/documento.utils");
const documento_utils_2 = require("../../utils/documento.utils");
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
    const rows = [];
    let validos = 0;
    let erros = 0;
    const docsNaPlanilha = new Map();
    const cnpjEmpresas = linhas.map((r) => {
        const t = r.tipo_login === 'CPF' ? 'CPF' : 'CNPJ';
        return (0, documento_utils_1.cnpjParaEmpresa)(r.cnpj_ou_cpf, t);
    });
    const empresasExistentes = await client_1.prisma.empresa.findMany({
        where: { cnpj: { in: [...new Set(cnpjEmpresas)] } },
        select: { cnpj: true },
    });
    const cnpjExists = new Set(empresasExistentes.map((e) => e.cnpj));
    for (let idx = 0; idx < linhas.length; idx++) {
        const row = linhas[idx];
        const doc = (0, documento_utils_1.normalizarDocumento)(row.cnpj_ou_cpf);
        const tipoRaw = String(row.tipo_login ?? 'CNPJ').toUpperCase().trim();
        const tipo = tipoRaw === 'CPF' ? 'CPF' : tipoRaw === 'CNPJ' ? 'CNPJ' : 'CNPJ';
        const cnpjEmp = (0, documento_utils_1.cnpjParaEmpresa)(row.cnpj_ou_cpf, tipo);
        const errors = [];
        let valid = true;
        const firstLinha = docsNaPlanilha.get(cnpjEmp);
        const duplicadoNaPlanilha = firstLinha !== undefined;
        if (!duplicadoNaPlanilha)
            docsNaPlanilha.set(cnpjEmp, row.linha);
        else
            errors.push('Documento duplicado na planilha');
        if (tipoRaw !== 'CNPJ' && tipoRaw !== 'CPF') {
            errors.push('Tipo de Login deve ser CNPJ ou CPF');
            valid = false;
        }
        if (!row.razao_social?.trim()) {
            errors.push('Razão Social é obrigatória');
            valid = false;
        }
        if (tipo === 'CNPJ' && !(0, documento_utils_1.validarCNPJ)(row.cnpj_ou_cpf)) {
            errors.push('CNPJ deve conter 14 dígitos');
            valid = false;
        }
        if (tipo === 'CPF' && !(0, documento_utils_1.validarCPF)(row.cnpj_ou_cpf)) {
            errors.push('CPF deve conter 11 dígitos');
            valid = false;
        }
        if (!row.senha?.trim()) {
            errors.push('Senha é obrigatória');
            valid = false;
        }
        else if (row.senha.trim().length < 3) {
            errors.push('Senha deve ter no mínimo 3 caracteres');
            valid = false;
        }
        const exists = cnpjExists.has(cnpjEmp);
        const finalValid = valid && !duplicadoNaPlanilha;
        if (finalValid)
            validos++;
        else
            erros++;
        let acao = finalValid ? (exists ? 'ATUALIZAR_CREDENCIAL' : 'CRIAR_EMPRESA') : 'ERRO';
        items.push({
            linha: row.linha,
            razao_social: row.razao_social,
            documento: doc,
            tipo,
            existe_empresa: exists,
            existe_credencial: false,
            acao,
            erro: errors[0],
        });
        rows.push({
            rowIndex: idx,
            linha: row.linha,
            razao_social: row.razao_social,
            tipo_login: tipo,
            documento_raw: row.cnpj_ou_cpf,
            documento_digits: doc,
            documento_formatado: (0, documento_utils_2.formatarDocumento)(row.cnpj_ou_cpf, tipo),
            regime: row.regime?.trim() || null,
            senha_masked: true,
            exists,
            valid: finalValid,
            errors,
            duplicado_na_planilha: duplicadoNaPlanilha,
        });
    }
    const session_id = (0, crypto_1.randomUUID)();
    sessions.set(session_id, {
        linhas,
        items,
        rows,
        createdAt: Date.now(),
    });
    return {
        session_id,
        total: linhas.length,
        validos,
        erros,
        items,
        rows,
    };
}
async function confirmarCredenciais(input) {
    const session = getSession(input.session_id);
    if (!session) {
        throw new Error('Sessão inválida ou expirada. Faça o preview novamente.');
    }
    const contabDefault = input.contabilidade_id_default;
    if (!contabDefault || contabDefault < 1) {
        throw new Error('Contabilidade é obrigatória para importar.');
    }
    const rowOverrides = new Map();
    if (Array.isArray(input.rows)) {
        for (const r of input.rows) {
            if (r.contabilidade_id != null && r.contabilidade_id > 0) {
                rowOverrides.set(r.rowIndex, r.contabilidade_id);
            }
        }
    }
    const indicesAprovados = new Set(Array.isArray(input.rows) && input.rows.length > 0
        ? input.rows.map((r) => r.rowIndex)
        : (input.linhas_aprovadas ?? []).map((linha) => session.linhas.findIndex((l) => l.linha === linha)).filter((i) => i >= 0));
    const results = [];
    let criadas = 0;
    let atualizadas = 0;
    let erros = 0;
    let skipped = 0;
    for (let idx = 0; idx < session.linhas.length; idx++) {
        if (!indicesAprovados.has(idx))
            continue;
        const row = session.linhas[idx];
        const rowPreview = session.rows?.[idx];
        const contabId = rowOverrides.get(idx) ?? contabDefault;
        if (!row) {
            results.push({ rowIndex: idx, status: 'ERROR', message: 'Linha não encontrada' });
            erros++;
            continue;
        }
        if (rowPreview && !rowPreview.valid) {
            results.push({
                rowIndex: idx,
                status: 'ERROR',
                message: rowPreview.errors?.[0] ?? 'Linha inválida',
            });
            erros++;
            continue;
        }
        try {
            const doc = (0, documento_utils_1.normalizarDocumento)(row.cnpj_ou_cpf);
            const tipo = row.tipo_login;
            const cnpjEmp = (0, documento_utils_1.cnpjParaEmpresa)(row.cnpj_ou_cpf, tipo);
            const tipoCred = tipo === 'CPF' ? 'CPF_SENHA' : 'CNPJ_SENHA';
            let empresa = await client_1.prisma.empresa.findUnique({
                where: { cnpj: cnpjEmp },
            });
            if (empresa && !input.updateExisting) {
                const credExist = await client_1.prisma.credencial.findUnique({
                    where: { empresaId_tipo: { empresaId: empresa.id, tipo: tipoCred } },
                });
                if (credExist) {
                    results.push({
                        rowIndex: idx,
                        status: 'SKIPPED_EXISTS',
                        message: 'Empresa já possui credenciais cadastradas',
                    });
                    skipped++;
                    continue;
                }
            }
            if (!empresa) {
                empresa = await client_1.prisma.empresa.create({
                    data: {
                        cnpj: cnpjEmp,
                        razaoSocial: row.razao_social.trim(),
                        regime: row.regime?.trim() || null,
                        contabilidadeId: contabId,
                    },
                });
                // Não incrementar aqui - contamos por linha/credencial, não por operação de empresa
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
                if (contabId && contabId !== (empresa.contabilidadeId ?? null)) {
                    updates.contabilidadeId = contabId;
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
                atualizadas++; // 1 linha atualizada
                results.push({ rowIndex: idx, status: 'UPDATED', message: 'Credenciais atualizadas' });
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
                criadas++; // 1 linha importada (empresa nova ou credencial nova)
                results.push({ rowIndex: idx, status: 'IMPORTED', message: 'Importado com sucesso' });
            }
        }
        catch (e) {
            const msg = e.message;
            results.push({ rowIndex: idx, status: 'ERROR', message: msg });
            erros++;
        }
    }
    sessions.delete(input.session_id);
    return {
        success: true,
        criadas,
        atualizadas,
        erros,
        skipped,
        results,
    };
}
//# sourceMappingURL=import-credenciais.service.js.map