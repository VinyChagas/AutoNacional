"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.obterSummaryExecucao = obterSummaryExecucao;
exports.listarEmpresasAptas = listarEmpresasAptas;
/**
 * Service de resumo de empresas para a tela de Execução de Processos.
 * Reutiliza EmpresaStatusService (mesma regra da listagem/summary).
 */
const client_1 = require("../db/client");
const empresa_status_1 = require("../modules/certificados/empresas/empresa-status");
function normCnpj(cnpj) {
    return cnpj.replace(/[.\/\-\s]/g, '').trim();
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
                ultimaMensagem: true,
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
                ultimaMensagem: cr.ultimaMensagem ?? null,
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
        const hasCred = emp ? credPorEmpresa.has(emp.id) : false;
        const credData = emp ? credPorEmpresa.get(emp.id) : undefined;
        const snap = (0, empresa_status_1.computeOperationalSnapshot)({
            has_certificado: hasCert,
            cert_validade: certVal,
            has_credenciais: hasCred,
            cred_status: credData?.status ?? null,
            cred_ultimo_teste_em: credData?.ultimoTesteEm ?? null,
            cred_ultima_mensagem: credData?.ultimaMensagem ?? null,
        });
        items.push({
            empresa_id: empresaId,
            cnpj,
            razao_social: razaoSocial,
            status_geral: snap.status_geral,
            login_metodo: snap.login_metodo,
            automation_eligibility: snap.automation_eligibility,
        });
    }
    const operacionais = items.filter((i) => i.status_geral === 'OPERACIONAL');
    const atencao = items.filter((i) => i.status_geral === 'ATENCAO');
    const parciais = items.filter((i) => i.status_geral === 'PARCIAL');
    const inoperantes = items.filter((i) => i.status_geral === 'INOPERANTE');
    /** Lista “aptas” da UI de execução: operacional + atenção (sem parcial). */
    const aptas = [...operacionais, ...atencao];
    return {
        total_empresas: items.length,
        total_aptas: aptas.length + parciais.length,
        total_operacional: operacionais.length,
        total_atencao: atencao.length,
        total_inoperante: inoperantes.length,
        total_parcial: parciais.length,
        aptas,
        inoperantes,
        parciais,
    };
}
/**
 * Lista empresas com método utilizável para a fila (inclui PARCIAL / warning).
 */
async function listarEmpresasAptas(contabilidadeId) {
    const summary = await obterSummaryExecucao(contabilidadeId);
    return [...summary.aptas, ...summary.parciais];
}
//# sourceMappingURL=execution-summary.service.js.map