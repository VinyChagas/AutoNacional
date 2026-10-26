/**
 * Resumo de empresas para a tela de Execução de Processos.
 *
 * Fonte de verdade cadastral: mesmo universo da tela de Empresas
 * (linhas `empresa` da contabilidade), com certificado resolvido por CNPJ
 * e classificação via `computeOperationalSnapshot`.
 *
 * status_geral e automation_eligibility são dimensões distintas:
 * - status_geral particiona o universo (exclusivo).
 * - aptas = automation_eligibility elegível (pode sobrepor ATENCAO/PARCIAL).
 */
import { prisma } from '../db/client';
import {
  computeOperationalSnapshot,
  isAutomationEligible,
  type AutomationEligibility,
  type StatusGeralDisplay,
  type LoginMetodo,
} from '../modules/certificados/empresas/empresa-status';

export type StatusGeral = StatusGeralDisplay;
export type { LoginMetodo };

export interface EmpresaExecucaoItem {
  empresa_id: number;
  cnpj: string;
  razao_social: string;
  status_geral: StatusGeral;
  login_metodo: LoginMetodo;
  automation_eligibility: AutomationEligibility;
}

export interface ExecutionSummaryResponse {
  total_empresas: number;
  /** Elegíveis para execução (ELIGIBLE | ELIGIBLE_WITH_WARNING). Pode sobrepor parciais/atenção. */
  total_aptas: number;
  /** Partições exclusivas de status_geral (somam total_empresas). */
  total_operacional: number;
  total_atencao: number;
  total_inoperante: number;
  total_parcial: number;
  /** Universo cadastral completo (sem duplicar por grupo). */
  todas: EmpresaExecucaoItem[];
  /** Lista enviável à execução (= total_aptas). Inclui parciais elegíveis. */
  aptas: EmpresaExecucaoItem[];
  inoperantes: EmpresaExecucaoItem[];
  /** Por status_geral PARCIAL (pode intersectar aptas). */
  parciais: EmpresaExecucaoItem[];
}

/** Entrada pura para projeção (testável sem Prisma). */
export interface EmpresaProjectionInput {
  empresa_id: number;
  cnpj: string;
  razao_social: string;
  has_certificado: boolean;
  cert_validade: string | null;
  has_credenciais: boolean;
  cred_status: string | null;
  cred_ultimo_teste_em: Date | string | null;
  cred_ultima_mensagem?: string | null;
  now?: Date;
}

export function normCnpj(cnpj: string): string {
  return cnpj.replace(/[.\/\-\s]/g, '').trim();
}

/**
 * Escolhe a melhor data de validade entre certificados do mesmo CNPJ
 * (maior data textual DD/MM/AAAA quando comparável; senão a última vista).
 */
export function escolherMelhorValidadeCertificado(
  existentes: Array<{ dataValidade: string | null | undefined }>
): string | null {
  let best: string | null = null;
  for (const c of existentes) {
    const dv = c.dataValidade?.trim() || null;
    if (!best || (dv && (!best || dv > best))) best = dv;
  }
  return best;
}

export function projetarItemExecucao(input: EmpresaProjectionInput): EmpresaExecucaoItem {
  const snap = computeOperationalSnapshot({
    has_certificado: input.has_certificado,
    cert_validade: input.cert_validade,
    has_credenciais: input.has_credenciais,
    cred_status: input.cred_status,
    cred_ultimo_teste_em: input.cred_ultimo_teste_em,
    cred_ultima_mensagem: input.cred_ultima_mensagem ?? null,
    now: input.now,
  });

  return {
    empresa_id: input.empresa_id,
    cnpj: normCnpj(input.cnpj),
    razao_social: input.razao_social,
    status_geral: snap.status_geral,
    login_metodo: snap.login_metodo,
    automation_eligibility: snap.automation_eligibility,
  };
}

/**
 * Agrega indicadores e listas a partir de itens já projetados.
 * status_geral: categorias exclusivas.
 * aptas: elegibilidade (sobreposta a ATENCAO/PARCIAL quando aplicável).
 */
export function agregarSummaryExecucao(items: EmpresaExecucaoItem[]): ExecutionSummaryResponse {
  const operacionais = items.filter((i) => i.status_geral === 'OPERACIONAL');
  const atencao = items.filter((i) => i.status_geral === 'ATENCAO');
  const parciais = items.filter((i) => i.status_geral === 'PARCIAL');
  const inoperantes = items.filter((i) => i.status_geral === 'INOPERANTE');
  const aptas = items.filter((i) => isAutomationEligible(i.automation_eligibility));

  return {
    total_empresas: items.length,
    total_aptas: aptas.length,
    total_operacional: operacionais.length,
    total_atencao: atencao.length,
    total_inoperante: inoperantes.length,
    total_parcial: parciais.length,
    todas: items,
    aptas,
    inoperantes,
    parciais,
  };
}

/**
 * Obtém o resumo de empresas para execução por contabilidade.
 * Universo = cadastro de empresas da contabilidade (igual tela Empresas).
 * Certificado = resolução por CNPJ (igual listagem/summary Empresas).
 */
export async function obterSummaryExecucao(contabilidadeId: number): Promise<ExecutionSummaryResponse> {
  const empresas = await prisma.empresa.findMany({
    where: { contabilidadeId },
    select: { id: true, cnpj: true, razaoSocial: true },
    orderBy: { razaoSocial: 'asc' },
  });

  if (empresas.length === 0) {
    return agregarSummaryExecucao([]);
  }

  const cnps = empresas.map((e) => normCnpj(e.cnpj));
  const ids = empresas.map((e) => e.id);

  const [certificados, credenciais] = await Promise.all([
    prisma.certificado.findMany({
      where: { cnpj: { in: cnps } },
      select: { cnpj: true, dataValidade: true, contabilidadeId: true },
    }),
    prisma.credencial.findMany({
      where: { empresaId: { in: ids } },
      select: {
        empresaId: true,
        status: true,
        ultimoTesteEm: true,
        ultimaMensagem: true,
      },
      orderBy: [{ ultimoTesteEm: 'desc' }, { updatedAt: 'desc' }],
    }),
  ]);

  const certsPorCnpj = new Map<string, Array<{ dataValidade: string | null | undefined }>>();
  for (const c of certificados) {
    const cn = normCnpj(c.cnpj);
    const list = certsPorCnpj.get(cn) ?? [];
    list.push({ dataValidade: c.dataValidade });
    certsPorCnpj.set(cn, list);
  }

  const credPorEmpresa = new Map<
    number,
    { status: string; ultimoTesteEm: Date | null; ultimaMensagem: string | null }
  >();
  for (const cr of credenciais) {
    if (!credPorEmpresa.has(cr.empresaId)) {
      credPorEmpresa.set(cr.empresaId, {
        status: cr.status,
        ultimoTesteEm: cr.ultimoTesteEm,
        ultimaMensagem: cr.ultimaMensagem ?? null,
      });
    }
  }

  const items: EmpresaExecucaoItem[] = empresas.map((e) => {
    const cn = normCnpj(e.cnpj);
    const certs = certsPorCnpj.get(cn) ?? [];
    const hasCert = certs.length > 0;
    const certVal = escolherMelhorValidadeCertificado(certs);
    const credData = credPorEmpresa.get(e.id);
    const hasCred = credPorEmpresa.has(e.id);

    return projetarItemExecucao({
      empresa_id: e.id,
      cnpj: e.cnpj,
      razao_social: e.razaoSocial,
      has_certificado: hasCert,
      cert_validade: certVal,
      has_credenciais: hasCred,
      cred_status: credData?.status ?? null,
      cred_ultimo_teste_em: credData?.ultimoTesteEm ?? null,
      cred_ultima_mensagem: credData?.ultimaMensagem ?? null,
    });
  });

  return agregarSummaryExecucao(items);
}

/**
 * Lista empresas elegíveis para a fila de execução
 * (ELIGIBLE | ELIGIBLE_WITH_WARNING — inclui PARCIAL elegível).
 */
export async function listarEmpresasAptas(
  contabilidadeId: number
): Promise<EmpresaExecucaoItem[]> {
  const summary = await obterSummaryExecucao(contabilidadeId);
  return summary.aptas;
}
