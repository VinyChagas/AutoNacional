/**
 * Leitura da Page já autenticada.
 * Não lança Chromium, não clica em download e não fecha a página.
 */
import type { Locator, Page } from 'playwright';
import { preencherDatasEFiltrar } from '../../processar-notas-competencia';
import { aguardarEstabilizarPagina, clicarMenuNotasEAguardar } from '../../playwright-nav';
import { DIRECAO_PARA_TIPO_NOTA_UI, type DirecaoDocumentoFiscal } from '../contracts/documento-fiscal';
import type { PeriodoConsultaPortal } from '../contracts/periodo';
import { urlConfirmaPesquisa } from './discovery-validation';
import {
  comFingerprint,
  parseTotalizador,
  proximaDesabilitada,
  textoIndicaSemRegistros,
} from './pagination';
import { evidenciaSituacaoVazia } from './row-parser';
import type {
  LeituraFiltroPortal,
  LinhaListagem,
  PaginaListagem,
  PortalListagem,
} from './types';

const MENU: Record<DirecaoDocumentoFiscal, string> = {
  EMITIDA: 'li:nth-of-type(3) img',
  RECEBIDA: 'li:nth-of-type(4) img',
};

const PROXIMA = [
  'i.fa-angle-right',
  'a:has(i.fa-angle-right)',
  'xpath=//i[@class="fa fa-angle-right"]',
  'xpath=//a[.//i[contains(@class,"fa-angle-right")]]',
] as const;

const LINHAS = 'table tbody tr';

interface NoDom {
  getAttribute(nome: string): string | null;
  querySelectorAll(seletor: string): ArrayLike<NoDom>;
  textContent: string | null;
}

async function lerLinha(row: Locator, pagina: number, linha: number): Promise<LinhaListagem> {
  const bruto = await row.evaluate((el) => {
    const raiz = el as unknown as NoDom;
    const hrefs = Array.from(raiz.querySelectorAll('a[href]'))
      .map((ancora) => ancora.getAttribute('href') ?? '')
      .filter(Boolean);
    const celulas = Array.from(raiz.querySelectorAll('td'));
    const celula = celulas.find((td) => {
      const classe = (td.getAttribute('class') ?? '').toLowerCase();
      const tokens = classe.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      return (
        tokens.includes('situacao') &&
        !tokens.includes('acao') &&
        !tokens.includes('acoes') &&
        !tokens.includes('menu')
      );
    });
    const icones = celula
      ? Array.from(celula.querySelectorAll('img')).map((img) => ({
          src: img.getAttribute('src'),
          title: img.getAttribute('title'),
          dataOriginalTitle: img.getAttribute('data-original-title'),
          alt: img.getAttribute('alt'),
          ariaLabel: img.getAttribute('aria-label'),
        }))
      : [];
    return {
      hrefs,
      dataChave: raiz.getAttribute('data-chave'),
      dataSituacao: raiz.getAttribute('data-situacao'),
      textos: celulas.map((td) => (td.textContent ?? '').replace(/\s+/g, ' ').trim()),
      situacao: celula
        ? {
            texto: (celula.textContent ?? '').replace(/\s+/g, ' ').trim(),
            classe: celula.getAttribute('class') ?? '',
            icones,
          }
        : null,
    };
  });

  return {
    pagina,
    linha,
    hrefs: bruto.hrefs,
    dataChave: bruto.dataChave,
    textos: bruto.textos,
    evidenciaSituacao: bruto.situacao
      ? {
          dataSituacao: bruto.dataSituacao,
          textoColuna: bruto.situacao.texto || null,
          classeColuna: bruto.situacao.classe || null,
          icones: bruto.situacao.icones,
        }
      : { ...evidenciaSituacaoVazia(), dataSituacao: bruto.dataSituacao },
  };
}

async function inspecionarProxima(page: Page): Promise<PaginaListagem['proxima']> {
  for (const seletor of PROXIMA) {
    const botao = page.locator(seletor).first();
    if ((await botao.count().catch(() => 0)) === 0) continue;
    const pai = botao.locator('..');
    const avo = pai.locator('..');
    const classes = await Promise.all([
      avo.getAttribute('class').catch(() => null),
      pai.getAttribute('class').catch(() => null),
    ]);
    const aria = await botao.getAttribute('aria-disabled').catch(() => null);
    return {
      presente: true,
      desabilitado: proximaDesabilitada(classes) || aria === 'true',
    };
  }
  return { presente: false, desabilitado: true };
}

export async function capturarPaginaListagem(page: Page, pagina: number): Promise<PaginaListagem> {
  await aguardarEstabilizarPagina(page, 15000);
  const bodyText = await page.locator('body').innerText().catch(() => '');
  const info = page.locator('.dataTables_info, .pagination-info').first();
  const infoTexto = (await info.innerText().catch(() => '')) || bodyText.match(/[^\n]*registros?[^\n]*/i)?.[0] || '';
  const linhas = page.locator(LINHAS);
  const quantidade = await linhas.count().catch(() => 0);
  const capturadas: LinhaListagem[] = [];
  for (let i = 0; i < quantidade; i += 1) {
    capturadas.push(await lerLinha(linhas.nth(i), pagina, i));
  }
  const indicador = page.locator('ul.pagination li.active, .pagination .active').first();
  const textoIndicador = await indicador.innerText().catch(() => '');
  const numero = textoIndicador.match(/\d+/)?.[0];

  return comFingerprint({
    url: page.url(),
    paginaIndicador: numero ? Number(numero) : pagina,
    totalizador: parseTotalizador(infoTexto),
    semRegistros: textoIndicaSemRegistros(bodyText) && quantidade === 0,
    linhas: capturadas,
    proxima: await inspecionarProxima(page),
  });
}

export async function lerFiltroDaPagina(page: Page): Promise<LeituraFiltroPortal> {
  const dataInicio = await page.locator('#datainicio').inputValue().catch(() => '');
  const dataFim = await page.locator('#datafim').inputValue().catch(() => '');
  const bodyText = await page.locator('body').innerText().catch(() => '');
  const quantidadeLinhas = await page.locator(LINHAS).count().catch(() => 0);
  const temTabela = (await page.locator('table').count().catch(() => 0)) > 0;
  return {
    url: page.url(),
    dataInicio,
    dataFim,
    semRegistros: textoIndicaSemRegistros(bodyText),
    quantidadeLinhas,
    temTabela,
  };
}

export function criarPortalDaPage(page: Page): PortalListagem {
  return {
    async abrir(direcao: DirecaoDocumentoFiscal): Promise<void> {
      const menu = page.locator(MENU[direcao]).nth(0);
      if ((await menu.count()) === 0) {
        throw new Error(`Menu de notas ${DIRECAO_PARA_TIPO_NOTA_UI[direcao]} não encontrado.`);
      }
      await clicarMenuNotasEAguardar(page, menu, DIRECAO_PARA_TIPO_NOTA_UI[direcao]);
    },
    async aplicarPeriodo(periodo: PeriodoConsultaPortal): Promise<LeituraFiltroPortal> {
      await preencherDatasEFiltrar(page, periodo.inicio, periodo.fim);
      const pesquisaConcluida = await page
        .waitForURL((url) => urlConfirmaPesquisa(url.href, periodo), { timeout: 15000 })
        .then(() => true)
        .catch(() => false);
      if (pesquisaConcluida) {
        await Promise.race([
          page.locator(LINHAS).first().waitFor({ state: 'attached', timeout: 15000 }),
          page
            .getByText(/nenhum registro encontrado|nenhuma nota encontrada|n[aã]o h[aá] registros/i)
            .first()
            .waitFor({ state: 'visible', timeout: 15000 }),
        ]).catch(() => undefined);
        await aguardarEstabilizarPagina(page, 10000);
      }
      return lerFiltroDaPagina(page);
    },
    capturar(pagina: number): Promise<PaginaListagem> {
      return capturarPaginaListagem(page, pagina);
    },
    async avancar(): Promise<boolean> {
      for (const seletor of PROXIMA) {
        const botao = page.locator(seletor).first();
        if ((await botao.count().catch(() => 0)) === 0) continue;
        const classe = await botao.locator('..').locator('..').getAttribute('class').catch(() => null);
        if (proximaDesabilitada([classe])) return false;
        await botao.click({ timeout: 5000 });
        await aguardarEstabilizarPagina(page, 10000);
        return true;
      }
      return false;
    },
  };
}
