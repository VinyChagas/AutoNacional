import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  fingerprintToken,
  payloadFingerprint,
  clearAllAttemptsForTests,
  initAttemptReport,
  recordTokenHash,
  getAttemptReport,
  classifyFromPortalResult,
} from './captcha-diagnostic';
import {
  requestCaptcha,
  resolveCaptcha,
  skipCaptcha,
  __resetManualCaptchaStateForTests,
  listPendingByBatch,
} from '../services/manual-captcha.service';

describe('captcha-diagnostic', () => {
  beforeEach(() => {
    clearAllAttemptsForTests();
    __resetManualCaptchaStateForTests();
  });

  afterEach(() => {
    clearAllAttemptsForTests();
    __resetManualCaptchaStateForTests();
  });

  it('fingerprintToken gera length/hash/preview sem token completo', () => {
    const fp = fingerprintToken('P0_abcdefghijklmnopqrstuvwxyz0123456789');
    expect(fp.tokenLength).toBeGreaterThan(20);
    expect(fp.tokenHash).toHaveLength(16);
    expect(fp.tokenPreview).toContain('...');
    expect(fp.tokenPreview).not.toContain('abcdefghijklmnopqrstuvwxyz');
  });

  it('payloadFingerprint é estável', () => {
    const a = payloadFingerprint({
      captchaId: 'c1',
      attemptId: 'a1',
      siteKey: 'sk',
      pageUrl: 'https://www.nfse.gov.br/x',
      rqdata: 'rq',
      action: 'act',
    });
    const b = payloadFingerprint({
      captchaId: 'c1',
      attemptId: 'a1',
      siteKey: 'sk',
      pageUrl: 'https://www.nfse.gov.br/x',
      rqdata: 'rq',
      action: 'act',
    });
    expect(a).toBe(b);
    expect(a).toHaveLength(24);
  });

  it('hashes iguais em todas as camadas', () => {
    const attemptId = 'att-1';
    initAttemptReport({
      batchId: 'b',
      executionId: 'e',
      empresaId: '1',
      captchaId: 'c',
      attemptId,
    });
    const token = 'token-integridade-1234567890';
    recordTokenHash(attemptId, 'frontend', token);
    recordTokenHash(attemptId, 'socket', token);
    recordTokenHash(attemptId, 'service', token);
    recordTokenHash(attemptId, 'provider', token);
    recordTokenHash(attemptId, 'playwright', token);
    const report = getAttemptReport(attemptId)!;
    expect(report.tokenFlow.allHashesMatch).toBe(true);
    expect(report.tokenFlow.frontendHash).toBe(report.tokenFlow.playwrightHash);
  });

  it('detecta divergência de hash', () => {
    const attemptId = 'att-2';
    initAttemptReport({
      batchId: 'b',
      executionId: 'e',
      empresaId: '1',
      captchaId: 'c',
      attemptId,
    });
    recordTokenHash(attemptId, 'frontend', 'token-A-xxxxxxxx');
    recordTokenHash(attemptId, 'playwright', 'token-B-yyyyyyyy');
    expect(getAttemptReport(attemptId)!.tokenFlow.allHashesMatch).toBe(false);
  });

  it('classifica REJECTED e NO_REQUEST_SENT', () => {
    expect(classifyFromPortalResult('REJECTED', true).classification).toContain(
      'Token rejeitado'
    );
    expect(classifyFromPortalResult('NO_REQUEST_SENT', true).classification).toContain(
      'Callback'
    );
  });

  it('cinco captchas simultâneos resolvem Promises corretas', async () => {
    vi.useFakeTimers();
    const promises = Array.from({ length: 5 }, (_, i) =>
      requestCaptcha({
        batchId: 'batch-multi',
        executionId: `exec-${i}`,
        empresaId: String(i),
        empresaNome: `Emp ${i}`,
        cnpj: `1234567800010${i}`,
        siteKey: 'sitekey',
        pageUrl: 'https://www.nfse.gov.br/EmissorNacional/',
        attemptId: `attempt-${i}`,
        timeoutSeconds: 120,
      })
    );
    const pending = listPendingByBatch('batch-multi');
    expect(pending).toHaveLength(5);

    for (let i = 0; i < 5; i++) {
      const captcha = pending.find((p) => p.executionId === `exec-${i}`)!;
      resolveCaptcha({
        batchId: 'batch-multi',
        captchaId: captcha.captchaId,
        attemptId: captcha.attemptId,
        token: `token-empresa-${i}-xxxxxxxxxxxx`,
      });
    }

    const results = await Promise.all(promises);
    for (let i = 0; i < 5; i++) {
      expect(results[i].status).toBe('RESOLVED');
      if (results[i].status === 'RESOLVED') {
        expect(results[i].token).toBe(`token-empresa-${i}-xxxxxxxxxxxx`);
        expect(results[i].attemptId).toBe(`attempt-${i}`);
      }
    }
    vi.useRealTimers();
  });

  it('resposta após timeout é rejeitada', async () => {
    vi.useFakeTimers();
    const p = requestCaptcha({
      batchId: 'b-to',
      executionId: 'e',
      empresaId: '1',
      empresaNome: 'X',
      cnpj: '12345678000199',
      siteKey: 'sk',
      pageUrl: 'https://www.nfse.gov.br/',
      timeoutSeconds: 2,
    });
    const captchaId = listPendingByBatch('b-to')[0].captchaId;
    await vi.advanceTimersByTimeAsync(2000);
    const result = await p;
    expect(result.status).toBe('TIMEOUT');
    const ack = resolveCaptcha({
      batchId: 'b-to',
      captchaId,
      token: 'tardio-token-xxxxxxxxx',
    });
    expect(ack.ok).toBe(false);
    vi.useRealTimers();
  });

  it('captcha antigo não resolve tentativa nova', async () => {
    const p1 = requestCaptcha({
      batchId: 'b',
      executionId: 'e',
      empresaId: '1',
      empresaNome: 'X',
      cnpj: '12345678000199',
      siteKey: 'sk',
      pageUrl: 'https://www.nfse.gov.br/',
      attemptId: 'old',
    });
    const id1 = listPendingByBatch('b')[0].captchaId;
    skipCaptcha({ batchId: 'b', captchaId: id1 });
    await p1;

    const p2 = requestCaptcha({
      batchId: 'b',
      executionId: 'e',
      empresaId: '1',
      empresaNome: 'X',
      cnpj: '12345678000199',
      siteKey: 'sk',
      pageUrl: 'https://www.nfse.gov.br/',
      attemptId: 'new',
    });
    const id2 = listPendingByBatch('b')[0].captchaId;
    const ack = resolveCaptcha({
      batchId: 'b',
      captchaId: id1,
      attemptId: 'old',
      token: 'token-antigo-xxxxxxxxx',
    });
    expect(ack.ok).toBe(false);

    resolveCaptcha({
      batchId: 'b',
      captchaId: id2,
      attemptId: 'new',
      token: 'token-novo-xxxxxxxxxxxx',
    });
    const r2 = await p2;
    expect(r2.status).toBe('RESOLVED');
  });

  it('ack de resolve inclui hash diagnóstico', async () => {
    const p = requestCaptcha({
      batchId: 'b-ack',
      executionId: 'e',
      empresaId: '1',
      empresaNome: 'X',
      cnpj: '12345678000199',
      siteKey: 'sk',
      pageUrl: 'https://www.nfse.gov.br/',
      attemptId: 'att-ack',
    });
    const captchaId = listPendingByBatch('b-ack')[0].captchaId;
    const token = 'token-ack-diagnostico-12345';
    const expected = fingerprintToken(token);
    const ack = resolveCaptcha({
      batchId: 'b-ack',
      captchaId,
      attemptId: 'att-ack',
      token,
    });
    expect(ack.ok).toBe(true);
    if (ack.ok) {
      expect(ack.tokenHash).toBe(expected.tokenHash);
      expect(ack.tokenLength).toBe(expected.tokenLength);
      expect(ack.attemptId).toBe('att-ack');
    }
    await p;
  });
});
