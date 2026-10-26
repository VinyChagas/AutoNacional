/**
 * API-03G — classificação e política de retry por empresa.
 */
import { describe, expect, it } from 'vitest';
import {
  classificarErroEmpresa,
  intervaloRetryMs,
  obterPoliticaRetryEmpresa,
  podeAgendarNovaTentativa,
} from './retry-empresa';

describe('API-03G classificarErroEmpresa', () => {
  it('timeout Emitidas / #datainicio → RETRY', () => {
    const r = classificarErroEmpresa(
      'Inventário incompleto: EMITIDAS | NAV_FALHA | aplicar_filtro | /Notas/Emitidas | Timeout 10000ms exceeded. waiting for locator(\'#datainicio\')'
    );
    expect(r.acao).toBe('RETRY');
    expect(r.codigo).toMatch(/NAV_/);
  });

  it('timeout Recebidas / searchbar → RETRY', () => {
    const r = classificarErroEmpresa(
      "Falha ao aplicar filtro de datas: locator.click: Timeout 10000ms exceeded.\nwaiting for locator('#searchbar button[type=\"submit\"]')"
    );
    expect(r.acao).toBe('RETRY');
  });

  it('falha nos dois menus NAV_FALHA → RETRY', () => {
    const r = classificarErroEmpresa(
      'Inventário incompleto: EMITIDAS | NAV_FALHA | aplicar_filtro | … · RECEBIDAS | NAV_FALHA | abrir_menu | Menu de notas Recebidas não encontrado.'
    );
    expect(r.acao).toBe('RETRY');
    expect(r.codigo).toBe('NAV_FALHA');
  });

  it('falha de conexão SOCKS/net → RETRY', () => {
    expect(
      classificarErroEmpresa('page.goto: net::ERR_SOCKS_CONNECTION_FAILED at https://www.nfse.gov.br/')
        .acao
    ).toBe('RETRY');
    expect(classificarErroEmpresa('net::ERR_TIMED_OUT').acao).toBe('RETRY');
  });

  it('HTTP 403/429 → SUSPENDER_ACESSO', () => {
    expect(classificarErroEmpresa('HTTP 403 Forbidden').acao).toBe('SUSPENDER_ACESSO');
    expect(classificarErroEmpresa('429 Too Many Requests').acao).toBe('SUSPENDER_ACESSO');
    expect(classificarErroEmpresa('rate limit exceeded').codigo).toBe('HTTP_429');
  });

  it('situação indeterminada → FALHA_DEFINITIVA', () => {
    expect(
      classificarErroEmpresa('Nota indeterminada bloqueia a recuperação automática.').acao
    ).toBe('FALHA_DEFINITIVA');
  });

  it('divergência hash/XML → FALHA_DEFINITIVA', () => {
    expect(classificarErroEmpresa('Hash divergente ou arquivo truncado.').acao).toBe(
      'FALHA_DEFINITIVA'
    );
    expect(classificarErroEmpresa('CONFLITO_HASH').acao).toBe('FALHA_DEFINITIVA');
  });

  it('checkpoint inconsistente / chaves ausentes → FALHA_DEFINITIVA', () => {
    expect(
      classificarErroEmpresa('Inventário sem chaves já presentes no checkpoint: 123', {
        codigo: 'CHAVES_AUSENTES',
      }).acao
    ).toBe('FALHA_DEFINITIVA');
  });

  it('certificado / credencial → FALHA_DEFINITIVA', () => {
    expect(classificarErroEmpresa('Certificado A1 indisponível').acao).toBe('FALHA_DEFINITIVA');
    expect(classificarErroEmpresa('senha incorreta no login').acao).toBe('FALHA_DEFINITIVA');
  });
});

describe('API-03G política de retry', () => {
  it('defaults: 3 novas, intervalos 5/15/30s', () => {
    const p = obterPoliticaRetryEmpresa({});
    expect(p.maxNovasTentativas).toBe(3);
    expect(p.intervalosMs).toEqual([5000, 15000, 30000]);
  });

  it('intervalos configuráveis via env', () => {
    const p = obterPoliticaRetryEmpresa({
      EMPRESA_RETRY_MAX: '2',
      EMPRESA_RETRY_INTERVALS_MS: '1000,2000',
    });
    expect(p.maxNovasTentativas).toBe(2);
    expect(intervaloRetryMs(p, 1)).toBe(1000);
    expect(intervaloRetryMs(p, 2)).toBe(2000);
    expect(intervaloRetryMs(p, 9)).toBe(2000);
  });

  it('pode agendar até esgotar (1 + max)', () => {
    const p = obterPoliticaRetryEmpresa({ EMPRESA_RETRY_MAX: '3' });
    expect(podeAgendarNovaTentativa(p, 1)).toBe(true);
    expect(podeAgendarNovaTentativa(p, 3)).toBe(true);
    expect(podeAgendarNovaTentativa(p, 4)).toBe(false);
  });

  it('API-03I — FILTRO_NAO_APLICADO e listagem instável são RETRY', () => {
    expect(classificarErroEmpresa('FILTRO_NAO_APLICADO: Portal não confirmou a listagem após filtro.').acao).toBe(
      'RETRY'
    );
    expect(classificarErroEmpresa('DATA_CHAVE_NAO_VERIFICAVEL — linha sem chave nacional confirmada').acao).toBe(
      'RETRY'
    );
    expect(
      classificarErroEmpresa('TOTALIZADOR_DIVERGENTE: O portal indica 45 registros em RECEBIDA; a descoberta leu 42.')
        .acao
    ).toBe('RETRY');
    expect(
      classificarErroEmpresa('LISTA_VAZIA_NAO_CONFIRMADA: A listagem não trouxe linhas nem a mensagem de ausência.')
        .acao
    ).toBe('RETRY');
  });

  it('API-03I — indeterminada e XML inconsistente continuam definitivos', () => {
    expect(classificarErroEmpresa('Nota indeterminada bloqueia a recuperação automática.').acao).toBe(
      'FALHA_DEFINITIVA'
    );
    expect(classificarErroEmpresa('Hash divergente ou arquivo truncado.').acao).toBe('FALHA_DEFINITIVA');
  });

  it('max 0 → sem retry', () => {
    const p = obterPoliticaRetryEmpresa({ EMPRESA_RETRY_MAX: '0' });
    expect(podeAgendarNovaTentativa(p, 1)).toBe(false);
  });
});
