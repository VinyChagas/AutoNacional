/**
 * Fixture de controle: valida correlação/transporte/injeção SEM o Portal Nacional.
 * Não comprova aceitação pelo NFSe — apenas separa falhas internas.
 *
 * Executar: npx vitest run src/automation/scripts/control-captcha-flow.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  requestCaptcha,
  resolveCaptcha,
  __resetManualCaptchaStateForTests,
  listPendingByBatch,
} from '../../services/manual-captcha.service';
import {
  fingerprintToken,
  clearAllAttemptsForTests,
  initAttemptReport,
  recordTokenHash,
  getAttemptReport,
} from '../captcha-diagnostic';
import { payloadFingerprint } from '../captcha-diagnostic';
import { getCaptchaProvider } from '../captcha/get-captcha-provider';

describe('controle interno Central Manual (sem portal)', () => {
  beforeEach(() => {
    __resetManualCaptchaStateForTests();
    clearAllAttemptsForTests();
  });

  afterEach(() => {
    __resetManualCaptchaStateForTests();
    clearAllAttemptsForTests();
  });

  it('fluxo simulado: publish → resolve → provider → hash intacto', async () => {
    const attemptId = 'control-attempt-1';
    const batchId = 'control-batch';
    const siteKey = '10000000-ffff-ffff-ffff-000000000001';
    const pageUrl = 'https://www.nfse.gov.br/EmissorNacional/Notas/Emitidas';

    initAttemptReport({
      batchId,
      executionId: 'exec-1',
      empresaId: '42',
      captchaId: 'pending',
      attemptId,
    });

    const solvePromise = getCaptchaProvider('MANUAL').solve({
      batchId,
      executionId: 'exec-1',
      empresaId: '42',
      empresaNome: 'Controle',
      cnpj: '12345678000199',
      siteKey,
      pageUrl,
      attemptId,
      timeoutSeconds: 30,
    });

    const pending = listPendingByBatch(batchId);
    expect(pending).toHaveLength(1);
    const captcha = pending[0];

    const fpPayload = payloadFingerprint({
      captchaId: captcha.captchaId,
      attemptId: captcha.attemptId,
      siteKey,
      pageUrl,
    });
    expect(captcha.payloadFingerprint).toBe(fpPayload);

    const token = 'P0_control_token_simulado_abcdef1234567890';
    const frontendFp = fingerprintToken(token);
    recordTokenHash(attemptId, 'frontend', token);

    const ack = resolveCaptcha({
      batchId,
      captchaId: captcha.captchaId,
      attemptId,
      token,
    });
    expect(ack.ok).toBe(true);
    if (ack.ok) {
      expect(ack.tokenHash).toBe(frontendFp.tokenHash);
    }

    const solution = await solvePromise;
    expect(solution.status).toBe('RESOLVED');
    if (solution.status === 'RESOLVED') {
      expect(solution.token).toBe(token);
      recordTokenHash(attemptId, 'playwright', solution.token);
    }

    const report = getAttemptReport(attemptId)!;
    expect(report.tokenFlow.allHashesMatch).toBe(true);
  });

  it('TwoCaptcha provider permanece selecionável (não afetado)', () => {
    const p = getCaptchaProvider('TWO_CAPTCHA');
    expect(p.mode).toBe('TWO_CAPTCHA');
  });
});
