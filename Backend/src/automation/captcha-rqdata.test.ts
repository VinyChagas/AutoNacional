import { describe, it, expect } from 'vitest';

/**
 * Espelha a regra de normalizeRqdata do captcha-solver
 * (rqdata só com conteúdo real — nunca "" / null / c.req).
 */
function normalizeRqdata(value?: string | null): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function buildTask(rqdata?: string | null): Record<string, unknown> {
  const task: Record<string, unknown> = {
    type: 'HCaptchaTaskProxyless',
    websiteURL: 'https://example.com',
    websiteKey: 'sitekey',
  };
  const rq = normalizeRqdata(rqdata);
  if (rq) {
    task.enterprisePayload = { rqdata: rq };
  }
  return task;
}

describe('rqdata opcional no payload 2Captcha', () => {
  it('omite enterprisePayload quando rqdata ausente', () => {
    const t = buildTask(undefined);
    expect(t.enterprisePayload).toBeUndefined();
  });

  it('omite enterprisePayload quando string vazia', () => {
    const t = buildTask('   ');
    expect(t.enterprisePayload).toBeUndefined();
  });

  it('omite quando null', () => {
    const t = buildTask(null);
    expect(t.enterprisePayload).toBeUndefined();
  });

  it('inclui enterprisePayload apenas com valor real', () => {
    const t = buildTask('abc123real');
    expect(t.enterprisePayload).toEqual({ rqdata: 'abc123real' });
  });

  it('nao usa c.req como substituto', () => {
    // c.req nunca entra no builder — payload sem enterprisePayload
    const t = buildTask(undefined);
    expect(JSON.stringify(t)).not.toContain('c.req');
    expect(t).not.toHaveProperty('enterprisePayload');
  });
});
