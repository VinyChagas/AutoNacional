import { describe, it, expect, beforeEach } from 'vitest';
import { CaptchaError } from './captcha-solver';
import {
  classificarErroDaOperacao,
  extractErrorCode,
  maskNfseKey,
  CaptchaModalCloseError,
  NotaNaoEncontradaParaRetryError,
} from './download-operation-types';
import {
  _resetExecutionStatesForTests,
  shouldSkipAutoForExecution,
  markAutoSuccess,
  markAutoFinalFailure,
} from './download-operation';
import { CAPTCHA_CONSECUTIVE_FAILURE_LIMIT } from '../infrastructure/config';

describe('maskNfseKey', () => {
  it('mascara chave longa', () => {
    const k = '12345678901234567890123456789012345678901234';
    expect(maskNfseKey(k)).toBe('123456...1234');
  });

  it('mascara curta', () => {
    expect(maskNfseKey('abc')).toBe('***');
  });
});

describe('extractErrorCode / classificarErroDaOperacao', () => {
  it('classifica ERROR_CAPTCHA_UNSOLVABLE como RETRY_NEW_CAPTCHA', () => {
    const err = new CaptchaError(
      '2captcha getTaskResult: ERROR_CAPTCHA_UNSOLVABLE — Workers could not solve',
      'ERROR_CAPTCHA_UNSOLVABLE'
    );
    const c = classificarErroDaOperacao(err);
    expect(c.retryable).toBe(true);
    expect(c.action).toBe('RETRY_NEW_CAPTCHA');
    expect(c.code).toBe('ERROR_CAPTCHA_UNSOLVABLE');
  });

  it('classifica ERROR_ZERO_BALANCE como FAIL_CONFIGURATION (sem retry)', () => {
    const err = new CaptchaError(
      '2captcha createTask: ERROR_ZERO_BALANCE — empty',
      'ERROR_ZERO_BALANCE'
    );
    const c = classificarErroDaOperacao(err);
    expect(c.retryable).toBe(false);
    expect(c.action).toBe('FAIL_CONFIGURATION');
  });

  it('extrai codigo da mensagem quando CaptchaError sem code tipado', () => {
    const err = new CaptchaError('2captcha getTaskResult: ERROR_CAPTCHA_UNSOLVABLE — x');
    expect(extractErrorCode(err)).toBe('ERROR_CAPTCHA_UNSOLVABLE');
  });

  it('classifica nota nao encontrada como permanente', () => {
    const err = new NotaNaoEncontradaParaRetryError('nao achou');
    const c = classificarErroDaOperacao(err);
    expect(c.retryable).toBe(false);
    expect(c.action).toBe('FAIL_PERMANENT');
  });

  it('classifica falha de fechar modal como retryavel', () => {
    const err = new CaptchaModalCloseError('backdrop');
    const c = classificarErroDaOperacao(err);
    expect(c.retryable).toBe(true);
    expect(c.action).toBe('RETRY_NEW_CAPTCHA');
  });

  it('classifica timeout de rede como retryavel', () => {
    const c = classificarErroDaOperacao(new Error('fetch failed ETIMEDOUT'));
    expect(c.retryable).toBe(true);
  });
});

describe('circuit breaker por executionId', () => {
  beforeEach(() => {
    _resetExecutionStatesForTests();
  });

  it('nao contamina outra execucao', () => {
    for (let i = 0; i < CAPTCHA_CONSECUTIVE_FAILURE_LIMIT; i++) {
      markAutoFinalFailure('exec-A');
    }
    expect(shouldSkipAutoForExecution('exec-A')).toBe(true);
    expect(shouldSkipAutoForExecution('exec-B')).toBe(false);
  });

  it('sucesso zera contador', () => {
    markAutoFinalFailure('exec-1');
    markAutoFinalFailure('exec-1');
    markAutoSuccess('exec-1');
    expect(shouldSkipAutoForExecution('exec-1')).toBe(false);
  });
});

describe('CaptchaError.code', () => {
  it('preenche code a partir do argumento', () => {
    const e = new CaptchaError('msg', 'ERROR_CAPTCHA_UNSOLVABLE');
    expect(e.code).toBe('ERROR_CAPTCHA_UNSOLVABLE');
  });

  it('extrai code da mensagem', () => {
    const e = new CaptchaError('x ERROR_ZERO_BALANCE y');
    expect(e.code).toBe('ERROR_ZERO_BALANCE');
  });
});
