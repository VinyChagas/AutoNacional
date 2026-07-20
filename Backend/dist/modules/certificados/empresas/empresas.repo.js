"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listarComAgregados = listarComAgregados;
exports.deletarEmMassa = deletarEmMassa;
exports.obterSummary = obterSummary;
exports.obterPorIdComDetalhes = obterPorIdComDetalhes;
/**
 * Repositório de empresas - listagem com agregados e detalhes.
 */
const client_1 = require("../../../db/client");
const empresas_segment_1 = require("./empresas-segment");
/** Limite ao carregar o conjunto completo para filtros em memória (segment/chips). */
const MEMORY_FILTER_MAX_TAKE = 50_000;
function normCnpj(cnpj) {
    return cnpj.replace(/[.\/\-\s]/g, '').trim();
}
function isCredValida(hasCred, credStatus) {
    if (!hasCred)
        return false;
    return (credStatus ?? '').toUpperCase() === 'OK';
}
function calcularStatusGeral(hasCert, certValidade, hasCred, credStatus) {
    const certValido = (0, empresas_segment_1.isCertValido)(hasCert, certValidade);
    const credValida = isCredValida(hasCred, credStatus);
    const temMetodo = hasCert || hasCred;
    if (!temMetodo) {
        return { status: 'INOPERANTE', motivo: 'Sem certificado e sem credenciais' };
    }
    if (certValido || credValida) {
        if (certValido && credValida) {
            return { status: 'OPERACIONAL', motivo: 'Certificado válido e credenciais OK' };
        }
        return { status: 'OPERACIONAL', motivo: certValido ? 'Certificado válido' : 'Credenciais OK' };
    }
    const motivos = [];
    if (hasCert && !certValido)
        motivos.push('Certificado vencido');
    if (hasCred && !credValida)
        motivos.push('Credenciais inválidas');
    return { status: 'PARCIAL', motivo: motivos.join(' e ') || 'Métodos cadastrados mas inválidos' };
}
/**
 * Lista empresas com campos agregados.
 * Filtros estruturais (chips) e segmento dos cards exigem agregação em memória;
 * nesse caso o conjunto completo do escopo base é carregado, filtrado, contado e só então paginado.
 */
async function listarComAgregados(params) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 20));
    const skip = (page - 1) * limit;
    const segment = params.segment ?? 'ALL';
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
    const needsMemoryFilter = params.has_cert != null ||
        params.has_cred != null ||
        Boolean(params.sem_cert) ||
        Boolean(params.sem_cred) ||
        Boolean(params.sem_metodo) ||
        segment !== 'ALL';
    const empresas = await client_1.prisma.empresa.findMany({
        where,
        orderBy: { razaoSocial: 'asc' },
        skip: needsMemoryFilter ? 0 : skip,
        take: needsMemoryFilter ? MEMORY_FILTER_MAX_TAKE : limit,
    });
    const cnps = empresas.map((e) => normCnpj(e.cnpj));
    const ids = empresas.map((e) => e.id);
    const contabIds = [...new Set(empresas.map((e) => e.contabilidadeId).filter((x) => x != null))];
    const [certs, creds, contabs, total] = await Promise.all([
        client_1.prisma.certificado.findMany({
            where: { cnpj: { in: cnps.length > 0 ? cnps : ['__never__'] } },
            select: { cnpj: true, dataValidade: true },
        }),
        client_1.prisma.credencial.findMany({
            where: { empresaId: { in: ids } },
            select: { empresaId: true, status: true, ultimoTesteEm: true, ultimaMensagem: true },
            orderBy: [{ ultimoTesteEm: 'desc' }, { updatedAt: 'desc' }],
        }),
        contabIds.length > 0
            ? client_1.prisma.contabilidade.findMany({
                where: { id: { in: contabIds } },
                select: { id: true, nomeContabilidade: true },
            })
            : Promise.resolve([]),
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
        if (!credPorEmpresa.has(cr.empresaId)) {
            credPorEmpresa.set(cr.empresaId, {
                status: cr.status,
                ultimoTesteEm: cr.ultimoTesteEm ?? null,
                ultimaMensagem: cr.ultimaMensagem ?? null,
            });
        }
    }
    const contabPorId = new Map();
    for (const c of contabs) {
        contabPorId.set(c.id, c.nomeContabilidade);
    }
    let items = empresas.map((e) => {
        const cn = normCnpj(e.cnpj);
        const hasCert = certs.some((c) => normCnpj(c.cnpj) === cn);
        const certVal = certPorCnpj.get(cn) ?? null;
        const hasCred = credPorEmpresa.has(e.id);
        const credData = credPorEmpresa.get(e.id);
        const credStat = credData?.status ?? null;
        const credUltimoTeste = credData?.ultimoTesteEm
            ? credData.ultimoTesteEm.toISOString()
            : null;
        const credUltimaMsg = credData?.ultimaMensagem ?? null;
        const { status, motivo } = calcularStatusGeral(hasCert, certVal, hasCred, credStat);
        return {
            id: e.id,
            cnpj: e.cnpj,
            razao_social: e.razaoSocial,
            regime: e.regime,
            contabilidade_id: e.contabilidadeId,
            contabilidade_nome: e.contabilidadeId != null ? contabPorId.get(e.contabilidadeId) ?? null : null,
            ativo: e.ativo,
            created_at: e.createdAt,
            updated_at: e.updatedAt,
            has_certificado: hasCert,
            cert_validade: certVal,
            has_credenciais: hasCred,
            cred_status: credStat,
            cred_ultimo_teste_em: credUltimoTeste,
            cred_ultima_mensagem: credUltimaMsg,
            status_geral: status,
            status_geral_motivo: motivo,
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
    if (params.sem_metodo) {
        items = items.filter((i) => !i.has_certificado && !i.has_credenciais);
    }
    else {
        if (params.sem_cert)
            items = items.filter((i) => !i.has_certificado);
        if (params.sem_cred)
            items = items.filter((i) => !i.has_credenciais);
    }
    if (segment !== 'ALL') {
        items = items.filter((i) => (0, empresas_segment_1.matchesEmpresaSegment)({
            has_certificado: i.has_certificado,
            cert_validade: i.cert_validade,
            has_credenciais: i.has_credenciais,
            cred_status: i.cred_status,
            cred_ultimo_teste_em: i.cred_ultimo_teste_em,
            status_geral: i.status_geral,
        }, segment));
    }
    if (params.sort) {
        const ord = params.order === 'desc' ? -1 : 1;
        const toVal = (i) => {
            switch (params.sort) {
                case 'cnpj':
                    return i.cnpj;
                case 'razao_social':
                    return i.razao_social;
                case 'contabilidade_nome':
                    return i.contabilidade_nome ?? '';
                case 'cert_validade':
                    return i.cert_validade ?? '';
                case 'has_credenciais':
                    return i.has_credenciais ? 1 : 0;
                case 'status_geral':
                    return { OPERACIONAL: 2, PARCIAL: 1, INOPERANTE: 0 }[i.status_geral] ?? 0;
                default:
                    return null;
            }
        };
        items.sort((a, b) => {
            const va = toVal(a);
            const vb = toVal(b);
            let cmp = 0;
            if (va === null && vb === null)
                cmp = 0;
            else if (va === null)
                cmp = 1;
            else if (vb === null)
                cmp = -1;
            else if (typeof va === 'number' && typeof vb === 'number')
                cmp = va - vb;
            else
                cmp = String(va).localeCompare(String(vb));
            return cmp * ord;
        });
    }
    const totalFiltered = needsMemoryFilter ? items.length : total;
    const paginatedItems = needsMemoryFilter ? items.slice(skip, skip + limit) : items;
    return {
        items: paginatedItems,
        total: needsMemoryFilter ? totalFiltered : total,
        page,
        limit,
    };
}
/**
 * Exclui empresas em massa na ordem: credenciais → certificados_digitais → empresas.
 * Ignora IDs inexistentes e retorna a quantidade efetivamente deletada.
 * Certificados são removidos por empresaId e também por cnpj (para registros legados sem empresaId).
 */
async function deletarEmMassa(ids) {
    if (ids.length === 0)
        return 0;
    const idsSet = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))];
    const empresas = await client_1.prisma.empresa.findMany({
        where: { id: { in: idsSet } },
        select: { id: true, cnpj: true },
    });
    const empresaIds = empresas.map((e) => e.id);
    const cnps = empresas.map((e) => normCnpj(e.cnpj));
    if (empresaIds.length === 0)
        return 0;
    const empresaIdStrings = empresaIds.map(String);
    await client_1.prisma.$transaction(async (tx) => {
        await tx.credencial.deleteMany({ where: { empresaId: { in: empresaIds } } });
        await tx.certificado.deleteMany({
            where: {
                OR: [
                    { empresaId: { in: empresaIdStrings } },
                    ...(cnps.length > 0 ? [{ cnpj: { in: cnps } }] : []),
                ],
            },
        });
        await tx.empresa.deleteMany({ where: { id: { in: empresaIds } } });
    });
    return empresaIds.length;
}
/**
 * Retorna métricas de resumo (total, cert vencidos, cred para validar, operacionais).
 * Usa os mesmos filtros da listagem: contabilidade, search, has_cert, has_cred, sem_*.
 */
async function obterSummary(params) {
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
    const empresas = await client_1.prisma.empresa.findMany({
        where,
        orderBy: { razaoSocial: 'asc' },
        take: 50000,
        select: { id: true, cnpj: true },
    });
    if (empresas.length === 0) {
        return { total_empresas: 0, certificados_vencidos: 0, credenciais_para_validar: 0, operacionais: 0 };
    }
    const cnps = empresas.map((e) => normCnpj(e.cnpj));
    const ids = empresas.map((e) => e.id);
    const [certs, creds] = await Promise.all([
        client_1.prisma.certificado.findMany({
            where: { cnpj: { in: cnps } },
            select: { cnpj: true, dataValidade: true },
        }),
        client_1.prisma.credencial.findMany({
            where: { empresaId: { in: ids } },
            select: { empresaId: true, status: true, ultimoTesteEm: true },
            orderBy: [{ ultimoTesteEm: 'desc' }, { updatedAt: 'desc' }],
        }),
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
        if (!credPorEmpresa.has(cr.empresaId)) {
            credPorEmpresa.set(cr.empresaId, {
                status: cr.status,
                ultimoTesteEm: cr.ultimoTesteEm ?? null,
            });
        }
    }
    let items = [];
    for (const e of empresas) {
        const cn = normCnpj(e.cnpj);
        const hasCert = certPorCnpj.has(cn);
        const certVal = certPorCnpj.get(cn) ?? null;
        const hasCred = credPorEmpresa.has(e.id);
        const credData = credPorEmpresa.get(e.id);
        const credStat = credData?.status ?? null;
        const credUltimoTeste = credData?.ultimoTesteEm ?? null;
        items.push({ hasCert, certVal, hasCred, credStat, credUltimoTeste });
    }
    if (params.has_cert === true)
        items = items.filter((i) => i.hasCert);
    else if (params.has_cert === false)
        items = items.filter((i) => !i.hasCert);
    if (params.has_cred === true)
        items = items.filter((i) => i.hasCred);
    else if (params.has_cred === false)
        items = items.filter((i) => !i.hasCred);
    if (params.sem_metodo) {
        items = items.filter((i) => !i.hasCert && !i.hasCred);
    }
    else {
        if (params.sem_cert)
            items = items.filter((i) => !i.hasCert);
        if (params.sem_cred)
            items = items.filter((i) => !i.hasCred);
    }
    let certificados_vencidos = 0;
    let credenciais_para_validar = 0;
    let operacionais = 0;
    for (const i of items) {
        if (i.hasCert && !(0, empresas_segment_1.isCertValido)(true, i.certVal)) {
            certificados_vencidos++;
        }
        if ((0, empresas_segment_1.needsCredentialRevalidation)({
            has_credenciais: i.hasCred,
            cred_status: i.credStat,
            cred_ultimo_teste_em: i.credUltimoTeste,
        })) {
            credenciais_para_validar++;
        }
        const { status } = calcularStatusGeral(i.hasCert, i.certVal, i.hasCred, i.credStat);
        if (status === 'OPERACIONAL') {
            operacionais++;
        }
    }
    const total_empresas = items.length;
    return { total_empresas, certificados_vencidos, credenciais_para_validar, operacionais };
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