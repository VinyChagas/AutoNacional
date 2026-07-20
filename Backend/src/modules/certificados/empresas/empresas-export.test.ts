import { describe, it, expect } from 'vitest';
import {
  assertExportRowHasNoSecrets,
  buildExportFilename,
  buildExportResumo,
  buildEmpresasWorkbookBuffer,
  filterEmpresasForReport,
  parseEmpresaExportReport,
  toExportRow,
} from './empresas-export';
import type { EmpresaAgregada } from './empresas.repo';
import { computeOperationalSnapshot } from './empresa-status';

function makeItem(
  overrides: Partial<EmpresaAgregada> & {
    has_certificado?: boolean;
    cert_validade?: string | null;
    has_credenciais?: boolean;
    cred_status?: string | null;
  } = {}
): EmpresaAgregada {
  const hasCert = overrides.has_certificado ?? false;
  const certVal = overrides.cert_validade ?? null;
  const hasCred = overrides.has_credenciais ?? false;
  const credStat = overrides.cred_status ?? null;
  const snap = computeOperationalSnapshot({
    has_certificado: hasCert,
    cert_validade: certVal,
    has_credenciais: hasCred,
    cred_status: credStat,
    cred_ultimo_teste_em: overrides.cred_ultimo_teste_em ?? null,
    now: new Date('2026-07-20T12:00:00'),
  });

  return {
    id: overrides.id ?? 1,
    cnpj: overrides.cnpj ?? '12345678000199',
    razao_social: overrides.razao_social ?? 'Empresa Teste',
    regime: null,
    contabilidade_id: overrides.contabilidade_id ?? 1,
    contabilidade_nome: overrides.contabilidade_nome ?? 'Contab A',
    ativo: true,
    created_at: new Date(),
    updated_at: new Date(),
    has_certificado: hasCert,
    cert_validade: certVal,
    has_credenciais: hasCred,
    cred_status: credStat,
    cred_ultimo_teste_em: overrides.cred_ultimo_teste_em ?? null,
    cred_ultima_mensagem: overrides.cred_ultima_mensagem ?? null,
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
}

describe('parseEmpresaExportReport', () => {
  it('aceita reports válidos', () => {
    expect(parseEmpresaExportReport('not_eligible')).toBe('NOT_ELIGIBLE');
    expect(parseEmpresaExportReport('ALL_PENDING')).toBe('ALL_PENDING');
    expect(parseEmpresaExportReport('FILTERED')).toBe('FILTERED');
  });

  it('rejeita inválidos', () => {
    expect(parseEmpresaExportReport(undefined)).toBeNull();
    expect(parseEmpresaExportReport('foo')).toBeNull();
  });
});

describe('filterEmpresasForReport', () => {
  const eligible = makeItem({
    has_certificado: true,
    cert_validade: '31/12/2099',
  });
  const notEligible = makeItem({
    has_certificado: true,
    cert_validade: '01/01/2020',
  });
  const pendingEligible = makeItem({
    has_certificado: true,
    cert_validade: '01/01/2020',
    has_credenciais: true,
    cred_status: 'OK',
    cred_ultimo_teste_em: new Date('2026-07-18').toISOString(),
  });

  it('NOT_ELIGIBLE só retorna não aptas', () => {
    const out = filterEmpresasForReport(
      [eligible, notEligible, pendingEligible],
      'NOT_ELIGIBLE'
    );
    expect(out.every((i) => i.automation_eligibility === 'NOT_ELIGIBLE')).toBe(true);
    expect(out).toContainEqual(notEligible);
    expect(out).not.toContainEqual(eligible);
    expect(out).not.toContainEqual(pendingEligible);
  });

  it('ALL_PENDING inclui pendências mesmo aptas', () => {
    const out = filterEmpresasForReport(
      [eligible, notEligible, pendingEligible],
      'ALL_PENDING'
    );
    expect(out).toContainEqual(notEligible);
    expect(out).toContainEqual(pendingEligible);
    expect(out).not.toContainEqual(eligible);
  });

  it('FILTERED preserva todos', () => {
    const all = [eligible, notEligible];
    expect(filterEmpresasForReport(all, 'FILTERED')).toEqual(all);
  });
});

describe('toExportRow / secrets', () => {
  it('não inclui campos de senha ou arquivo', () => {
    const row = toExportRow(makeItem({ has_certificado: true, cert_validade: '31/12/2099' }), new Date());
    assertExportRowHasNoSecrets(row);
    expect(Object.keys(row)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/senha|password|arquivo/i)])
    );
  });
});

describe('buildExportFilename', () => {
  it('gera nome com prefixo e data', () => {
    const name = buildExportFilename(
      'NOT_ELIGIBLE',
      new Date('2026-07-20T12:30:00')
    );
    expect(name).toBe('empresas_nao_aptas_2026-07-20_1230.xlsx');
  });
});

describe('buildExportResumo + workbook', () => {
  it('resumo e workbook alinhados ao conjunto filtrado', () => {
    const items = [
      makeItem({
        id: 1,
        has_certificado: true,
        cert_validade: '01/01/2020',
        contabilidade_nome: 'A',
      }),
      makeItem({
        id: 2,
        has_certificado: true,
        cert_validade: '01/01/2020',
        contabilidade_nome: 'A',
      }),
    ];
    const filtered = filterEmpresasForReport(items, 'NOT_ELIGIBLE');
    const resumo = buildExportResumo(filtered);
    expect(resumo.total_exportado).toBe(filtered.length);
    expect(resumo.certificados_vencidos).toBe(filtered.length);
    expect(resumo.por_contabilidade['A']).toBe(filtered.length);

    const buf = buildEmpresasWorkbookBuffer(filtered, new Date('2026-07-20T12:00:00'));
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(100);
  });
});
