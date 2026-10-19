import { describe, it, expect } from 'vitest';
import {
  computeOperationalSnapshot,
  isAutomationEligible,
  type EmpresaStatusInput,
} from './empresa-status';

function input(overrides: Partial<EmpresaStatusInput> = {}): EmpresaStatusInput {
  return {
    has_certificado: false,
    cert_validade: null,
    has_credenciais: false,
    cred_status: null,
    cred_ultimo_teste_em: null,
    now: new Date('2026-07-20T12:00:00'),
    ...overrides,
  };
}

describe('computeOperationalSnapshot — matriz de elegibilidade', () => {
  it('certificado válido + qualquer credencial => ELIGIBLE ou WITH_WARNING', () => {
    const ok = computeOperationalSnapshot(
      input({
        has_certificado: true,
        cert_validade: '31/12/2099',
        has_credenciais: true,
        cred_status: 'INVALIDA',
      })
    );
    expect(ok.certificate_status).toBe('VALID');
    expect(isAutomationEligible(ok.automation_eligibility)).toBe(true);
    expect(ok.automation_eligibility).toBe('ELIGIBLE_WITH_WARNING');
    expect(ok.status_geral).toBe('PARCIAL');
  });

  it('certificado válido sem pendências => ELIGIBLE / OPERACIONAL', () => {
    const s = computeOperationalSnapshot(
      input({
        has_certificado: true,
        cert_validade: '31/12/2099',
      })
    );
    expect(s.automation_eligibility).toBe('ELIGIBLE');
    expect(s.status_geral).toBe('OPERACIONAL');
    expect(s.login_metodo).toBe('CERTIFICADO');
  });

  it('ausente/vencido + credencial válida => apta', () => {
    const expired = computeOperationalSnapshot(
      input({
        has_certificado: true,
        cert_validade: '01/01/2020',
        has_credenciais: true,
        cred_status: 'OK',
        cred_ultimo_teste_em: new Date('2026-07-18'),
      })
    );
    expect(expired.certificate_status).toBe('EXPIRED');
    expect(expired.automation_eligibility).toBe('ELIGIBLE');
    expect(expired.status_geral).toBe('OPERACIONAL');
    expect(expired.login_metodo).toBe('CREDENCIAL');
    expect(expired.issue_codes).toContain('CERT_EXPIRED');
  });

  it('vencendo + ausente/inválida => apta com alerta (ATENCAO)', () => {
    const s = computeOperationalSnapshot(
      input({
        has_certificado: true,
        cert_validade: '25/07/2026', // 5 dias a partir de 20/07/2026
        has_credenciais: false,
      })
    );
    expect(s.certificate_status).toBe('EXPIRING_SOON');
    expect(s.automation_eligibility).toBe('ELIGIBLE_WITH_WARNING');
    expect(s.status_geral).toBe('ATENCAO');
    expect(s.certificate_days_delta).toBe(5);
  });

  it('vencido/ausente + inválida/ausente/não testada => NOT_ELIGIBLE', () => {
    const a = computeOperationalSnapshot(
      input({
        has_certificado: true,
        cert_validade: '01/01/2020',
        has_credenciais: true,
        cred_status: 'INVALIDA',
      })
    );
    expect(a.automation_eligibility).toBe('NOT_ELIGIBLE');
    expect(a.status_geral).toBe('INOPERANTE');

    const b = computeOperationalSnapshot(
      input({
        has_certificado: false,
        has_credenciais: true,
        cred_status: 'NAO_TESTADO',
      })
    );
    expect(b.automation_eligibility).toBe('NOT_ELIGIBLE');

    const c = computeOperationalSnapshot(input({}));
    expect(c.automation_eligibility).toBe('NOT_ELIGIBLE');
    expect(c.login_metodo).toBeNull();
  });

  it('erro de certificado + credencial válida => apta com pendência', () => {
    const s = computeOperationalSnapshot(
      input({
        has_certificado: true,
        cert_validade: 'data-invalida',
        has_credenciais: true,
        cred_status: 'OK',
        cred_ultimo_teste_em: new Date('2026-07-18'),
      })
    );
    expect(s.certificate_status).toBe('ERROR');
    expect(s.automation_eligibility).toBe('ELIGIBLE_WITH_WARNING');
    expect(s.status_geral).toBe('PARCIAL');
  });

  it('válido + credencial para revalidação => apta com pendência', () => {
    const antigo = new Date('2026-07-01');
    const s = computeOperationalSnapshot(
      input({
        has_certificado: true,
        cert_validade: '31/12/2099',
        has_credenciais: true,
        cred_status: 'OK',
        cred_ultimo_teste_em: antigo,
      })
    );
    expect(s.credential_requires_revalidation).toBe(true);
    expect(s.credential_revalidation_reason).toBe('STALE_TEST');
    expect(s.automation_eligibility).toBe('ELIGIBLE_WITH_WARNING');
  });

  it('credencial OK testada há mais de 7 dias exige revalidação', () => {
    const s = computeOperationalSnapshot(
      input({
        has_credenciais: true,
        cred_status: 'OK',
        cred_ultimo_teste_em: new Date('2026-07-01'),
      })
    );
    expect(s.credential_requires_revalidation).toBe(true);
    expect(s.credential_revalidation_reason).toBe('STALE_TEST');
  });

  it('empresa sem qualquer método => não apta', () => {
    const s = computeOperationalSnapshot(input({}));
    expect(s.automation_eligibility).toBe('NOT_ELIGIBLE');
    expect(s.recommended_action).toBeTruthy();
  });
});
