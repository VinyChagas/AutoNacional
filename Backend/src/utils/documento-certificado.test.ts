import { describe, it, expect } from 'vitest';
import {
  documentosEquivalentes,
  limparDocumento,
  variantesDocumento,
} from './documento-certificado';

describe('documento-certificado', () => {
  it('limpa formatação', () => {
    expect(limparDocumento('12.345.678/0001-99')).toBe('12345678000199');
  });

  it('variantes de CPF com pad', () => {
    const v = variantesDocumento('00012345678901');
    expect(v).toContain('00012345678901');
    expect(v).toContain('12345678901');
  });

  it('variantes de CPF sem pad', () => {
    const v = variantesDocumento('12345678901');
    expect(v).toContain('12345678901');
    expect(v).toContain('00012345678901');
  });

  it('documentosEquivalentes ignora formatação', () => {
    expect(
      documentosEquivalentes('12.345.678/0001-99', '12345678000199')
    ).toBe(true);
  });

  it('documentosEquivalentes trata CPF com/sem pad', () => {
    expect(documentosEquivalentes('00012345678901', '12345678901')).toBe(true);
  });

  it('documentosEquivalentes rejeita CNPJs diferentes', () => {
    expect(documentosEquivalentes('12345678000199', '99887766000111')).toBe(
      false
    );
  });
});
