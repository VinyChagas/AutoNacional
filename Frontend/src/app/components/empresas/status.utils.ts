/**
 * Utilitários para cálculo de status de empresas (certificado, credenciais, status geral).
 * Funções puras - sem side effects.
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

export interface EmpresaRowInput {
  possui_certificado: boolean;
  cert_validade?: string | null;
  possui_credenciais: boolean;
  cred_status?: CredStatusApi | string | null;
  cred_ultimo_teste_em?: string | null;
  cred_ultima_mensagem?: string | null;
}

const DIAS_VENCENDO = 30;
const DIAS_REVALIDAR_CRED = 7;

function parseDataValidade(val: string | null | undefined): Date | null {
  if (!val?.trim()) return null;
  const trimmed = val.trim();
  const ddmmyy = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ddmmyy) {
    const d = new Date(
      parseInt(ddmmyy[3], 10),
      parseInt(ddmmyy[2], 10) - 1,
      parseInt(ddmmyy[1], 10)
    );
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(trimmed);
  return isNaN(d.getTime()) ? null : d;
}

function hojeSemHora(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Status do certificado digital.
 */
export function computeCertStatus(row: EmpresaRowInput): CertStatus {
  if (!row.possui_certificado || !row.cert_validade) {
    return 'SEM_CERTIFICADO';
  }
  const dataValidade = parseDataValidade(row.cert_validade);
  if (!dataValidade) return 'ERRO_CERT';

  const hoje = hojeSemHora();
  const hojeMais30 = new Date(hoje);
  hojeMais30.setDate(hojeMais30.getDate() + DIAS_VENCENDO);

  if (dataValidade < hoje) return 'VENCIDO';
  if (dataValidade >= hoje && dataValidade <= hojeMais30) return 'VENCENDO';
  return 'VALIDO';
}

/**
 * Status das credenciais (usa valor do backend ou default NAO_TESTADO).
 */
export function computeCredStatus(row: EmpresaRowInput): CredStatusApi | 'SEM_CREDENCIAIS' {
  if (!row.possui_credenciais) return 'SEM_CREDENCIAIS';
  const s = (row.cred_status ?? '').toString().toUpperCase().replace(/\s/g, '_');
  const map: Record<string, CredStatusApi> = {
    SEM_CREDENCIAIS: 'SEM_CREDENCIAIS',
    INATIVA: 'INATIVA',
    NAO_TESTADO: 'NAO_TESTADO',
    TESTANDO: 'TESTANDO',
    OK: 'OK',
    INVALIDA: 'INVALIDA',
    INVALIDO: 'INVALIDA',
    ERRO_VALIDACAO: 'ERRO_VALIDACAO',
    SENHA_INCORRETA: 'INVALIDA',
    INVÁLIDA: 'INVALIDA',
    INVÁLIDO: 'INVALIDA',
  };
  return map[s] ?? 'NAO_TESTADO';
}

/**
 * Precisar revalidar credenciais = 7 dias.
 * Retorna true se:
 * - cred_status em (NAO_TESTADO, INVALIDA, ERRO_VALIDACAO)
 * - cred_status == OK mas cred_ultimo_teste_em é null
 * - cred_status == OK e (hoje - ultimo_teste_em) > 7 dias
 */
export function needsRevalidateCredentials(row: EmpresaRowInput): boolean {
  if (!row.possui_credenciais) return false;
  const credStatus = computeCredStatus(row);
  if (credStatus === 'SEM_CREDENCIAIS') return false;

  if (['NAO_TESTADO', 'INVALIDA', 'ERRO_VALIDACAO'].includes(credStatus)) {
    return true;
  }

  if (credStatus === 'OK') {
    const ultimoTeste = row.cred_ultimo_teste_em;
    if (!ultimoTeste) return true;

    const dt = parseDataValidade(ultimoTeste) ?? new Date(ultimoTeste);
    if (isNaN(dt.getTime())) return true;

    const hoje = hojeSemHora();
    const diasDiff = Math.floor((hoje.getTime() - dt.getTime()) / (1000 * 60 * 60 * 24));
    return diasDiff > DIAS_REVALIDAR_CRED;
  }

  return false;
}

/**
 * Status geral da empresa - "dá pra rodar automação agora?"
 */
export function computeCompanyStatusGeral(row: EmpresaRowInput): StatusGeral {
  const certStatus = computeCertStatus(row);
  const credStatus = computeCredStatus(row);
  const credNeeds = needsRevalidateCredentials(row);

  // a) Certificado válido => OPERACIONAL
  if (certStatus === 'VALIDO') return 'OPERACIONAL';

  // b) Certificado vencendo (30 dias) => ATENCAO
  if (certStatus === 'VENCENDO') return 'ATENCAO';

  // c) Certificado vencido
  if (certStatus === 'VENCIDO') {
    if (credStatus === 'OK' && !credNeeds) return 'OPERACIONAL';
    if (row.possui_credenciais && (credStatus !== 'OK' || credNeeds)) return 'PARCIAL';
    return 'INOPERANTE';
  }

  // d) SEM_CERTIFICADO ou ERRO_CERT
  if (row.possui_credenciais) {
    if (credStatus === 'OK' && !credNeeds) return 'OPERACIONAL';
    if (credStatus === 'INVALIDA') return 'INOPERANTE';
    return 'PARCIAL';
  }

  return 'INOPERANTE';
}

/**
 * Motivo curto para tooltip/subtexto.
 */
export function computeStatusReason(row: EmpresaRowInput): string {
  const status = computeCompanyStatusGeral(row);
  const certStatus = computeCertStatus(row);
  const credStatus = computeCredStatus(row);
  const credNeeds = needsRevalidateCredentials(row);

  if (status === 'OPERACIONAL') return 'Apta para automação';

  if (status === 'ATENCAO') {
    if (certStatus === 'VENCENDO' && row.cert_validade) {
      const d = parseDataValidade(row.cert_validade);
      if (d) {
        const dias = Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        return `Certificado vence em ${dias} dias`;
      }
    }
    return 'Certificado vence em breve';
  }

  if (status === 'PARCIAL') {
    if (credNeeds) return 'Credenciais não validadas';
    if (credStatus !== 'OK') return 'Credenciais inválidas ou não testadas';
    return 'Requer validação';
  }

  if (status === 'INOPERANTE') {
    if (!row.possui_certificado && !row.possui_credenciais) return 'Sem método de login';
    if (credStatus === 'INVALIDA') {
      return row.cred_ultima_mensagem?.trim() || 'Senha incorreta';
    }
    return 'Sem método válido';
  }

  return 'Verificar status';
}

/**
 * Retorna informação de exibição do certificado (data + dias restantes/vencidos).
 */
export function getCertDisplayInfo(row: EmpresaRowInput): {
  label: string;
  diasText: string;
  vencido: boolean;
  certStatus: CertStatus;
} | null {
  if (!row.possui_certificado || !row.cert_validade) return null;
  const val = row.cert_validade;
  const dataValidade = parseDataValidade(val);
  if (!dataValidade) {
    return { label: val, diasText: '', vencido: false, certStatus: 'ERRO_CERT' };
  }
  const certStatus = computeCertStatus(row);
  const dias = Math.ceil(
    (dataValidade.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  );
  let diasText: string;
  if (dias > 0) {
    diasText = dias === 1 ? '1 dia para vencer' : `${dias} dias para vencer`;
  } else if (dias === 0) {
    diasText = 'Vence hoje';
  } else {
    const abs = Math.abs(dias);
    diasText = abs === 1 ? 'Vencido há 1 dia' : `Vencido há ${abs} dias`;
  }
  return {
    label: val,
    diasText,
    vencido: dias < 0,
    certStatus,
  };
}
