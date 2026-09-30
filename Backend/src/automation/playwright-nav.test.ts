import { describe, it, expect } from 'vitest';
import {
  isRetryableNavigationError,
  isTargetClosedError,
  PageClosedError,
} from './playwright-nav';

describe('isRetryableNavigationError', () => {
  it('retenta ERR_ABORTED e ERR_TIMED_OUT', () => {
    expect(
      isRetryableNavigationError(
        new Error('page.goto: net::ERR_ABORTED at https://www.nfse.gov.br/')
      )
    ).toBe(true);
    expect(
      isRetryableNavigationError(
        new Error('page.goto: net::ERR_TIMED_OUT at https://www.nfse.gov.br/')
      )
    ).toBe(true);
  });

  it('retenta Timeout exceeded de navegação', () => {
    expect(
      isRetryableNavigationError(
        new Error('page.goto: Timeout 60000ms exceeded.')
      )
    ).toBe(true);
  });

  it('nao retenta Target closed', () => {
    expect(
      isRetryableNavigationError(
        new Error('Target page, context or browser has been closed')
      )
    ).toBe(false);
    expect(isRetryableNavigationError(new PageClosedError())).toBe(false);
  });
});

describe('isTargetClosedError', () => {
  it('detecta context destroyed e browser closed', () => {
    expect(
      isTargetClosedError(
        new Error('page.title: Execution context was destroyed')
      )
    ).toBe(true);
    expect(
      isTargetClosedError(
        new Error('locator.click: Target page, context or browser has been closed')
      )
    ).toBe(true);
  });
});
