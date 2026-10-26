/**
 * API-02W — condições verificáveis da listagem Portal (sem networkidle).
 */
import { describe, expect, it, vi } from 'vitest';
import { criarPeriodoConsultaPortal } from '../contracts/periodo';
import {
  aguardarConteudoListagemPortal,
  aguardarListagemPortalPronta,
  aguardarPesquisaPortalNaUrl,
  pesquisaPortalConfirmadaNaUrl,
} from './portal-listagem-ready';

const PERIODO = criarPeriodoConsultaPortal('01/08/2026', '31/08/2026');

function urlOk(path = 'Emitidas'): string {
  const q = new URLSearchParams({
    executar: '1',
    datainicio: PERIODO.inicio,
    datafim: PERIODO.fim,
  });
  return `https://www.nfse.gov.br/EmissorNacional/Notas/${path}?${q}`;
}

function locatorMock(opts: {
  count?: number;
  waitFor?: () => Promise<void>;
  innerText?: string;
}) {
  const first = {
    waitFor: opts.waitFor ?? vi.fn(async () => undefined),
  };
  return {
    count: vi.fn(async () => opts.count ?? 0),
    first: () => first,
    innerText: vi.fn(async () => opts.innerText ?? ''),
  };
}

function pageMock(opts: {
  url: string;
  linhas?: number;
  body?: string;
  waitForURL?: (fn: (u: URL) => boolean, o: { timeout: number }) => Promise<void>;
  raceLinhas?: () => Promise<void>;
  raceVazia?: () => Promise<void>;
}) {
  const linhas = locatorMock({
    count: opts.linhas ?? 0,
    waitFor: opts.raceLinhas,
  });
  const body = locatorMock({ innerText: opts.body ?? '' });
  const vaziaFirst = {
    waitFor: opts.raceVazia ?? vi.fn(async () => {
      throw new Error('timeout vazia');
    }),
  };
  return {
    url: () => opts.url,
    waitForURL: opts.waitForURL ?? vi.fn(async () => undefined),
    locator: (sel: string) => {
      if (sel === 'table tbody tr') return linhas;
      if (sel === 'body') return body;
      return locatorMock({});
    },
    getByText: () => ({ first: () => vaziaFirst }),
  } as unknown as import('playwright').Page;
}

describe('portal-listagem-ready', () => {
  it('pesquisaPortalConfirmadaNaUrl exige executar=1 e período', () => {
    expect(pesquisaPortalConfirmadaNaUrl(urlOk(), PERIODO)).toBe(true);
    expect(
      pesquisaPortalConfirmadaNaUrl(
        'https://www.nfse.gov.br/EmissorNacional/Notas/Emitidas?datainicio=01%2F08%2F2026&datafim=31%2F08%2F2026',
        PERIODO
      )
    ).toBe(false);
  });

  it('aguardarPesquisaPortalNaUrl retorna imediato se URL já confirma', async () => {
    const page = pageMock({ url: urlOk() });
    const waitForURL = vi.fn();
    (page as { waitForURL: unknown }).waitForURL = waitForURL;
    await expect(aguardarPesquisaPortalNaUrl(page, PERIODO, 15000)).resolves.toBe(true);
    expect(waitForURL).not.toHaveBeenCalled();
  });

  it('listagem com documentos → linhas', async () => {
    const page = pageMock({ url: urlOk(), linhas: 3, body: '3 registros' });
    await expect(aguardarConteudoListagemPortal(page, 5000)).resolves.toBe('linhas');
  });

  it('listagem vazia → vazio', async () => {
    const page = pageMock({
      url: urlOk(),
      linhas: 0,
      body: 'Nenhum registro encontrado',
    });
    await expect(aguardarConteudoListagemPortal(page, 5000)).resolves.toBe('vazio');
  });

  it('página ainda carregando → timeout', async () => {
    const page = pageMock({
      url: urlOk(),
      linhas: 0,
      body: 'Carregando…',
      raceLinhas: async () => {
        throw new Error('Timeout');
      },
      raceVazia: async () => {
        throw new Error('Timeout');
      },
    });
    await expect(aguardarConteudoListagemPortal(page, 50)).resolves.toBe('timeout');
  });

  it('filtro não aplicado → urlOk false', async () => {
    const page = pageMock({
      url: 'https://www.nfse.gov.br/EmissorNacional/Notas/Emitidas',
      waitForURL: async () => {
        throw new Error('Timeout URL');
      },
    });
    const r = await aguardarListagemPortalPronta(page, PERIODO, 50);
    expect(r.urlOk).toBe(false);
    expect(r.conteudo).toBe('timeout');
  });

  it('aguardarListagemPortalPronta com URL ok e linhas', async () => {
    const page = pageMock({ url: urlOk(), linhas: 2, body: 'ok' });
    const r = await aguardarListagemPortalPronta(page, PERIODO, 5000);
    expect(r).toEqual({ urlOk: true, conteudo: 'linhas' });
  });
});
