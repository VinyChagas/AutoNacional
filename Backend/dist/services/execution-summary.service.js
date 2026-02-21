"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.obterSummaryExecucao = obterSummaryExecucao;
exports.listarEmpresasAptas = listarEmpresasAptas;
/**
 * Service de resumo de empresas para a tela de Execução de Processos.
 * Calcula status_geral (OPERACIONAL, ATENCAO, PARCIAL, INOPERANTE) e login_metodo (CERTIFICADO, CREDENCIAL).
 */
const client_1 = require("../db/client");
const DIAS_VENCENDO = 30;
const DIAS_REVALIDAR_CRED = 7;
function normCnpj(cnpj) {
    return cnpj.replace(/[.\/\-\s]/g, '').trim();
}
function parseDataValidade(val) {
    if (!val?.trim())
        return null;
    const m = val.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
        const d = new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
        return isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
}
function hojeSemHora() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
}
/** Cert válido = não vencido. Vencendo = dentro de 30 dias. */
function getCertStatus(hasCert, certValidade) {
    if (!hasCert)
        return 'NONE';
    const dt = parseDataValidade(certValidade);
    if (!dt)
        return 'NONE';
    const hoje = hojeSemHora();
    const hojeMais30 = new Date(hoje);
    hojeMais30.setDate(hojeMais30.getDate() + DIAS_VENCENDO);
    if (dt < hoje)
        return 'VENCIDO';
    if (dt >= hoje && dt <= hojeMais30)
        return 'VENCENDO';
    return 'VALIDO';
}
function needsRevalidateCred(credStatus, ultimoTeste) {
    const s = (credStatus ?? '').toUpperCase();
    if (['NAO_TESTADO', 'INVALIDA', 'ERRO_VALIDACAO'].includes(s))
        return true;
    if (s !== 'OK')
        return false;
    if (!ultimoTeste)
        return true;
    const hoje = hojeSemHora();
    const dias = Math.floor((hoje.getTime() - ultimoTeste.getTime()) / (1000 * 60 * 60 * 24));
    return dias > DIAS_REVALIDAR_CRED;
}
function calcularStatusGeral(certStatus, hasCred, credStatus, credNeedsRevalidate) {
    if (certStatus === 'VALIDO')
        return 'OPERACIONAL';
    if (certStatus === 'VENCENDO')
        return 'ATENCAO';
    if (certStatus === 'VENCIDO' || certStatus === 'NONE') {
        if (hasCred && credStatus === 'OK' && !credNeedsRevalidate)
            return 'OPERACIONAL';
        if (hasCred && (credStatus !== 'OK' || credNeedsRevalidate))
            return 'PARCIAL';
        return 'INOPERANTE';
    }
    return 'INOPERANTE';
}
function calcularLoginMetodo(hasCert, certStatus, hasCred) {
    const certUsavel = hasCert && (certStatus === 'VALIDO' || certStatus === 'VENCENDO');
    if (certUsavel)
        return 'CERTIFICADO';
    if (hasCred)
        return 'CREDENCIAL';
    return null;
}
/**
 * Obtém o resumo de empresas para execução por contabilidade.
 * Inclui contagens e listas por grupo (aptas, inoperantes, parciais).
 */
async function obterSummaryExecucao(contabilidadeId) {
    const [empresas, certificados, credenciais] = await Promise.all([
        client_1.prisma.empresa.findMany({
            where: { contabilidadeId },
            select: { id: true, cnpj: true, razaoSocial: true },
            orderBy: { razaoSocial: 'asc' },
        }),
        client_1.prisma.certificado.findMany({
            where: { contabilidadeId },
            select: { cnpj: true, dataValidade: true },
        }),
        client_1.prisma.credencial.findMany({
            where: {
                empresa: { contabilidadeId },
            },
            select: {
                empresaId: true,
                status: true,
                ultimoTesteEm: true,
            },
            orderBy: [{ ultimoTesteEm: 'desc' }, { updatedAt: 'desc' }],
        }),
    ]);
    const certPorCnpj = new Map();
    for (const c of certificados) {
        const cn = normCnpj(c.cnpj);
        const dv = c.dataValidade?.trim() || null;
        const cur = certPorCnpj.get(cn);
        if (!cur || (dv && (!cur || dv > cur)))
            certPorCnpj.set(cn, dv);
    }
    const credPorEmpresa = new Map();
    for (const cr of credenciais) {
        if (!credPorEmpresa.has(cr.empresaId)) {
            credPorEmpresa.set(cr.empresaId, {
                status: cr.status,
                ultimoTesteEm: cr.ultimoTesteEm,
            });
        }
    }
    const cnpsEmpresas = new Set(empresas.map((e) => normCnpj(e.cnpj)));
    const cnpsCertificados = new Set(certificados.map((c) => normCnpj(c.cnpj)));
    const todosCnpjs = new Set([...cnpsEmpresas, ...cnpsCertificados]);
    const empresaPorCnpj = new Map();
    for (const e of empresas) {
        empresaPorCnpj.set(normCnpj(e.cnpj), { id: e.id, razaoSocial: e.razaoSocial });
    }
    const cnpsSemEmpresa = [...todosCnpjs].filter((cn) => !empresaPorCnpj.has(cn));
    const empresaPorCnpjGlobal = new Map();
    if (cnpsSemEmpresa.length > 0) {
        const empresasPorCnpj = await client_1.prisma.empresa.findMany({
            where: { cnpj: { in: cnpsSemEmpresa } },
            select: { id: true, cnpj: true, razaoSocial: true },
        });
        for (const e of empresasPorCnpj) {
            empresaPorCnpjGlobal.set(normCnpj(e.cnpj), {
                id: e.id,
                razaoSocial: e.razaoSocial,
            });
        }
    }
    const items = [];
    for (const cnpj of todosCnpjs) {
        const emp = empresaPorCnpj.get(cnpj) ?? empresaPorCnpjGlobal.get(cnpj);
        const empresaId = emp?.id ?? 0;
        const razaoSocial = emp?.razaoSocial ?? cnpj;
        const hasCert = certPorCnpj.has(cnpj);
        const certVal = certPorCnpj.get(cnpj) ?? null;
        const certStatus = getCertStatus(hasCert, certVal);
        const hasCred = emp ? credPorEmpresa.has(emp.id) : false;
        const credData = emp ? credPorEmpresa.get(emp.id) : undefined;
        const credStatus = credData?.status ?? null;
        const credNeeds = needsRevalidateCred(credStatus, credData?.ultimoTesteEm ?? null);
        const statusGeral = calcularStatusGeral(certStatus, hasCred, credStatus, credNeeds);
        const loginMetodo = calcularLoginMetodo(hasCert, certStatus, hasCred);
        items.push({
            empresa_id: empresaId,
            cnpj,
            razao_social: razaoSocial,
            status_geral: statusGeral,
            login_metodo: loginMetodo,
        });
    }
    const aptas = items.filter((i) => i.status_geral === 'OPERACIONAL' || i.status_geral === 'ATENCAO');
    const inoperantes = items.filter((i) => i.status_geral === 'INOPERANTE');
    const parciais = items.filter((i) => i.status_geral === 'PARCIAL');
    const totalOperacional = items.filter((i) => i.status_geral === 'OPERACIONAL').length;
    const totalAtencao = items.filter((i) => i.status_geral === 'ATENCAO').length;
    return {
        total_empresas: items.length,
        total_aptas: aptas.length,
        total_operacional: totalOperacional,
        total_atencao: totalAtencao,
        total_inoperante: inoperantes.length,
        total_parcial: parciais.length,
        aptas,
        inoperantes,
        parciais,
    };
}
/**
 * Lista apenas empresas aptas (OPERACIONAL ou ATENCAO) para carregar na fila de execução.
 */
async function listarEmpresasAptas(contabilidadeId) {
    const summary = await obterSummaryExecucao(contabilidadeId);
    return summary.aptas;
}
//# sourceMappingURL=execution-summary.service.js.map