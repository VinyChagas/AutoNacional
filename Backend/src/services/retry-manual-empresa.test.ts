/**
 * API-03I — retry manual: trava de concorrência e classificação de erros.
 * Não sobe Playwright nem altera checkpoints reais.
 */
import { describe, expect, it } from 'vitest';
import { classificarErroEmpresa } from './retry-empresa';
import { RetryManualEmpresaError } from './execution-service';

describe('API-03I RetryManualEmpresaError', () => {
  it('expõe código estruturado', () => {
    const err = new RetryManualEmpresaError('EMPRESA_EM_EXECUCAO', 'ocupada');
    expect(err.codigo).toBe('EMPRESA_EM_EXECUCAO');
    expect(err.message).toBe('ocupada');
    expect(err.name).toBe('RetryManualEmpresaError');
  });
});

describe('API-03I política — cobertura incompleta por VALIDACAO não é retry automático de empresa', () => {
  it('Cobertura fiscal incompleta permanece definitiva (exige retry manual / reabertura de chave)', () => {
    const r = classificarErroEmpresa(
      'Cobertura fiscal incompleta: vigentes=180 persistidos=178 pendentes=0 reconciliação=NAO_RECONCILIADA.'
    );
    expect(r.acao).toBe('FALHA_DEFINITIVA');
  });
});
