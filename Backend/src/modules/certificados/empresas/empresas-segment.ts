/**
 * Segmentos operacionais dos cards de resumo da tela de Empresas.
 * Fonte única para parse, validação e matching — alinhado ao summary.
 */

export const EMPRESA_SEGMENTS = [
  'ALL',
  'CERT_EXPIRED',
  'CREDENTIAL_REVALIDATION_REQUIRED',
  'OPERATIONAL',
  'NOT_ELIGIBLE',
] as const;

export type EmpresaSegment = (typeof EMPRESA_SEGMENTS)[number];

export interface EmpresaSegmentInput {
  has_certificado: boolean;
  cert_validade: string | null;
  has_credenciais: boolean;
  cred_status: string | null;
  cred_ultimo_teste_em: Date | string | null;
  status_geral: 'OPERACIONAL' | 'PARCIAL' | 'INOPERANTE';
}

const DIAS_REVALIDAR_CRED = 7;

export function isEmpresaSegment(value: string): value is EmpresaSegment {
  return (EMPRESA_SEGMENTS as readonly string[]).includes(value);
}

export function parseEmpresaSegment(raw: string | undefined): EmpresaSegment {
  if (!raw?.trim()) return 'ALL';
  const normalized = raw.trim().toUpperCase();
  return isEmpresaSegment(normalized) ? normalized : 'ALL';
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

export function isCertValido(hasCert: boolean, certValidade: string | null): boolean {
  if (!hasCert) return false;
  const dt = parseDataValidade(certValidade);
  if (!dt) return false;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return dt >= hoje;
}

/**
 * Mesma regra do KPI "Credenciais para Validar" em obterSummary.
 */
export function needsCredentialRevalidation(input: {
  has_credenciais: boolean;
  cred_status: string | null;
  cred_ultimo_teste_em: Date | string | null;
}): boolean {
  if (!input.has_credenciais) return false;

  const status = (input.cred_status ?? '').toUpperCase();
  if (
    status === 'NAO_TESTADO' ||
    status === 'INVALIDA' ||
    status === 'ERRO_VALIDACAO'
  ) {
    return true;
  }

  const ultimo = input.cred_ultimo_teste_em;
  if (!ultimo) return false;

  const dt = ultimo instanceof Date ? ultimo : new Date(ultimo);
  if (isNaN(dt.getTime())) return false;

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const limite = new Date(hoje.getTime() - DIAS_REVALIDAR_CRED * 24 * 60 * 60 * 1000);
  return dt < limite;
}

/**
 * Segmento ativo dos cards. Deve produzir o mesmo universo contado no summary.
 */
export function matchesEmpresaSegment(
  item: EmpresaSegmentInput,
  segment: EmpresaSegment
): boolean {
  switch (segment) {
    case 'ALL':
      return true;
    case 'CERT_EXPIRED':
      return item.has_certificado && !isCertValido(true, item.cert_validade);
    case 'CREDENTIAL_REVALIDATION_REQUIRED':
      return needsCredentialRevalidation(item);
    case 'OPERATIONAL':
      return item.status_geral === 'OPERACIONAL';
    case 'NOT_ELIGIBLE':
      return item.status_geral !== 'OPERACIONAL';
    default: {
      const _exhaustive: never = segment;
      return _exhaustive;
    }
  }
}
