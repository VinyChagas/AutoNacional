/**
 * Repositório de empresas - listagem com agregados e detalhes.
 */
import { prisma } from '../../../db/client';
import { Prisma } from '@prisma/client';
import {
  computeOperationalSnapshot,
  isAutomationEligible,
  type AutomationEligibility,
  type CertificateStatus,
  type CredentialRevalidationReason,
  type CredentialStatus,
  type StatusGeralDisplay,
} from './empresa-status';
import {
  matchesEmpresaSegment,
  type EmpresaSegment,
} from './empresas-segment';

/** Limite ao carregar o conjunto completo para filtros em memória (segment/chips). */
const MEMORY_FILTER_MAX_TAKE = 50_000;

function normCnpj(cnpj: string): string {
  return cnpj.replace(/[.\/\-\s]/g, '').trim();
}

export type StatusGeral = StatusGeralDisplay;

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
  certificate_status: CertificateStatus;
  credential_status: CredentialStatus;
  credential_requires_revalidation: boolean;
  credential_revalidation_reason: CredentialRevalidationReason;
  automation_eligibility: AutomationEligibility;
  issue_codes: string[];
  issue_messages: string[];
  recommended_action: string | null;
  certificate_days_delta: number | null;
}

export interface EmpresaListagemParams {
  search?: string;
  contabilidade_id?: number;
  has_cert?: boolean;
  has_cred?: boolean;
  sem_cert?: boolean;
  sem_cred?: boolean;
  sem_metodo?: boolean;
  /** Segmento operacional dos cards (ignorado pelo summary). */
  segment?: EmpresaSegment;
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
 * Filtros estruturais (chips) e segmento dos cards exigem agregação em memória;
 * nesse caso o conjunto completo do escopo base é carregado, filtrado, contado e só então paginado.
 */
export async function listarComAgregados(
  params: EmpresaListagemParams
): Promise<EmpresaListagemResult> {
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(100, Math.max(1, params.limit ?? 20));
  const skip = (page - 1) * limit;
  const segment: EmpresaSegment = params.segment ?? 'ALL';

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

  const needsMemoryFilter =
    params.has_cert != null ||
    params.has_cred != null ||
    Boolean(params.sem_cert) ||
    Boolean(params.sem_cred) ||
    Boolean(params.sem_metodo) ||
    segment !== 'ALL';

  const empresas = await prisma.empresa.findMany({
    where,
    orderBy: { razaoSocial: 'asc' },
    skip: needsMemoryFilter ? 0 : skip,
    take: needsMemoryFilter ? MEMORY_FILTER_MAX_TAKE : limit,
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
    const snap = computeOperationalSnapshot({
      has_certificado: hasCert,
      cert_validade: certVal,
      has_credenciais: hasCred,
      cred_status: credStat,
      cred_ultimo_teste_em: credUltimoTeste,
      cred_ultima_mensagem: credUltimaMsg,
    });
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
      status_geral: snap.status_geral,
      status_geral_motivo: snap.status_geral_motivo,
      certificate_status: snap.certificate_status,
      credential_status: snap.credential_status,
      credential_requires_revalidation: snap.credential_requires_revalidation,
      credential_revalidation_reason: snap.credential_revalidation_reason,
      automation_eligibility: snap.automation_eligibility,
      issue_codes: snap.issue_codes,
      issue_messages: snap.issue_messages,
      recommended_action: snap.recommended_action,
      certificate_days_delta: snap.certificate_days_delta,
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

  if (segment !== 'ALL') {
    items = items.filter((i) =>
      matchesEmpresaSegment(
        {
          has_certificado: i.has_certificado,
          cert_validade: i.cert_validade,
          has_credenciais: i.has_credenciais,
          cred_status: i.cred_status,
          cred_ultimo_teste_em: i.cred_ultimo_teste_em,
          certificate_status: i.certificate_status,
          automation_eligibility: i.automation_eligibility,
          status_geral: i.status_geral,
        },
        segment
      )
    );
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
          return (
            {
              OPERACIONAL: 3,
              ATENCAO: 2,
              PARCIAL: 1,
              INOPERANTE: 0,
            }[i.status_geral] ?? 0
          );
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

  const totalFiltered = needsMemoryFilter ? items.length : total;
  const paginatedItems = needsMemoryFilter ? items.slice(skip, skip + limit) : items;

  return {
    items: paginatedItems,
    total: needsMemoryFilter ? totalFiltered : total,
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
    const snap = computeOperationalSnapshot({
      has_certificado: i.hasCert,
      cert_validade: i.certVal,
      has_credenciais: i.hasCred,
      cred_status: i.credStat,
      cred_ultimo_teste_em: i.credUltimoTeste,
    });
    if (snap.certificate_status === 'EXPIRED') {
      certificados_vencidos++;
    }
    if (snap.credential_requires_revalidation) {
      credenciais_para_validar++;
    }
    if (isAutomationEligible(snap.automation_eligibility)) {
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
