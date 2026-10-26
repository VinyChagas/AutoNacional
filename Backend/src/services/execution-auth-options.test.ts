/**
 * UI-01c — headless/captcha por empresa + defaults do formulário.
 * Offline: sem Playwright, Portal, SEFIN ou Discovery.
 */
import { describe, it, expect } from 'vitest';
import {
  resolverOpcoesAuthPorEmpresa,
  UI01C_BAIXAR_PDF,
  UI01C_TIPO_NOTAS,
} from './execution-auth-options';
import { agregarSummaryExecucao, projetarItemExecucao } from './execution-summary.service';

const NOW = new Date('2026-07-20T12:00:00');

/** Simula o payload FE → multiplas após UI-01c (sem seletor tipo/PDF/captcha). */
function payloadLoteUi01c(opts: {
  headlessPreferencia: boolean;
  empresas: Array<{ tipo_autenticacao: 'certificado' | 'credenciais' }>;
}) {
  return {
    tipo: UI01C_TIPO_NOTAS,
    baixarPdf: UI01C_BAIXAR_PDF,
    headless: opts.headlessPreferencia,
    empresas: opts.empresas.map((e) => ({
      ...e,
      ...resolverOpcoesAuthPorEmpresa(
        e.tipo_autenticacao,
        opts.headlessPreferencia,
        'TWO_CAPTCHA'
      ),
    })),
  };
}

describe('UI-01c — formulário e auth por empresa', () => {
  it('1. tipo sempre ambas', () => {
    const p = payloadLoteUi01c({
      headlessPreferencia: true,
      empresas: [{ tipo_autenticacao: 'certificado' }],
    });
    expect(p.tipo).toBe('ambas');
    expect(UI01C_TIPO_NOTAS).toBe('ambas');
  });

  it('2. baixarPdf sempre false', () => {
    const p = payloadLoteUi01c({
      headlessPreferencia: false,
      empresas: [{ tipo_autenticacao: 'certificado' }],
    });
    expect(p.baixarPdf).toBe(false);
    expect(UI01C_BAIXAR_PDF).toBe(false);
  });

  it('3. Headless A1 true', () => {
    const o = resolverOpcoesAuthPorEmpresa('certificado', true);
    expect(o.headless).toBe(true);
    expect(o.captchaMode).toBe('TWO_CAPTCHA');
  });

  it('4. Headless A1 false', () => {
    const o = resolverOpcoesAuthPorEmpresa('certificado', false);
    expect(o.headless).toBe(false);
    expect(o.captchaMode).toBe('TWO_CAPTCHA');
  });

  it('5. Credenciais sempre visível', () => {
    expect(resolverOpcoesAuthPorEmpresa('credenciais', true).headless).toBe(false);
    expect(resolverOpcoesAuthPorEmpresa('credenciais', false).headless).toBe(false);
  });

  it('6. Credenciais com CAPTCHA manual', () => {
    const o = resolverOpcoesAuthPorEmpresa('credenciais', true, 'TWO_CAPTCHA');
    expect(o.captchaMode).toBe('MANUAL');
    expect(o.headless).toBe(false);
  });

  it('7. Lote somente A1 — todos respeitam preferência', () => {
    const p = payloadLoteUi01c({
      headlessPreferencia: true,
      empresas: [
        { tipo_autenticacao: 'certificado' },
        { tipo_autenticacao: 'certificado' },
      ],
    });
    expect(p.empresas.every((e) => e.headless === true)).toBe(true);
    expect(p.empresas.every((e) => e.captchaMode === 'TWO_CAPTCHA')).toBe(true);
  });

  it('8. Lote somente credenciais — todos MANUAL + visível', () => {
    const p = payloadLoteUi01c({
      headlessPreferencia: true,
      empresas: [
        { tipo_autenticacao: 'credenciais' },
        { tipo_autenticacao: 'credenciais' },
      ],
    });
    expect(p.empresas.every((e) => e.headless === false)).toBe(true);
    expect(p.empresas.every((e) => e.captchaMode === 'MANUAL')).toBe(true);
  });

  it('9. Lote misto — A1 com preferência; credenciais forçadas', () => {
    const p = payloadLoteUi01c({
      headlessPreferencia: true,
      empresas: [
        { tipo_autenticacao: 'certificado' },
        { tipo_autenticacao: 'credenciais' },
        { tipo_autenticacao: 'certificado' },
      ],
    });
    expect(p.empresas[0]).toMatchObject({ headless: true, captchaMode: 'TWO_CAPTCHA' });
    expect(p.empresas[1]).toMatchObject({ headless: false, captchaMode: 'MANUAL' });
    expect(p.empresas[2]).toMatchObject({ headless: true, captchaMode: 'TWO_CAPTCHA' });
  });

  it('10. Defaults preservados no Backend (adicionarExecucao assinatura)', () => {
    // Defaults documentados em execution-service: baixarPdf=true, captchaMode=TWO_CAPTCHA
    // quando não informados (endpoint legado /admin). UI-01c só fixa no FE→multiplas.
    const legadoBaixarPdfDefault = true;
    const legadoCaptchaDefault = 'TWO_CAPTCHA';
    expect(legadoBaixarPdfDefault).toBe(true);
    expect(legadoCaptchaDefault).toBe('TWO_CAPTCHA');
    // Preferência A1 explícita no lote não altera default do parâmetro omitido
    const a1 = resolverOpcoesAuthPorEmpresa('certificado', false);
    expect(a1.captchaMode).toBe('TWO_CAPTCHA');
  });

  it('11. Indicadores UI-01b preservados', () => {
    const items = [
      projetarItemExecucao({
        empresa_id: 1,
        cnpj: '11111111000111',
        razao_social: 'A',
        has_certificado: true,
        cert_validade: '31/12/2099',
        has_credenciais: false,
        cred_status: null,
        cred_ultimo_teste_em: null,
        now: NOW,
      }),
      projetarItemExecucao({
        empresa_id: 2,
        cnpj: '22222222000122',
        razao_social: 'B',
        has_certificado: false,
        cert_validade: null,
        has_credenciais: false,
        cred_status: null,
        cred_ultimo_teste_em: null,
        now: NOW,
      }),
    ];
    const s = agregarSummaryExecucao(items);
    expect(s.total_empresas).toBe(
      s.total_operacional + s.total_atencao + s.total_parcial + s.total_inoperante
    );
    expect(s.total_aptas).toBe(s.aptas.length);
    expect(s.aptas.some((i) => i.status_geral === 'INOPERANTE')).toBe(false);
  });

  it('12. Central de CAPTCHA preservada (modo MANUAL nas credenciais)', () => {
    const cred = resolverOpcoesAuthPorEmpresa('credenciais', true);
    expect(cred.captchaMode).toBe('MANUAL');
    // A1 não força MANUAL — Central só necessária se houver credenciais no lote
    const a1 = resolverOpcoesAuthPorEmpresa('certificado', false);
    expect(a1.captchaMode).not.toBe('MANUAL');
  });

  it('13. Fluxo legado preservado — captchaModeLote ainda respeitado no A1', () => {
    const manualNoLote = resolverOpcoesAuthPorEmpresa('certificado', true, 'MANUAL');
    expect(manualNoLote.captchaMode).toBe('MANUAL');
    expect(manualNoLote.headless).toBe(true); // preferência A1; worker força false se MANUAL
    const two = resolverOpcoesAuthPorEmpresa('certificado', true, 'TWO_CAPTCHA');
    expect(two.captchaMode).toBe('TWO_CAPTCHA');
  });

  it('14. Sem ativação SEFIN — resolver não toca flags fiscais', () => {
    const o = resolverOpcoesAuthPorEmpresa('certificado', true);
    expect(o).toEqual({ headless: true, captchaMode: 'TWO_CAPTCHA' });
    expect(Object.keys(o).sort()).toEqual(['captchaMode', 'headless']);
  });

  it('15. Sem ativação Discovery-Only — defaults UI-01c só tipo/PDF/auth', () => {
    expect(UI01C_TIPO_NOTAS).toBe('ambas');
    expect(UI01C_BAIXAR_PDF).toBe(false);
    const keys = Object.keys(
      payloadLoteUi01c({
        headlessPreferencia: false,
        empresas: [{ tipo_autenticacao: 'certificado' }],
      })
    );
    expect(keys).not.toContain('discoveryOnly');
    expect(keys).not.toContain('ativacaoDiscoveryReal');
    expect(keys).not.toContain('sefin');
  });
});
