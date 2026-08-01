/**
 * Testes unitários da Central Manual (lógica de cards / ack).
 * Não renderiza hCaptcha real nem conecta Socket.IO ao backend.
 */
import { CaptchaCentralService } from './captcha-central.service';
import type { ManualCaptchaRequest } from '../models/manual-captcha.model';

describe('CaptchaCentralService (helpers de estado)', () => {
  it('deve iniciar desconectado sem batch', () => {
    const zone = { run: (fn: () => void) => fn() } as unknown as import('@angular/core').NgZone;
    const svc = new CaptchaCentralService(zone);
    expect(svc.batchId).toBeNull();
  });
});

describe('ManualCaptchaRequest contrato', () => {
  it('exige campos mínimos para widget', () => {
    const req: ManualCaptchaRequest = {
      captchaId: 'c1',
      batchId: 'b1',
      executionId: 'e1',
      empresaId: '10',
      empresaNome: 'ACME',
      cnpj: '12345678000199',
      siteKey: 'sitekey',
      pageUrl: 'https://example.com',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 120000).toISOString(),
      timeoutSeconds: 120,
    };
    expect(req.siteKey).toBeTruthy();
    expect(req.captchaId).toBe('c1');
    expect(req.timeoutSeconds).toBe(120);
  });
});

describe('Regras da tela de execução (captchaMode)', () => {
  it('botão da Central só com MANUAL + batchId', () => {
    const podeAbrir = (captchaMode: string, batchId: string | null) =>
      captchaMode === 'MANUAL' && !!batchId;
    expect(podeAbrir('TWO_CAPTCHA', 'uuid')).toBe(false);
    expect(podeAbrir('MANUAL', null)).toBe(false);
    expect(podeAbrir('MANUAL', 'uuid')).toBe(true);
  });

  it('Resolver exige token', () => {
    const canResolve = (token?: string, status?: string) =>
      !!token && (status === 'token_ready' || status === 'error');
    expect(canResolve(undefined, 'token_ready')).toBe(false);
    expect(canResolve('tok', 'waiting')).toBe(false);
    expect(canResolve('tok', 'token_ready')).toBe(true);
  });
});
