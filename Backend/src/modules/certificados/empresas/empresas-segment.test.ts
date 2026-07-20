import { describe, it, expect } from 'vitest';
import {
  isCertValido,
  matchesEmpresaSegment,
  needsCredentialRevalidation,
  parseEmpresaSegment,
  type EmpresaSegmentInput,
} from './empresas-segment';
import { parseListarParams } from './empresas.service';

function baseItem(
  overrides: Partial<EmpresaSegmentInput> = {}
): EmpresaSegmentInput {
  return {
    has_certificado: false,
    cert_validade: null,
    has_credenciais: false,
    cred_status: null,
    cred_ultimo_teste_em: null,
    ...overrides,
  };
}

describe('parseEmpresaSegment', () => {
  it('retorna ALL para vazio ou inválido', () => {
    expect(parseEmpresaSegment(undefined)).toBe('ALL');
    expect(parseEmpresaSegment('')).toBe('ALL');
    expect(parseEmpresaSegment('foo')).toBe('ALL');
  });

  it('normaliza valores conhecidos', () => {
    expect(parseEmpresaSegment('cert_expired')).toBe('CERT_EXPIRED');
    expect(parseEmpresaSegment('OPERATIONAL')).toBe('OPERATIONAL');
    expect(parseEmpresaSegment('CREDENTIAL_REVALIDATION_REQUIRED')).toBe(
      'CREDENTIAL_REVALIDATION_REQUIRED'
    );
  });
});

describe('parseListarParams — segment', () => {
  it('inclui segment na listagem e preserva filtros-base', () => {
    const params = parseListarParams({
      search: 'acme',
      contabilidade_id: '3',
      has_cert: 'true',
      segment: 'CERT_EXPIRED',
      page: '2',
      limit: '50',
    });
    expect(params.segment).toBe('CERT_EXPIRED');
    expect(params.search).toBe('acme');
    expect(params.contabilidade_id).toBe(3);
    expect(params.has_cert).toBe(true);
    expect(params.page).toBe(2);
    expect(params.limit).toBe(50);
  });

  it('default de segment é ALL', () => {
    expect(parseListarParams({}).segment).toBe('ALL');
  });
});

describe('isCertValido', () => {
  it('considera vencido quando data é anterior a hoje', () => {
    expect(isCertValido(true, '01/01/2020')).toBe(false);
  });

  it('considera válido quando data é futura (incluindo vencendo)', () => {
    expect(isCertValido(true, '31/12/2099')).toBe(true);
  });
});

describe('needsCredentialRevalidation', () => {
  it('exige revalidação para NAO_TESTADO / INVALIDA / ERRO_VALIDACAO', () => {
    expect(
      needsCredentialRevalidation({
        has_credenciais: true,
        cred_status: 'NAO_TESTADO',
        cred_ultimo_teste_em: null,
      })
    ).toBe(true);
    expect(
      needsCredentialRevalidation({
        has_credenciais: true,
        cred_status: 'INVALIDA',
        cred_ultimo_teste_em: new Date(),
      })
    ).toBe(true);
  });

  it('exige revalidação quando OK com teste antigo (>7 dias)', () => {
    const antigo = new Date();
    antigo.setDate(antigo.getDate() - 10);
    expect(
      needsCredentialRevalidation({
        has_credenciais: true,
        cred_status: 'OK',
        cred_ultimo_teste_em: antigo,
      })
    ).toBe(true);
  });

  it('não exige revalidação quando OK com teste recente', () => {
    const recente = new Date();
    recente.setDate(recente.getDate() - 2);
    expect(
      needsCredentialRevalidation({
        has_credenciais: true,
        cred_status: 'OK',
        cred_ultimo_teste_em: recente,
      })
    ).toBe(false);
  });
});

describe('matchesEmpresaSegment', () => {
  it('ALL aceita qualquer item', () => {
    expect(matchesEmpresaSegment(baseItem(), 'ALL')).toBe(true);
  });

  it('CERT_EXPIRED só inclui certificado vencido', () => {
    expect(
      matchesEmpresaSegment(
        baseItem({
          has_certificado: true,
          cert_validade: '01/01/2020',
        }),
        'CERT_EXPIRED'
      )
    ).toBe(true);
    expect(
      matchesEmpresaSegment(
        baseItem({
          has_certificado: true,
          cert_validade: '31/12/2099',
        }),
        'CERT_EXPIRED'
      )
    ).toBe(false);
    expect(
      matchesEmpresaSegment(baseItem({ has_certificado: false }), 'CERT_EXPIRED')
    ).toBe(false);
  });

  it('CREDENTIAL_REVALIDATION_REQUIRED alinha com o KPI', () => {
    expect(
      matchesEmpresaSegment(
        baseItem({
          has_credenciais: true,
          cred_status: 'NAO_TESTADO',
        }),
        'CREDENTIAL_REVALIDATION_REQUIRED'
      )
    ).toBe(true);
    expect(
      matchesEmpresaSegment(
        baseItem({
          has_credenciais: true,
          cred_status: 'OK',
          cred_ultimo_teste_em: new Date().toISOString(),
        }),
        'CREDENTIAL_REVALIDATION_REQUIRED'
      )
    ).toBe(false);
  });

  it('OPERATIONAL inclui aptas (ELIGIBLE e WITH_WARNING)', () => {
    expect(
      matchesEmpresaSegment(
        baseItem({
          has_certificado: true,
          cert_validade: '31/12/2099',
        }),
        'OPERATIONAL'
      )
    ).toBe(true);
    // vencendo = WITH_WARNING = operacional para o card
    const soon = new Date();
    soon.setDate(soon.getDate() + 5);
    const dd = String(soon.getDate()).padStart(2, '0');
    const mm = String(soon.getMonth() + 1).padStart(2, '0');
    const yyyy = soon.getFullYear();
    expect(
      matchesEmpresaSegment(
        baseItem({
          has_certificado: true,
          cert_validade: `${dd}/${mm}/${yyyy}`,
        }),
        'OPERATIONAL'
      )
    ).toBe(true);
  });

  it('NOT_ELIGIBLE exclui empresas com método utilizável', () => {
    expect(
      matchesEmpresaSegment(baseItem({}), 'NOT_ELIGIBLE')
    ).toBe(true);
    expect(
      matchesEmpresaSegment(
        baseItem({
          has_certificado: true,
          cert_validade: '31/12/2099',
        }),
        'NOT_ELIGIBLE'
      )
    ).toBe(false);
  });
});
