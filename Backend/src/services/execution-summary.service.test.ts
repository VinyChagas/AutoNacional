/**
 * UI-01b — Consistência indicadores / elegibilidade / lista de execução.
 * Testes puros (sem Prisma / sem produção).
 */
import { describe, it, expect } from 'vitest';
import {
  agregarSummaryExecucao,
  escolherMelhorValidadeCertificado,
  normCnpj,
  projetarItemExecucao,
  type EmpresaExecucaoItem,
  type EmpresaProjectionInput,
} from './execution-summary.service';
import { isAutomationEligible } from '../modules/certificados/empresas/empresa-status';

const NOW = new Date('2026-07-20T12:00:00');

function proj(overrides: Partial<EmpresaProjectionInput> & Pick<EmpresaProjectionInput, 'empresa_id' | 'cnpj' | 'razao_social'>): EmpresaExecucaoItem {
  return projetarItemExecucao({
    has_certificado: false,
    cert_validade: null,
    has_credenciais: false,
    cred_status: null,
    cred_ultimo_teste_em: null,
    now: NOW,
    ...overrides,
  });
}

describe('execution-summary — projeção e indicadores (UI-01b)', () => {
  it('1. contabilidade com empresas — total e partições exclusivas', () => {
    const items = [
      proj({
        empresa_id: 1,
        cnpj: '11.111.111/0001-11',
        razao_social: 'A',
        has_certificado: true,
        cert_validade: '31/12/2099',
      }),
      proj({
        empresa_id: 2,
        cnpj: '22.222.222/0001-22',
        razao_social: 'B',
        has_credenciais: true,
        cred_status: 'VALIDA',
        cred_ultimo_teste_em: NOW,
      }),
      proj({
        empresa_id: 3,
        cnpj: '33.333.333/0001-33',
        razao_social: 'C',
      }),
    ];
    const s = agregarSummaryExecucao(items);
    expect(s.total_empresas).toBe(3);
    expect(s.todas).toHaveLength(3);
    expect(
      s.total_operacional + s.total_atencao + s.total_parcial + s.total_inoperante
    ).toBe(s.total_empresas);
    expect(s.total_inoperante).toBe(1);
    expect(s.total_aptas).toBe(2);
    expect(s.aptas).toHaveLength(2);
  });

  it('2. contabilidade sem empresas — zeros e listas vazias', () => {
    const s = agregarSummaryExecucao([]);
    expect(s.total_empresas).toBe(0);
    expect(s.total_aptas).toBe(0);
    expect(s.total_operacional).toBe(0);
    expect(s.total_atencao).toBe(0);
    expect(s.total_parcial).toBe(0);
    expect(s.total_inoperante).toBe(0);
    expect(s.todas).toEqual([]);
    expect(s.aptas).toEqual([]);
    expect(s.inoperantes).toEqual([]);
    expect(s.parciais).toEqual([]);
  });

  it('3. empresa com certificado válido — OPERACIONAL / elegível / CERTIFICADO', () => {
    const item = proj({
      empresa_id: 10,
      cnpj: '12345678000199',
      razao_social: 'Cert OK',
      has_certificado: true,
      cert_validade: '31/12/2099',
    });
    expect(item.status_geral).toBe('OPERACIONAL');
    expect(item.login_metodo).toBe('CERTIFICADO');
    expect(isAutomationEligible(item.automation_eligibility)).toBe(true);
    const s = agregarSummaryExecucao([item]);
    expect(s.aptas).toEqual([item]);
    expect(s.inoperantes).toEqual([]);
  });

  it('4. empresa com credenciais válidas — elegível / CREDENCIAL', () => {
    const item = proj({
      empresa_id: 11,
      cnpj: '12345678000188',
      razao_social: 'Cred OK',
      has_credenciais: true,
      cred_status: 'VALIDA',
      cred_ultimo_teste_em: NOW,
    });
    expect(item.login_metodo).toBe('CREDENCIAL');
    expect(isAutomationEligible(item.automation_eligibility)).toBe(true);
    expect(item.status_geral).not.toBe('INOPERANTE');
    expect(agregarSummaryExecucao([item]).aptas).toHaveLength(1);
  });

  it('5. empresa parcial — permanece elegível e aparece em aptas e parciais', () => {
    const item = proj({
      empresa_id: 12,
      cnpj: '12345678000177',
      razao_social: 'Parcial',
      has_certificado: true,
      cert_validade: '31/12/2099',
      has_credenciais: true,
      cred_status: 'INVALIDA',
    });
    expect(item.status_geral).toBe('PARCIAL');
    expect(isAutomationEligible(item.automation_eligibility)).toBe(true);
    const s = agregarSummaryExecucao([item]);
    expect(s.total_parcial).toBe(1);
    expect(s.total_aptas).toBe(1);
    expect(s.aptas).toContainEqual(item);
    expect(s.parciais).toContainEqual(item);
    // Sobreposição documentada: aptas ∩ parciais ≠ ∅; não somar como exclusivas
    expect(s.total_aptas + s.total_parcial).not.toBe(s.total_empresas);
  });

  it('6. empresa em atenção (cert a vencer) — ATENCAO e elegível', () => {
    const item = proj({
      empresa_id: 13,
      cnpj: '12345678000166',
      razao_social: 'Atenção',
      has_certificado: true,
      // NOW = 2026-07-20 → validade em 10 dias
      cert_validade: '30/07/2026',
    });
    expect(item.status_geral).toBe('ATENCAO');
    expect(isAutomationEligible(item.automation_eligibility)).toBe(true);
    const s = agregarSummaryExecucao([item]);
    expect(s.total_atencao).toBe(1);
    expect(s.total_aptas).toBe(1);
    expect(s.aptas).toHaveLength(1);
  });

  it('7. empresa inoperante — fora de aptas e da fila', () => {
    const item = proj({
      empresa_id: 14,
      cnpj: '12345678000155',
      razao_social: 'Inoperante',
    });
    expect(item.status_geral).toBe('INOPERANTE');
    expect(isAutomationEligible(item.automation_eligibility)).toBe(false);
    const s = agregarSummaryExecucao([item]);
    expect(s.total_aptas).toBe(0);
    expect(s.aptas).toEqual([]);
    expect(s.inoperantes).toEqual([item]);
  });

  it('8. múltiplos certificados no mesmo CNPJ — usa melhor validade', () => {
    const best = escolherMelhorValidadeCertificado([
      { dataValidade: '01/01/2025' },
      { dataValidade: '31/12/2099' },
      { dataValidade: null },
    ]);
    expect(best).toBe('31/12/2099');
    const item = proj({
      empresa_id: 15,
      cnpj: '12345678000144',
      razao_social: 'Multi cert',
      has_certificado: true,
      cert_validade: best,
    });
    expect(item.status_geral).toBe('OPERACIONAL');
  });

  it('9. certificado associado à contabilidade — presença por CNPJ basta para projeção', () => {
    // Mesma regra da tela Empresas: cert resolvido por CNPJ, sem exigir
    // certificado.contabilidadeId === empresa.contabilidadeId na projeção.
    const item = proj({
      empresa_id: 16,
      cnpj: '12345678000133',
      razao_social: 'Cert de outra contab (por CNPJ)',
      has_certificado: true,
      cert_validade: '31/12/2099',
    });
    expect(item.login_metodo).toBe('CERTIFICADO');
    expect(isAutomationEligible(item.automation_eligibility)).toBe(true);
  });

  it('10. deduplicação por CNPJ normalizado na projeção', () => {
    const a = proj({
      empresa_id: 1,
      cnpj: '12.345.678/0001-99',
      razao_social: 'Fmt A',
      has_certificado: true,
      cert_validade: '31/12/2099',
    });
    const b = proj({
      empresa_id: 1,
      cnpj: '12345678000199',
      razao_social: 'Fmt B',
      has_certificado: true,
      cert_validade: '31/12/2099',
    });
    expect(normCnpj(a.cnpj)).toBe(normCnpj(b.cnpj));
    expect(a.cnpj).toBe(b.cnpj);
  });

  it('11. indicadores vs lista — total_aptas === aptas.length; partições exclusivas', () => {
    const items = [
      proj({
        empresa_id: 1,
        cnpj: '10000000000101',
        razao_social: 'Op',
        has_certificado: true,
        cert_validade: '31/12/2099',
      }),
      proj({
        empresa_id: 2,
        cnpj: '10000000000102',
        razao_social: 'At',
        has_certificado: true,
        cert_validade: '30/07/2026',
      }),
      proj({
        empresa_id: 3,
        cnpj: '10000000000103',
        razao_social: 'Pa',
        has_certificado: true,
        cert_validade: '31/12/2099',
        has_credenciais: true,
        cred_status: 'INVALIDA',
      }),
      proj({
        empresa_id: 4,
        cnpj: '10000000000104',
        razao_social: 'In',
      }),
    ];
    const s = agregarSummaryExecucao(items);
    expect(s.total_aptas).toBe(s.aptas.length);
    expect(s.total_parcial).toBe(s.parciais.length);
    expect(s.total_inoperante).toBe(s.inoperantes.length);
    expect(s.todas.length).toBe(s.total_empresas);
    expect(
      s.total_operacional + s.total_atencao + s.total_parcial + s.total_inoperante
    ).toBe(4);
    // Aptas inclui operacional + atenção + parcial (elegíveis)
    expect(s.total_aptas).toBe(3);
    expect(s.aptas.every((i) => isAutomationEligible(i.automation_eligibility))).toBe(true);
    expect(s.aptas.some((i) => i.status_geral === 'INOPERANTE')).toBe(false);
  });

  it('12. lista vs payload de execução — aptas espelha o que a fila deve enviar', () => {
    const items = [
      proj({
        empresa_id: 21,
        cnpj: '21000000000101',
        razao_social: 'Ok',
        has_certificado: true,
        cert_validade: '31/12/2099',
      }),
      proj({
        empresa_id: 22,
        cnpj: '21000000000102',
        razao_social: 'Parcial elegível',
        has_certificado: true,
        cert_validade: '31/12/2099',
        has_credenciais: true,
        cred_status: 'INVALIDA',
      }),
      proj({
        empresa_id: 23,
        cnpj: '21000000000103',
        razao_social: 'Bloqueada',
      }),
    ];
    const s = agregarSummaryExecucao(items);
    // Simula payload: só ids elegíveis (como listarEmpresasAptas / summary.aptas)
    const payloadEmpresaIds = s.aptas.map((a) => a.empresa_id);
    expect(payloadEmpresaIds).toEqual([21, 22]);
    expect(payloadEmpresaIds).not.toContain(23);
    expect(s.total_aptas).toBe(payloadEmpresaIds.length);
  });

  it('13. troca de contabilidade — agregações independentes por conjunto de itens', () => {
    const contabA = agregarSummaryExecucao([
      proj({
        empresa_id: 1,
        cnpj: '31000000000101',
        razao_social: 'A1',
        has_certificado: true,
        cert_validade: '31/12/2099',
      }),
    ]);
    const contabB = agregarSummaryExecucao([
      proj({ empresa_id: 2, cnpj: '32000000000101', razao_social: 'B1' }),
      proj({ empresa_id: 3, cnpj: '32000000000102', razao_social: 'B2' }),
    ]);
    expect(contabA.total_empresas).toBe(1);
    expect(contabA.total_aptas).toBe(1);
    expect(contabB.total_empresas).toBe(2);
    expect(contabB.total_aptas).toBe(0);
    expect(contabB.total_inoperante).toBe(2);
  });

  it('14. atualização dos indicadores — re-agregar após mudança de status', () => {
    const antes = agregarSummaryExecucao([
      proj({ empresa_id: 1, cnpj: '41000000000101', razao_social: 'X' }),
    ]);
    expect(antes.total_aptas).toBe(0);
    expect(antes.total_inoperante).toBe(1);

    const depois = agregarSummaryExecucao([
      proj({
        empresa_id: 1,
        cnpj: '41000000000101',
        razao_social: 'X',
        has_credenciais: true,
        cred_status: 'VALIDA',
        cred_ultimo_teste_em: NOW,
      }),
    ]);
    expect(depois.total_inoperante).toBe(0);
    expect(depois.total_aptas).toBe(1);
    expect(depois.aptas[0].empresa_id).toBe(1);
  });
});
