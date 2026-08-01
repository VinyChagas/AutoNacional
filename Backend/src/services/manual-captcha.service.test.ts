import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  requestCaptcha,
  resolveCaptcha,
  skipCaptcha,
  cancelByExecution,
  cancelByBatch,
  listPendingByBatch,
  __resetManualCaptchaStateForTests,
  __getPendingCountForTests,
} from './manual-captcha.service';

describe('manual-captcha.service', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetManualCaptchaStateForTests();
  });

  afterEach(() => {
    __resetManualCaptchaStateForTests();
    vi.useRealTimers();
  });

  const baseRequest = {
    batchId: 'batch-1',
    executionId: 'exec-1',
    empresaId: '10',
    empresaNome: 'Empresa Teste',
    cnpj: '12345678000199',
    siteKey: 'sitekey-test',
    pageUrl: 'https://www.nfse.gov.br/EmissorNacional/',
    timeoutSeconds: 120,
  };

  it('cria captcha manual e lista no lote', async () => {
    const promise = requestCaptcha(baseRequest);
    const pending = listPendingByBatch('batch-1');
    expect(pending).toHaveLength(1);
    expect(pending[0].siteKey).toBe('sitekey-test');
    expect(__getPendingCountForTests()).toBe(1);

    // evita Promise pendente no teardown
    resolveCaptcha({
      batchId: 'batch-1',
      captchaId: pending[0].captchaId,
      token: 'token-abc',
    });
    await promise;
  });

  it('resolve com sucesso e limpa memória', async () => {
    const promise = requestCaptcha(baseRequest);
    const captchaId = listPendingByBatch('batch-1')[0].captchaId;

    const ack = resolveCaptcha({
      batchId: 'batch-1',
      captchaId,
      token: 'token-valido-123456',
    });
    expect(ack.ok).toBe(true);

    const result = await promise;
    expect(result.status).toBe('RESOLVED');
    if (result.status === 'RESOLVED') {
      expect(result.token).toBe('token-valido-123456');
      expect(result.captchaId).toBe(captchaId);
    }
    expect(__getPendingCountForTests()).toBe(0);
    expect(listPendingByBatch('batch-1')).toHaveLength(0);
  });

  it('rejeita token vazio', async () => {
    const promise = requestCaptcha(baseRequest);
    const captchaId = listPendingByBatch('batch-1')[0].captchaId;
    const ack = resolveCaptcha({ batchId: 'batch-1', captchaId, token: '   ' });
    expect(ack.ok).toBe(false);
    if (!ack.ok) expect(ack.error).toBe('EMPTY_TOKEN');
    expect(__getPendingCountForTests()).toBe(1);

    skipCaptcha({ batchId: 'batch-1', captchaId });
    await promise;
  });

  it('rejeita captcha inexistente', () => {
    const ack = resolveCaptcha({
      batchId: 'batch-1',
      captchaId: 'nao-existe',
      token: 'token',
    });
    expect(ack.ok).toBe(false);
    if (!ack.ok) expect(ack.error).toBe('CAPTCHA_NOT_FOUND');
  });

  it('rejeita resposta duplicada', async () => {
    const promise = requestCaptcha(baseRequest);
    const captchaId = listPendingByBatch('batch-1')[0].captchaId;
    expect(resolveCaptcha({ batchId: 'batch-1', captchaId, token: 't1' }).ok).toBe(true);
    const second = resolveCaptcha({ batchId: 'batch-1', captchaId, token: 't2' });
    expect(second.ok).toBe(false);
    await promise;
  });

  it('pula captcha e limpa', async () => {
    const promise = requestCaptcha(baseRequest);
    const captchaId = listPendingByBatch('batch-1')[0].captchaId;
    const ack = skipCaptcha({ batchId: 'batch-1', captchaId });
    expect(ack.ok).toBe(true);
    const result = await promise;
    expect(result.status).toBe('SKIPPED');
    expect(__getPendingCountForTests()).toBe(0);
  });

  it('timeout de 120s com fake timers', async () => {
    const promise = requestCaptcha({ ...baseRequest, timeoutSeconds: 120 });
    expect(__getPendingCountForTests()).toBe(1);

    await vi.advanceTimersByTimeAsync(120_000);

    const result = await promise;
    expect(result.status).toBe('TIMEOUT');
    expect(__getPendingCountForTests()).toBe(0);
  });

  it('limpa por execução', async () => {
    const p1 = requestCaptcha(baseRequest);
    const p2 = requestCaptcha({
      ...baseRequest,
      executionId: 'exec-2',
      empresaId: '20',
    });
    expect(__getPendingCountForTests()).toBe(2);

    cancelByExecution('exec-1');
    const r1 = await p1;
    expect(r1.status).toBe('CANCELLED');
    expect(__getPendingCountForTests()).toBe(1);

    cancelByExecution('exec-2');
    await p2;
  });

  it('limpa por lote', async () => {
    const p1 = requestCaptcha(baseRequest);
    const p2 = requestCaptcha({
      ...baseRequest,
      batchId: 'batch-2',
      executionId: 'exec-9',
    });
    cancelByBatch('batch-1');
    expect((await p1).status).toBe('CANCELLED');
    expect(listPendingByBatch('batch-1')).toHaveLength(0);
    expect(listPendingByBatch('batch-2')).toHaveLength(1);
    cancelByBatch('batch-2');
    await p2;
  });

  it('dois captchas simultâneos resolvem a Promise correta', async () => {
    const pA = requestCaptcha({
      ...baseRequest,
      executionId: 'exec-a',
      empresaId: '1',
      empresaNome: 'A',
    });
    const pB = requestCaptcha({
      ...baseRequest,
      executionId: 'exec-b',
      empresaId: '2',
      empresaNome: 'B',
    });
    const list = listPendingByBatch('batch-1');
    expect(list).toHaveLength(2);
    const idA = list.find((c) => c.executionId === 'exec-a')!.captchaId;
    const idB = list.find((c) => c.executionId === 'exec-b')!.captchaId;

    resolveCaptcha({ batchId: 'batch-1', captchaId: idB, token: 'token-B' });
    resolveCaptcha({ batchId: 'batch-1', captchaId: idA, token: 'token-A' });

    const [ra, rb] = await Promise.all([pA, pB]);
    expect(ra.status).toBe('RESOLVED');
    expect(rb.status).toBe('RESOLVED');
    if (ra.status === 'RESOLVED') expect(ra.token).toBe('token-A');
    if (rb.status === 'RESOLVED') expect(rb.token).toBe('token-B');
  });

  it('rejeita lote incorreto', async () => {
    const promise = requestCaptcha(baseRequest);
    const captchaId = listPendingByBatch('batch-1')[0].captchaId;
    const ack = resolveCaptcha({
      batchId: 'outro-lote',
      captchaId,
      token: 'token',
    });
    expect(ack.ok).toBe(false);
    if (!ack.ok) expect(ack.error).toBe('BATCH_MISMATCH');
    skipCaptcha({ batchId: 'batch-1', captchaId });
    await promise;
  });
});
