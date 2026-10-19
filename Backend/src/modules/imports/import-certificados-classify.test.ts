import { describe, it, expect } from 'vitest';
import {
  classifyIncomingCertificate,
  defaultConfirmAction,
  isExactDuplicate,
  isCertificadoVencido,
  diffDiasValidade,
} from './import-certificados-classify';

const now = new Date('2026-07-20T12:00:00');

describe('isCertificadoVencido', () => {
  it('detecta vencido', () => {
    expect(isCertificadoVencido('01/01/2020', now)).toBe(true);
  });
  it('detecta válido', () => {
    expect(isCertificadoVencido('31/12/2099', now)).toBe(false);
  });
});

describe('diffDiasValidade', () => {
  it('calcula diferença positiva', () => {
    expect(diffDiasValidade('25/07/2026', '20/07/2026')).toBe(5);
  });
  it('calcula diferença negativa', () => {
    expect(diffDiasValidade('15/07/2026', '20/07/2026')).toBe(-5);
  });
});

describe('isExactDuplicate', () => {
  it('compara thumbprint', () => {
    expect(
      isExactDuplicate(
        { valid_until: '01/01/2027', thumbprint: 'ABC', serial: null },
        { valid_until: '01/01/2026', thumbprint: 'abc', serial: null }
      )
    ).toBe(true);
  });
  it('compara serial ignorando zeros à esquerda', () => {
    expect(
      isExactDuplicate(
        { valid_until: null, thumbprint: null, serial: '00AB12' },
        { valid_until: null, thumbprint: null, serial: 'AB12' }
      )
    ).toBe(true);
  });
});

describe('classifyIncomingCertificate', () => {
  it('NEW quando não existe certificado', () => {
    const r = classifyIncomingCertificate({
      incoming: { valid_until: '31/12/2099', thumbprint: 'A', serial: '1' },
      existing: null,
      now,
    });
    expect(r.action).toBe('NEW');
    expect(r.can_confirm).toBe(true);
    expect(defaultConfirmAction(r.action)).toBe('CREATE');
  });

  it('EXPIRED_CERTIFICATE quando enviado já vencido', () => {
    const r = classifyIncomingCertificate({
      incoming: { valid_until: '01/01/2020', thumbprint: 'A', serial: '1' },
      existing: null,
      now,
    });
    expect(r.action).toBe('EXPIRED_CERTIFICATE');
    expect(r.can_confirm).toBe(false);
  });

  it('EXACT_DUPLICATE quando thumbprint igual', () => {
    const r = classifyIncomingCertificate({
      incoming: { valid_until: '31/12/2099', thumbprint: 'SAME', serial: null },
      existing: { valid_until: '01/01/2027', thumbprint: 'SAME', serial: null },
      now,
    });
    expect(r.action).toBe('EXACT_DUPLICATE');
    expect(r.can_confirm).toBe(false);
  });

  it('UPDATE_AVAILABLE quando validade superior', () => {
    const r = classifyIncomingCertificate({
      incoming: { valid_until: '31/12/2028', thumbprint: 'NEW', serial: '2' },
      existing: { valid_until: '31/12/2027', thumbprint: 'OLD', serial: '1' },
      now,
    });
    expect(r.action).toBe('UPDATE_AVAILABLE');
    expect(r.can_confirm).toBe(true);
    expect(r.days_delta).toBeGreaterThan(0);
    expect(defaultConfirmAction(r.action)).toBe('REPLACE_EXISTING');
  });

  it('OLDER_CERTIFICATE quando validade inferior ou igual', () => {
    const older = classifyIncomingCertificate({
      incoming: { valid_until: '31/12/2026', thumbprint: 'NEW', serial: '2' },
      existing: { valid_until: '31/12/2027', thumbprint: 'OLD', serial: '1' },
      now,
    });
    expect(older.action).toBe('OLDER_CERTIFICATE');
    expect(older.can_confirm).toBe(false);

    const same = classifyIncomingCertificate({
      incoming: { valid_until: '31/12/2027', thumbprint: 'NEW', serial: '2' },
      existing: { valid_until: '31/12/2027', thumbprint: 'OLD', serial: '1' },
      now,
    });
    expect(same.action).toBe('OLDER_CERTIFICATE');
  });

  it('DOCUMENT_MISMATCH bloqueia', () => {
    const r = classifyIncomingCertificate({
      incoming: { valid_until: '31/12/2099', thumbprint: 'A', serial: '1' },
      existing: null,
      documentMismatch: true,
      now,
    });
    expect(r.action).toBe('DOCUMENT_MISMATCH');
    expect(r.can_confirm).toBe(false);
  });
});
