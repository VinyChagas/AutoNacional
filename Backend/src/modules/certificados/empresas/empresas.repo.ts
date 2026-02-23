/**
 * Repositório de empresas - listagem com agregados e detalhes.
 */
import { prisma } from '../../../db/client';
import { Prisma } from '@prisma/client';

function normCnpj(cnpj: string): string {
  return cnpj.replace(/[.\/\-\s]/g, '').trim();
}

function parseDataValidade(val: string | null): Date | null {
  if (!val?.trim()) return null;
  const m = val.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const d = new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

function isCertValido(hasCert: boolean, certValidade: string | null): boolean {
  if (!hasCert) return false;
  const dt = parseDataValidade(certValidade);
  if (!dt) return false;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return dt >= hoje;
}

function isCredValida(hasCred: boolean, credStatus: string | null): boolean {
  if (!hasCred) return false;
  return (credStatus ?? '').toUpperCase() === 'OK';
}

function calcularStatusGeral(
  hasCert: boolean,
  certValidade: string | null,
  hasCred: boolean,
  credStatus: string | null
): { status: StatusGeral; motivo: string } {
  const certValido = isCertValido(hasCert, certValidade);
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
  const motivos: string[] = [];
  if (hasCert && !certValido) motivos.push('Certificado vencido');
  if (hasCred && !credValida) motivos.push('Credenciais inválidas');
  return { status: 'PARCIAL', motivo: motivos.join(' e ') || 'Métodos cadastrados mas inválidos' };
}

export type StatusGeral = 'OPERACIONAL' | 'PARCIAL' | 'INOPERANTE';

export interface EmpresaAgregada {
  id: number;
  cnpj: string;
  razao_social: string;
  regime: string | null;
  contabilidade_id: number | null;
  contabilidade_nome?: string | null;
  ativo: boolean;
  created_at: Date;
  updated_at: Date;
  has_certificado: boolean;
  cert_validade: string | null;
  has_credenciais: boolean;
  cred_status: string | null;
  cred_ultimo_teste_em: string | null;
  cred_ultima_mensagem: string | null;
  status_geral: StatusGeral;
  status_geral_motivo?: string | null;
}

export interface EmpresaListagemParams {
  search?: string;
  contabilidade_id?: number;
  has_cert?: boolean;
  has_cred?: boolean;
  sem_cert?: boolean;
  sem_cred?: boolean;
  sem_metodo?: boolean;
  page?: number;
  limit?: number;
  sort?: 'cnpj' | 'razao_social' | 'contabilidade_nome' | 'cert_validade' | 'has_credenciais' | 'status_geral';
  order?: 'asc' | 'desc';
}

export interface EmpresaListagemResult {
  items: EmpresaAgregada[];
  total: number;
  page: number;
  limit: number;
}

/**
 * Lista empresas com campos agregados.
 * Busca em lotes e aplica filtros has_cert/has_cred em memória quando necessário
 * (para manter compatibilidade com schema atual; com view seria mais eficiente).
 */
export async function listarComAgregados(
  params: EmpresaListagemParams
): Promise<EmpresaListagemResult> {
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(100, Math.max(1, params.limit ?? 20));
  const skip = (page - 1) * limit;

  const whereConditions: Prisma.EmpresaWhereInput[] = [];

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

  const where: Prisma.EmpresaWhereInput =
    whereConditions.length > 0 ? { AND: whereConditions } : {};

  const needsHasFilter =
    params.has_cert != null ||
    params.has_cred != null ||
    params.sem_cert ||
    params.sem_cred ||
    params.sem_metodo;
  const takeSize = needsHasFilter ? limit * 5 : limit;

  const empresas = await prisma.empresa.findMany({
    where,
    orderBy: { razaoSocial: 'asc' },
    skip: needsHasFilter ? 0 : skip,
    take: takeSize,
  });

  const cnps = empresas.map((e) => normCnpj(e.cnpj));
  const ids = empresas.map((e) => e.id);
  const contabIds = [...new Set(empresas.map((e) => e.contabilidadeId).filter((x): x is number => x != null))];

  const [certs, creds, contabs, total] = await Promise.all([
    prisma.certificado.findMany({
      where: { cnpj: { in: cnps.length > 0 ? cnps : ['__never__'] } },
      select: { cnpj: true, dataValidade: true },
    }),
    prisma.credencial.findMany({
      where: { empresaId: { in: ids } },
      select: { empresaId: true, status: true, ultimoTesteEm: true, ultimaMensagem: true },
      orderBy: [{ ultimoTesteEm: 'desc' }, { updatedAt: 'desc' }],
    }),
    contabIds.length > 0
      ? prisma.contabilidade.findMany({
          where: { id: { in: contabIds } },
          select: { id: true, nomeContabilidade: true },
        })
      : Promise.resolve([]),
    prisma.empresa.count({ where }),
  ]);

  const certPorCnpj = new Map<string, string | null>();
  for (const c of certs) {
    const cn = normCnpj(c.cnpj);
    const dv = c.dataValidade?.trim() || null;
    const cur = certPorCnpj.get(cn);
    if (!cur || (dv && (!cur || dv > cur))) certPorCnpj.set(cn, dv);
    else if (!certPorCnpj.has(cn)) certPorCnpj.set(cn, dv);
  }

  const credPorEmpresa = new Map<number, { status: string; ultimoTesteEm: Date | null; ultimaMensagem: string | null }>();
  for (const cr of creds) {
    if (!credPorEmpresa.has(cr.empresaId)) {
      credPorEmpresa.set(cr.empresaId, {
        status: cr.status,
        ultimoTesteEm: cr.ultimoTesteEm ?? null,
        ultimaMensagem: cr.ultimaMensagem ?? null,
      });
    }
  }

  const contabPorId = new Map<number, string>();
  for (const c of contabs) {
    contabPorId.set(c.id, c.nomeContabilidade);
  }

  let items: EmpresaAgregada[] = empresas.map((e) => {
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

  if (params.has_cert === true) items = items.filter((i) => i.has_certificado);
  else if (params.has_cert === false) items = items.filter((i) => !i.has_certificado);
  if (params.has_cred === true) items = items.filter((i) => i.has_credenciais);
  else if (params.has_cred === false) items = items.filter((i) => !i.has_credenciais);

  if (params.sem_metodo) {
    items = items.filter((i) => !i.has_certificado && !i.has_credenciais);
  } else {
    if (params.sem_cert) items = items.filter((i) => !i.has_certificado);
    if (params.sem_cred) items = items.filter((i) => !i.has_credenciais);
  }

  if (params.sort) {
    const ord = params.order === 'desc' ? -1 : 1;
    const toVal = (i: EmpresaAgregada): string | number | null => {
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
      if (va === null && vb === null) cmp = 0;
      else if (va === null) cmp = 1;
      else if (vb === null) cmp = -1;
      else if (typeof va === 'number' && typeof vb === 'number') cmp = va - vb;
      else cmp = String(va).localeCompare(String(vb));
      return cmp * ord;
    });
  }

  const totalFiltered = needsHasFilter ? items.length : total;
  const paginatedItems = needsHasFilter ? items.slice(skip, skip + limit) : items;

  return {
    items: paginatedItems,
    total: needsHasFilter ? totalFiltered : total,
    page,
    limit,
  };
}

export interface EmpresaDetalhada {
  empresa: {
    id: number;
    cnpj: string;
    razao_social: string;
    regime: string | null;
    contabilidade_id: number | null;
    ativo: boolean;
    created_at: string;
    updated_at: string;
  };
  certificados_digitais: Array<{
    id: number;
    cnpj: string;
    arquivo: string | null;
    data_validade: string | null;
    contabilidade_id: number | null;
    data_cadastro: string;
  }>;
  credenciais: Array<{
    id: number;
    tipo: string;
    usuario: string;
    status: string;
    ultimo_teste_em: string | null;
  }>;
}

/**
 * Exclui empresas em massa na ordem: credenciais → certificados_digitais → empresas.
 * Ignora IDs inexistentes e retorna a quantidade efetivamente deletada.
 * Certificados são removidos por empresaId e também por cnpj (para registros legados sem empresaId).
 */
export async function deletarEmMassa(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const idsSet = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))];
  const empresas = await prisma.empresa.findMany({
    where: { id: { in: idsSet } },
    select: { id: true, cnpj: true },
  });
  const empresaIds = empresas.map((e) => e.id);
  const cnps = empresas.map((e) => normCnpj(e.cnpj));
  if (empresaIds.length === 0) return 0;

  const empresaIdStrings = empresaIds.map(String);

  await prisma.$transaction(async (tx) => {
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
export async function obterSummary(
  params: Pick<EmpresaListagemParams, 'search' | 'contabilidade_id' | 'has_cert' | 'has_cred' | 'sem_cert' | 'sem_cred' | 'sem_metodo'>
): Promise<{
  total_empresas: number;
  certificados_vencidos: number;
  credenciais_para_validar: number;
  operacionais: number;
}> {
  const whereConditions: Prisma.EmpresaWhereInput[] = [];

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

  const where: Prisma.EmpresaWhereInput =
    whereConditions.length > 0 ? { AND: whereConditions } : {};

  const empresas = await prisma.empresa.findMany({
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
    prisma.certificado.findMany({
      where: { cnpj: { in: cnps } },
      select: { cnpj: true, dataValidade: true },
    }),
    prisma.credencial.findMany({
      where: { empresaId: { in: ids } },
      select: { empresaId: true, status: true, ultimoTesteEm: true },
      orderBy: [{ ultimoTesteEm: 'desc' }, { updatedAt: 'desc' }],
    }),
  ]);

  const certPorCnpj = new Map<string, string | null>();
  for (const c of certs) {
    const cn = normCnpj(c.cnpj);
    const dv = c.dataValidade?.trim() || null;
    const cur = certPorCnpj.get(cn);
    if (!cur || (dv && (!cur || dv > cur))) certPorCnpj.set(cn, dv);
    else if (!certPorCnpj.has(cn)) certPorCnpj.set(cn, dv);
  }

  const credPorEmpresa = new Map<number, { status: string; ultimoTesteEm: Date | null }>();
  for (const cr of creds) {
    if (!credPorEmpresa.has(cr.empresaId)) {
      credPorEmpresa.set(cr.empresaId, {
        status: cr.status,
        ultimoTesteEm: cr.ultimoTesteEm ?? null,
      });
    }
  }

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const seteDiasAtras = new Date(hoje.getTime() - 7 * 24 * 60 * 60 * 1000);

  let items: Array<{ hasCert: boolean; certVal: string | null; hasCred: boolean; credStat: string | null; credUltimoTeste: Date | null }> = [];
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

  if (params.has_cert === true) items = items.filter((i) => i.hasCert);
  else if (params.has_cert === false) items = items.filter((i) => !i.hasCert);
  if (params.has_cred === true) items = items.filter((i) => i.hasCred);
  else if (params.has_cred === false) items = items.filter((i) => !i.hasCred);
  if (params.sem_metodo) {
    items = items.filter((i) => !i.hasCert && !i.hasCred);
  } else {
    if (params.sem_cert) items = items.filter((i) => !i.hasCert);
    if (params.sem_cred) items = items.filter((i) => !i.hasCred);
  }

  let certificados_vencidos = 0;
  let credenciais_para_validar = 0;
  let operacionais = 0;

  for (const i of items) {
    if (i.hasCert && !isCertValido(true, i.certVal)) {
      certificados_vencidos++;
    }
    if (i.hasCred) {
      const status = (i.credStat ?? '').toUpperCase();
      const ultimoTeste = i.credUltimoTeste;
      if (
        status === 'NAO_TESTADO' ||
        status === 'INVALIDA' ||
        status === 'ERRO_VALIDACAO' ||
        (ultimoTeste && ultimoTeste < seteDiasAtras)
      ) {
        credenciais_para_validar++;
      }
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
export async function obterPorIdComDetalhes(
  id: number
): Promise<EmpresaDetalhada | null> {
  const empresa = await prisma.empresa.findUnique({
    where: { id },
  });
  if (!empresa) return null;

  const cn = normCnpj(empresa.cnpj);

  const [certificados, credenciais] = await Promise.all([
    prisma.certificado.findMany({
      where: {
        OR: [
          { cnpj: empresa.cnpj },
          { cnpj: cn },
          { cnpj: { contains: cn } },
        ],
      },
    }),
    prisma.credencial.findMany({
      where: { empresaId: id },
    }),
  ]);

  const certsByCnpj = certificados.filter(
    (c) => normCnpj(c.cnpj) === cn || c.cnpj === empresa.cnpj
  );

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
