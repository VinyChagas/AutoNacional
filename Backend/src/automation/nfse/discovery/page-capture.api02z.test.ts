/**
 * API-02Z — causa raiz do ~120s/direção na descoberta Portal.
 *
 * `capturarPaginaListagem` chamava innerText() em elementos que NÃO existem no
 * Portal Nacional (.dataTables_info e ul.pagination li.active). Com o
 * setDefaultTimeout(60s) da página, cada innerText() ausente travava 60s antes
 * do .catch() → 2×60s por captura. Este teste prova que, quando o seletor está
 * ausente (count()=0), innerText() NUNCA é chamado (sem hang), usando fakes.
 */
import { describe, expect, it, vi } from 'vitest';
import { capturarPaginaListagem } from './page-capture';
import type { Page } from 'playwright';

interface LocatorFake {
  first: () => LocatorFake;
  count: () => Promise<number>;
  innerText: ReturnType<typeof vi.fn>;
  nth: (i: number) => LocatorFake;
  locator: (sel: string) => LocatorFake;
  getAttribute: () => Promise<string | null>;
  evaluate: () => Promise<unknown>;
}

function criarPageFake(bodyText: string): {
  page: Page;
  infoInnerText: ReturnType<typeof vi.fn>;
  indicadorInnerText: ReturnType<typeof vi.fn>;
} {
  const infoInnerText = vi.fn(async () => '');
  const indicadorInnerText = vi.fn(async () => '');

  const vazio = (innerText: ReturnType<typeof vi.fn>): LocatorFake => {
    const self: LocatorFake = {
      first: () => self,
      count: async () => 0,
      innerText,
      nth: () => self,
      locator: () => vazio(vi.fn(async () => '')),
      getAttribute: async () => null,
      evaluate: async () => ({}),
    };
    return self;
  };

  const bodyLoc: LocatorFake = {
    first: () => bodyLoc,
    count: async () => 1,
    innerText: vi.fn(async () => bodyText),
    nth: () => bodyLoc,
    locator: () => vazio(vi.fn(async () => '')),
    getAttribute: async () => null,
    evaluate: async () => ({}),
  };

  const page = {
    url: () => 'https://www.nfse.gov.br/EmissorNacional/Notas/Emitidas?executar=1',
    locator: (sel: string): LocatorFake => {
      if (sel === 'body') return bodyLoc;
      if (sel.includes('dataTables_info') || sel.includes('pagination-info')) {
        return vazio(infoInnerText);
      }
      if (sel.includes('pagination') && sel.includes('active')) {
        return vazio(indicadorInnerText);
      }
      // LINHAS ('table tbody tr'), PROXIMA e demais → ausentes.
      return vazio(vi.fn(async () => ''));
    },
  } as unknown as Page;

  return { page, infoInnerText, indicadorInnerText };
}

describe('API-02Z — capturarPaginaListagem sem hang de 60s', () => {
  it('não chama innerText() em .dataTables_info ausente (count=0)', async () => {
    const { page, infoInnerText } = criarPageFake('Nenhum registro encontrado');
    await capturarPaginaListagem(page, 1);
    expect(infoInnerText).not.toHaveBeenCalled();
  });

  it('não chama innerText() no indicador de paginação ausente (count=0)', async () => {
    const { page, indicadorInnerText } = criarPageFake('Nenhum registro encontrado');
    await capturarPaginaListagem(page, 1);
    expect(indicadorInnerText).not.toHaveBeenCalled();
  });

  it('listagem vazia → semRegistros=true, sem linhas, página retorna rápido', async () => {
    const { page } = criarPageFake('Nenhum registro encontrado');
    const r = await capturarPaginaListagem(page, 1);
    expect(r.linhas).toHaveLength(0);
    expect(r.semRegistros).toBe(true);
    expect(r.proxima.presente).toBe(false);
  });
});
