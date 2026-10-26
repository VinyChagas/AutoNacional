import { describe, expect, it } from 'vitest';
import {
  normalizarFiltroAutenticacao,
  pertenceAContabilidade,
  respeitaFiltroAutenticacao,
  tipoAuthDaSelecao,
} from './selecao-execucao';

describe('API-03B selecao-execucao', () => {
  it('normaliza filtro A1 / credenciais / todas', () => {
    expect(normalizarFiltroAutenticacao('certificado')).toBe('certificado');
    expect(normalizarFiltroAutenticacao('a1')).toBe('certificado');
    expect(normalizarFiltroAutenticacao('credenciais')).toBe('credenciais');
    expect(normalizarFiltroAutenticacao(undefined)).toBe('todas');
  });

  it('filtro certificado rejeita credenciais', () => {
    expect(respeitaFiltroAutenticacao('certificado', 'certificado')).toBe(true);
    expect(respeitaFiltroAutenticacao('certificado', 'credenciais')).toBe(false);
  });

  it('filtro credenciais rejeita certificado', () => {
    expect(respeitaFiltroAutenticacao('credenciais', 'credenciais')).toBe(true);
    expect(respeitaFiltroAutenticacao('credenciais', 'certificado')).toBe(false);
  });

  it('filtro todas aceita ambos', () => {
    expect(respeitaFiltroAutenticacao('todas', 'certificado')).toBe(true);
    expect(respeitaFiltroAutenticacao('todas', 'credenciais')).toBe(true);
  });

  it('valida contabilidade do lote', () => {
    expect(pertenceAContabilidade(6, 6)).toBe(true);
    expect(pertenceAContabilidade(6, 7)).toBe(false);
    expect(pertenceAContabilidade(null, 6)).toBe(true);
    expect(pertenceAContabilidade(6, null)).toBe(false);
  });

  it('tipoAuthDaSelecao padrão certificado', () => {
    expect(tipoAuthDaSelecao('credenciais')).toBe('credenciais');
    expect(tipoAuthDaSelecao(undefined)).toBe('certificado');
  });
});
