/**
 * Segmentos operacionais dos cards de resumo da tela de Empresas.
 * Matching alinhado ao EmpresaStatusService / summary.
 */
import {
  computeOperationalSnapshot,
  isAutomationEligible,
  needsCredentialRevalidation,
  type AutomationEligibility,
  type CertificateStatus,
  type StatusGeralDisplay,
} from './empresa-status';

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
  /** Preferir snapshot; mantido para compatibilidade. */
  certificate_status?: CertificateStatus;
  automation_eligibility?: AutomationEligibility;
  status_geral?: StatusGeralDisplay;
}

export function isEmpresaSegment(value: string): value is EmpresaSegment {
  return (EMPRESA_SEGMENTS as readonly string[]).includes(value);
}

export function parseEmpresaSegment(raw: string | undefined): EmpresaSegment {
  if (!raw?.trim()) return 'ALL';
  const normalized = raw.trim().toUpperCase();
  return isEmpresaSegment(normalized) ? normalized : 'ALL';
}

/** Reexport para consumidores que importavam de empresas-segment. */
export { isCertValido, needsCredentialRevalidation } from './empresa-status';

/**
 * Segmento ativo dos cards. Deve produzir o mesmo universo contado no summary.
 */
export function matchesEmpresaSegment(
  item: EmpresaSegmentInput,
  segment: EmpresaSegment
): boolean {
  const snap =
    item.certificate_status != null && item.automation_eligibility != null
      ? {
          certificate_status: item.certificate_status,
          automation_eligibility: item.automation_eligibility,
          credential_requires_revalidation: needsCredentialRevalidation(item),
        }
      : (() => {
          const s = computeOperationalSnapshot(item);
          return {
            certificate_status: s.certificate_status,
            automation_eligibility: s.automation_eligibility,
            credential_requires_revalidation: s.credential_requires_revalidation,
          };
        })();

  switch (segment) {
    case 'ALL':
      return true;
    case 'CERT_EXPIRED':
      return snap.certificate_status === 'EXPIRED';
    case 'CREDENTIAL_REVALIDATION_REQUIRED':
      return snap.credential_requires_revalidation;
    case 'OPERATIONAL':
      return isAutomationEligible(snap.automation_eligibility);
    case 'NOT_ELIGIBLE':
      return snap.automation_eligibility === 'NOT_ELIGIBLE';
    default: {
      const _exhaustive: never = segment;
      return _exhaustive;
    }
  }
}
