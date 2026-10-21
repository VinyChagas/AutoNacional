/**
 * API-02W — estabilização sem networkidle.
 */
import { describe, expect, it, vi } from 'vitest';
import { aguardarEstabilizarPagina } from './playwright-nav';

function pageUsavel(waitForLoadState: ReturnType<typeof vi.fn>) {
  return {
    isClosed: () => false,
    context: () => ({
      browser: () => ({ isConnected: () => true }),
    }),
    waitForLoadState,
  } as unknown as import('playwright').Page;
}

describe('playwright-nav API-02W', () => {
  it('aguardarEstabilizarPagina usa domcontentloaded (não networkidle)', async () => {
    const waitForLoadState = vi.fn(async (state: string) => {
      expect(state).toBe('domcontentloaded');
    });
    await aguardarEstabilizarPagina(pageUsavel(waitForLoadState), 5000);
    expect(waitForLoadState).toHaveBeenCalledTimes(1);
    expect(waitForLoadState.mock.calls[0][0]).toBe('domcontentloaded');
    expect(waitForLoadState.mock.calls[0][0]).not.toBe('networkidle');
  });

  it('aguardarEstabilizarPagina engole timeout (proteção, sem lançar)', async () => {
    const waitForLoadState = vi.fn(async () => {
      throw new Error('Timeout 5000ms exceeded');
    });
    await expect(aguardarEstabilizarPagina(pageUsavel(waitForLoadState), 5000)).resolves.toBeUndefined();
  });
});
