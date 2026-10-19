/**
 * Helpers de EXIBIÇÃO para status de empresas.
 * Regras de negócio (elegibilidade, vencimento, etc.) vêm da API — não recalcular aqui.
 */

export type CertStatus =
  | 'SEM_CERTIFICADO'
  | 'VENCIDO'
  | 'VENCENDO'
  | 'VALIDO'
  | 'ERRO_CERT';

export type CredStatusApi =
  | 'SEM_CREDENCIAIS'
  | 'INATIVA'
  | 'NAO_TESTADO'
  | 'TESTANDO'
  | 'OK'
  | 'INVALIDA'
  | 'ERRO_VALIDACAO';

export type StatusGeral = 'OPERACIONAL' | 'PARCIAL' | 'INOPERANTE' | 'ATENCAO';

export interface EmpresaStatusDisplayInput {
  status_geral?: StatusGeral | string | null;
  status_geral_motivo?: string | null;
  recommended_action?: string | null;
  issue_messages?: string[] | null;
  certificate_status?: string | null;
  certificate_days_delta?: number | null;
  cert_validade?: string | null;
  has_certificado?: boolean;
  possui_certificado?: boolean;
}

/** Mapeia certificate_status da API para o enum legado de UI. */
export function mapCertificateStatusToUi(
  certificateStatus: string | null | undefined
): CertStatus {
  switch (certificateStatus) {
    case 'MISSING':
      return 'SEM_CERTIFICADO';
    case 'EXPIRED':
      return 'VENCIDO';
    case 'EXPIRING_SOON':
      return 'VENCENDO';
    case 'VALID':
      return 'VALIDO';
    case 'ERROR':
      return 'ERRO_CERT';
    default:
      return 'SEM_CERTIFICADO';
  }
}

/**
 * Status geral para a pill — usa valor da API.
 */
export function displayStatusGeral(item: EmpresaStatusDisplayInput): StatusGeral {
  const s = (item.status_geral ?? '').toString().toUpperCase();
  if (s === 'OPERACIONAL' || s === 'ATENCAO' || s === 'PARCIAL' || s === 'INOPERANTE') {
    return s;
  }
  return 'INOPERANTE';
}

/**
 * Motivo/tooltip — prioriza campos da API.
 */
export function displayStatusReason(item: EmpresaStatusDisplayInput): string {
  if (item.status_geral_motivo?.trim()) return item.status_geral_motivo.trim();
  if (item.issue_messages && item.issue_messages.length > 0) {
    return item.issue_messages[0];
  }
  if (item.recommended_action?.trim()) return item.recommended_action.trim();
  return 'Verificar status';
}

/**
 * Info de exibição do certificado a partir dos campos da API.
 */
export function getCertDisplayInfo(item: EmpresaStatusDisplayInput): {
  label: string;
  diasText: string;
  vencido: boolean;
  certStatus: CertStatus;
} | null {
  const hasCert = item.has_certificado ?? item.possui_certificado ?? false;
  if (!hasCert || !item.cert_validade) return null;

  const certStatus = mapCertificateStatusToUi(item.certificate_status);
  const dias = item.certificate_days_delta;
  let diasText = '';

  if (dias != null && !Number.isNaN(dias)) {
    if (dias > 0) {
      diasText = dias === 1 ? '1 dia para vencer' : `${dias} dias para vencer`;
    } else if (dias === 0) {
      diasText = 'Vence hoje';
    } else {
      const abs = Math.abs(dias);
      diasText = abs === 1 ? 'Vencido há 1 dia' : `Vencido há ${abs} dias`;
    }
  }

  return {
    label: item.cert_validade,
    diasText,
    vencido: certStatus === 'VENCIDO' || (dias != null && dias < 0),
    certStatus,
  };
}
