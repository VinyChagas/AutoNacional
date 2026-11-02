import { describe, it, expect } from 'vitest';
import {
  gerarModeloPlanilhaCredenciais,
  parsePlanilhaCredenciais,
  CABECALHOS_PLANILHA_CREDENCIAIS,
} from './planilha.parser';

describe('gerarModeloPlanilhaCredenciais', () => {
  it('gera buffer xlsx aceito pelo parser com as colunas oficiais', () => {
    const buffer = gerarModeloPlanilhaCredenciais();
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(100);

    const linhas = parsePlanilhaCredenciais(buffer);
    expect(linhas.length).toBeGreaterThanOrEqual(2);
    expect(linhas[0].tipo_login).toBe('CNPJ');
    expect(linhas[1].tipo_login).toBe('CPF');
    expect(CABECALHOS_PLANILHA_CREDENCIAIS).toHaveLength(5);
  });
});
