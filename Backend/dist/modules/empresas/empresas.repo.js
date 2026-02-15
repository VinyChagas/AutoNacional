"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listarComAgregados = listarComAgregados;
exports.obterPorIdComDetalhes = obterPorIdComDetalhes;
/**
 * Repositório de empresas - listagem com agregados e detalhes.
 */
const client_1 = require("../../db/client");
function normCnpj(cnpj) {
    return cnpj.replace(/[.\/\-\s]/g, '').trim();
}
/**
 * Lista empresas com campos agregados.
 * Busca em lotes e aplica filtros has_cert/has_cred em memória quando necessário
 * (para manter compatibilidade com schema atual; com view seria mais eficiente).
 */
async function listarComAgregados(params) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 20));
    const skip = (page - 1) * limit;
    const whereConditions = [];
    if (params.contabilidade_id != null) {
        whereConditions.push({ contabilidadeId: params.contabilidade_id });
    }
    if (params.search && params.search.trim()) {
        const s = params.search.trim();
        const sNorm = normCnpj(s);
        whereConditions.push({
            OR: [
                { cnpj: { contains: sNorm, mode: 'insensitive' } },
                { razaoSocial: { contains: s, mode: 'insensitive' } },
                ...(sNorm.length >= 4 ? [{ cnpj: sNorm }] : []),
            ],
        });
    }
    const where = whereConditions.length > 0 ? { AND: whereConditions } : {};
    const needsHasFilter = params.has_cert != null || params.has_cred != null;
    const takeSize = needsHasFilter ? limit * 5 : limit;
    const empresas = await client_1.prisma.empresa.findMany({
        where,
        orderBy: { razaoSocial: 'asc' },
        skip: needsHasFilter ? 0 : skip,
        take: takeSize,
    });
    const cnps = empresas.map((e) => normCnpj(e.cnpj));
    const ids = empresas.map((e) => e.id);
    const [certs, creds, total] = await Promise.all([
        client_1.prisma.certificado.findMany({
            where: { cnpj: { in: cnps.length > 0 ? cnps : ['__never__'] } },
            select: { cnpj: true, dataValidade: true },
        }),
        client_1.prisma.credencial.findMany({
            where: { empresaId: { in: ids } },
            select: { empresaId: true, status: true, ultimoTesteEm: true },
            orderBy: [{ ultimoTesteEm: 'desc' }, { updatedAt: 'desc' }],
        }),
        client_1.prisma.empresa.count({ where }),
    ]);
    const certPorCnpj = new Map();
    for (const c of certs) {
        const cn = normCnpj(c.cnpj);
        const dv = c.dataValidade?.trim() || null;
        const cur = certPorCnpj.get(cn);
        if (!cur || (dv && (!cur || dv > cur)))
            certPorCnpj.set(cn, dv);
        else if (!certPorCnpj.has(cn))
            certPorCnpj.set(cn, dv);
    }
    const credPorEmpresa = new Map();
    for (const cr of creds) {
        if (!credPorEmpresa.has(cr.empresaId))
            credPorEmpresa.set(cr.empresaId, cr.status);
    }
    let items = empresas.map((e) => {
        const cn = normCnpj(e.cnpj);
        const hasCert = certs.some((c) => normCnpj(c.cnpj) === cn);
        return {
            id: e.id,
            cnpj: e.cnpj,
            razao_social: e.razaoSocial,
            regime: e.regime,
            contabilidade_id: e.contabilidadeId,
            ativo: e.ativo,
            created_at: e.createdAt,
            updated_at: e.updatedAt,
            has_certificado: hasCert,
            cert_validade: certPorCnpj.get(cn) ?? null,
            has_credenciais: credPorEmpresa.has(e.id),
            cred_status: credPorEmpresa.get(e.id) ?? null,
        };
    });
    if (params.has_cert === true)
        items = items.filter((i) => i.has_certificado);
    else if (params.has_cert === false)
        items = items.filter((i) => !i.has_certificado);
    if (params.has_cred === true)
        items = items.filter((i) => i.has_credenciais);
    else if (params.has_cred === false)
        items = items.filter((i) => !i.has_credenciais);
    const totalFiltered = needsHasFilter ? items.length : total;
    const paginatedItems = needsHasFilter ? items.slice(skip, skip + limit) : items;
    return {
        items: paginatedItems,
        total: needsHasFilter ? totalFiltered : total,
        page,
        limit,
    };
}
/**
 * Obtém empresa por ID com certificados e credenciais.
 */
async function obterPorIdComDetalhes(id) {
    const empresa = await client_1.prisma.empresa.findUnique({
        where: { id },
    });
    if (!empresa)
        return null;
    const cn = normCnpj(empresa.cnpj);
    const [certificados, credenciais] = await Promise.all([
        client_1.prisma.certificado.findMany({
            where: {
                OR: [
                    { cnpj: empresa.cnpj },
                    { cnpj: cn },
                    { cnpj: { contains: cn } },
                ],
            },
        }),
        client_1.prisma.credencial.findMany({
            where: { empresaId: id },
        }),
    ]);
    const certsByCnpj = certificados.filter((c) => normCnpj(c.cnpj) === cn || c.cnpj === empresa.cnpj);
    return {
        empresa: {
            id: empresa.id,
            cnpj: empresa.cnpj,
            razao_social: empresa.razaoSocial,
            regime: empresa.regime,
            contabilidade_id: empresa.contabilidadeId,
            ativo: empresa.ativo,
            created_at: empresa.createdAt.toISOString(),
            updated_at: empresa.updatedAt.toISOString(),
        },
        certificados_digitais: certsByCnpj.map((c) => ({
            id: c.id,
            cnpj: c.cnpj,
            arquivo: c.arquivo,
            data_validade: c.dataValidade,
            contabilidade_id: c.contabilidadeId,
            data_cadastro: c.dataCadastro.toISOString(),
        })),
        credenciais: credenciais.map((c) => ({
            id: c.id,
            tipo: c.tipo,
            usuario: c.usuario,
            status: c.status,
            ultimo_teste_em: c.ultimoTesteEm?.toISOString() ?? null,
        })),
    };
}
//# sourceMappingURL=empresas.repo.js.map