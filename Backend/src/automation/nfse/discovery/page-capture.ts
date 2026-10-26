/**
 * Leitura da Page já autenticada.
 * Não lança Chromium, não clica em download e não fecha a página.
 */
import type { Locator, Page } from 'playwright';
import {
  localizarBotaoFiltrarPortal,
  preencherDatasEFiltrar,
  submeterFiltroPortal,
} from '../../processar-notas-competencia';
import { aguardarRotaOuSeletor, clicarMenuNotasEAguardar } from '../../playwright-nav';
import { PLAYWRIGHT_TIMEOUT } from '../../../infrastructure/config';
import { getLogger } from '../../../infrastructure/logger';
import {
  agoraMonotonicoMs,
  deltaMonotonicoMs,
} from '../orchestration/metricas-operacionais';
import { DIRECAO_PARA_TIPO_NOTA_UI, type DirecaoDocumentoFiscal } from '../contracts/documento-fiscal';
import type { PeriodoConsultaPortal } from '../contracts/periodo';
import {
  montarUrlPesquisaPortal,
  urlConfirmaPesquisa,
  urlTemPeriodoSemExecutar,
} from './discovery-validation';
import {
  comFingerprint,
  parseTotalizador,
  proximaDesabilitada,
  textoIndicaSemRegistros,
} from './pagination';
import { paginaRequerRecaptura } from './page-capture-recovery';
import {
  aguardarConteudoListagemPortal,
  aguardarIdentificadoresNasLinhas,
  aguardarListagemEstavel,
  aguardarListagemPortalPronta,
  pesquisaPortalConfirmadaNaUrl,
  SELETOR_LINHAS_LISTAGEM_PORTAL,
} from './portal-listagem-ready';
import { evidenciaSituacaoVazia } from './row-parser';
import {
  seletoresMenuNotas,
  urlDiagnosticoPortal,
  urlNotasPortal,
} from './portal-selectors';
import type {
  LeituraFiltroPortal,
  LinhaListagem,
  PaginaListagem,
  PortalListagem,
} from './types';

const PROXIMA = [
  'i.fa-angle-right',
  'a:has(i.fa-angle-right)',
  'xpath=//i[@class="fa fa-angle-right"]',
  'xpath=//a[.//i[contains(@class,"fa-angle-right")]]',
] as const;

const LINHAS = SELETOR_LINHAS_LISTAGEM_PORTAL;

const loggerTempos = getLogger('nfse-discovery-timing');

interface NoDom {
  getAttribute(nome: string): string | null;
  querySelectorAll(seletor: string): ArrayLike<NoDom>;
  textContent: string | null;
}

export class PortalDescobertaError extends Error {
  readonly etapa: string;
  readonly seletor?: string;
  readonly url?: string;

  constructor(
    etapa: string,
    mensagem: string,
    extras?: { seletor?: string; url?: string }
  ) {
    super(mensagem);
    this.name = 'PortalDescobertaError';
    this.etapa = etapa;
    this.seletor = extras?.seletor;
    this.url = extras?.url;
  }
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
    const mapearIcone = (img: NoDom) => {
      const dataOriginalTitle =
        img.getAttribute('data-original-title') ||
        img.getAttribute('data-bs-original-title') ||
        null;
      return {
        src: img.getAttribute('src'),
        title: img.getAttribute('title'),
        dataOriginalTitle,
        alt: img.getAttribute('alt'),
        ariaLabel: img.getAttribute('aria-label'),
      };
    };
    const iconeFiscal = (icone: {
      src: string | null;
      title: string | null;
      dataOriginalTitle: string | null;
      alt: string | null;
      ariaLabel: string | null;
    }) => {
      const blob = [icone.src, icone.alt, icone.title, icone.dataOriginalTitle, icone.ariaLabel]
        .filter(Boolean)
        .join(' ');
      return /tb[-_]?(nota[-_]?bypass|gerada|cancelada|substitu)/i.test(blob) ||
        /decis[aã]o\s*(administrativa|judicial)/i.test(blob);
    };
    // Coluna Situação + SEMPRE mescla ícones fiscais da linha (API-03K).
    // Evita perder tb-nota-bypass quando a TD situacao já tem outro <img> genérico.
    const daCelula = celula
      ? Array.from(celula.querySelectorAll('img')).map(mapearIcone)
      : [];
    const daLinha = Array.from(raiz.querySelectorAll('img')).map(mapearIcone).filter(iconeFiscal);
    const icones = [...daCelula];
    for (const fiscal of daLinha) {
      if (
        !icones.some(
          (item) =>
            item.src === fiscal.src &&
            item.alt === fiscal.alt &&
            item.dataOriginalTitle === fiscal.dataOriginalTitle
        )
      ) {
        icones.push(fiscal);
      }
    }
    const textoBypass = icones
      .map((i) => i.alt || i.dataOriginalTitle || i.title || '')
      .find((t) => /decis[aã]o\s*(administrativa|judicial)/i.test(t));
    // API-03L — data-situacao pode estar no TR, na TD Situação ou em descendente.
    const dataSituacao =
      raiz.getAttribute('data-situacao') ||
      (celula ? celula.getAttribute('data-situacao') : null) ||
      (() => {
        const comAttr = Array.from(raiz.querySelectorAll('[data-situacao]'));
        for (let i = 0; i < comAttr.length; i += 1) {
          const v = comAttr[i].getAttribute('data-situacao');
          if (v && v.trim()) return v;
        }
        return null;
      })();
    return {
      hrefs,
      dataChave: raiz.getAttribute('data-chave'),
      dataSituacao,
      textos: celulas.map((td) => (td.textContent ?? '').replace(/\s+/g, ' ').trim()),
      situacao: celula
        ? {
            texto: (celula.textContent ?? '').replace(/\s+/g, ' ').trim() || textoBypass || '',
            classe: celula.getAttribute('class') ?? '',
            icones,
          }
        : icones.length > 0
          ? { texto: textoBypass || '', classe: '', icones }
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

async function lerPaginaListagemBruta(
  page: Page,
  pagina: number,
  opcoes: { minimoLinhas?: number } = {}
): Promise<{
  pagina: PaginaListagem;
  estabilMs: number;
  estavel: boolean;
  infoPresente: boolean;
  indicadorPresente: boolean;
}> {
  // API-02Z — estabiliza a listagem (contagem de linhas) antes de ler, evitando
  // captura parcial durante a transição do filtro. Teto curto, sem hang.
  const estabil = await aguardarListagemEstavel(page, {
    timeoutMs: Math.min(15000, PLAYWRIGHT_TIMEOUT),
    minimoLinhas: opcoes.minimoLinhas,
  });

  const bodyText = await page.locator('body').innerText().catch(() => '');

  const info = page.locator('.dataTables_info, .pagination-info').first();
  const infoPresente = (await info.count().catch(() => 0)) > 0;
  const infoTexto =
    (infoPresente ? await info.innerText().catch(() => '') : '') ||
    bodyText.match(/[^\n]*registros?[^\n]*/i)?.[0] ||
    '';

  const linhas = page.locator(LINHAS);
  const quantidade = await linhas.count().catch(() => 0);
  const capturadas: LinhaListagem[] = [];
  for (let i = 0; i < quantidade; i += 1) {
    capturadas.push(await lerLinha(linhas.nth(i), pagina, i));
  }

  const indicador = page.locator('ul.pagination li.active, .pagination .active').first();
  const indicadorPresente = (await indicador.count().catch(() => 0)) > 0;
  const textoIndicador = indicadorPresente
    ? await indicador.innerText().catch(() => '')
    : '';
  const numero = textoIndicador.match(/\d+/)?.[0];

  return {
    pagina: comFingerprint({
      url: page.url(),
      paginaIndicador: numero ? Number(numero) : pagina,
      totalizador: parseTotalizador(infoTexto),
      semRegistros: textoIndicaSemRegistros(bodyText) && quantidade === 0,
      linhas: capturadas,
      proxima: await inspecionarProxima(page),
    }),
    estabilMs: estabil.ms,
    estavel: estabil.estavel,
    infoPresente,
    indicadorPresente,
  };
}

/**
 * API-02W/Z + API-03H — captura com recuperação localizada transitória:
 * re-estabiliza e relê uma vez se houver linha sem chave ou contagem aquém do totalizador.
 * Não inventa chave; inventário incompleto permanece se a divergência continuar.
 */
export async function capturarPaginaListagem(
  page: Page,
  pagina: number,
  opcoes: { acumuladosAntes?: number } = {}
): Promise<PaginaListagem> {
  const inicioCaptura = agoraMonotonicoMs();
  const acumuladosAntes = opcoes.acumuladosAntes ?? 0;

  let lida = await lerPaginaListagemBruta(page, pagina);
  let recapturas = 0;

  if (paginaRequerRecaptura(lida.pagina, { acumuladosAntes })) {
    const faltam =
      lida.pagina.totalizador != null
        ? Math.max(0, lida.pagina.totalizador - acumuladosAntes)
        : undefined;
    await aguardarIdentificadoresNasLinhas(page, {
      timeoutMs: Math.min(8000, PLAYWRIGHT_TIMEOUT),
    });
    lida = await lerPaginaListagemBruta(page, pagina, {
      minimoLinhas: faltam != null && faltam > 0 ? faltam : undefined,
    });
    recapturas = 1;
  }

  loggerTempos.info(
    {
      op: 'capturar_pagina',
      pagina,
      ms: deltaMonotonicoMs(inicioCaptura, agoraMonotonicoMs()),
      estabilizacaoMs: lida.estabilMs,
      estavel: lida.estavel,
      linhas: lida.pagina.linhas.length,
      recapturas,
      infoPresente: lida.infoPresente,
      indicadorPresente: lida.indicadorPresente,
    },
    'Tempo: captura da página da listagem'
  );
  return lida.pagina;
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

async function localizarMenuNotas(
  page: Page,
  direcao: DirecaoDocumentoFiscal
): Promise<{ locator: Locator; seletor: string }> {
  const tentados: string[] = [];
  for (const seletor of seletoresMenuNotas(direcao)) {
    tentados.push(seletor);
    const loc = page.locator(seletor).first();
    const n = await loc.count().catch(() => 0);
    if (n === 0) continue;
    const visivel = await loc.isVisible().catch(() => false);
    if (!visivel) continue;
    return { locator: loc, seletor };
  }
  throw new PortalDescobertaError(
    'abrir_menu',
    `Menu de notas ${DIRECAO_PARA_TIPO_NOTA_UI[direcao]} não encontrado.`,
    {
      seletor: tentados.join(' | '),
      url: urlDiagnosticoPortal(page.url()),
    }
  );
}

/**
 * API-02Z — recupera a rota de Notas quando a sessão foi desviada (ex.: "/").
 * Re-navega à URL da direção reaproveitando a sessão/cert vigente (mTLS do
 * contexto). Não realiza novo login nem toca no fluxo por credenciais.
 * Retorna true se a rota ficou correta e o formulário (#datainicio) presente.
 */
async function recuperarRotaNotas(
  page: Page,
  direcao: DirecaoDocumentoFiscal
): Promise<boolean> {
  const tipoUi = DIRECAO_PARA_TIPO_NOTA_UI[direcao];
  const destino = urlNotasPortal(direcao);
  try {
    await page.goto(destino, {
      waitUntil: 'domcontentloaded',
      timeout: Math.min(30000, PLAYWRIGHT_TIMEOUT),
    });
  } catch {
    return false;
  }
  const r = await aguardarRotaOuSeletor(page, {
    urlSubstring: `/Notas/${tipoUi}`,
    readySelector: '#datainicio',
    urlSubstringsProibidas: [
      `/Notas/${tipoUi === 'Emitidas' ? 'Recebidas' : 'Emitidas'}`,
    ],
    timeout: Math.min(15000, PLAYWRIGHT_TIMEOUT),
  });
  return r.rotaOk || r.seletorOk;
}

export function criarPortalDaPage(page: Page): PortalListagem {
  return {
    async abrir(direcao: DirecaoDocumentoFiscal): Promise<void> {
      const tipoUi = DIRECAO_PARA_TIPO_NOTA_UI[direcao];
      let seletor: string | undefined;
      try {
        const alvo = await localizarMenuNotas(page, direcao);
        seletor = alvo.seletor;
        await alvo.locator.scrollIntoViewIfNeeded().catch(() => undefined);
        await clicarMenuNotasEAguardar(page, alvo.locator, tipoUi);
        return;
      } catch (erro) {
        // API-02Z — sob concorrência mTLS a sessão pode ser desviada para "/"
        // (menu ausente). Recuperação: re-navega à rota de Notas reaproveitando
        // a sessão/cert vigente (sem novo login/credenciais). Só então falha.
        const recuperou = await recuperarRotaNotas(page, direcao).catch(() => false);
        if (recuperou) {
          loggerTempos.info(
            { op: 'abrir_menu_recuperado', direcao, url: urlDiagnosticoPortal(page.url()) },
            'Rota de Notas recuperada por re-navegação (sessão desviada)'
          );
          return;
        }
        throw new PortalDescobertaError(
          'abrir_menu',
          `Falha ao abrir ${tipoUi}: ${erro instanceof Error ? erro.message : String(erro)}`,
          { seletor, url: urlDiagnosticoPortal(page.url()) }
        );
      }
    },
    async aplicarPeriodo(
      periodo: PeriodoConsultaPortal,
      _direcao: DirecaoDocumentoFiscal
    ): Promise<LeituraFiltroPortal> {
      let seletorFiltro: string | undefined;
      const timeoutListagem = Math.min(15000, PLAYWRIGHT_TIMEOUT);
      const inicioFiltro = agoraMonotonicoMs();
      try {
        const botao = await localizarBotaoFiltrarPortal(page).catch(() => null);
        seletorFiltro = botao?.seletor;
        await preencherDatasEFiltrar(page, periodo.inicio, periodo.fim);
      } catch (erro) {
        throw new PortalDescobertaError(
          'aplicar_filtro',
          `Falha ao aplicar filtro de datas: ${
            erro instanceof Error ? erro.message : String(erro)
          }`,
          { seletor: seletorFiltro, url: urlDiagnosticoPortal(page.url()) }
        );
      }
      loggerTempos.info(
        {
          op: 'aplicar_filtro',
          ms: deltaMonotonicoMs(inicioFiltro, agoraMonotonicoMs()),
        },
        'Tempo: preenchimento + submissão do filtro'
      );

      // API-02W — preencherDatasEFiltrar já aguardou URL+conteúdo; não repetir.
      if (pesquisaPortalConfirmadaNaUrl(page.url(), periodo)) {
        loggerTempos.info(
          { op: 'confirmar_pesquisa', confirmada: true, viaGet: false },
          'Pesquisa confirmada sem GET adicional'
        );
        return lerFiltroDaPagina(page);
      }

      // Datas sem executar=1 ≠ pesquisa OK. Retenta submit real; depois GET controlado.
      const urlAtual = page.url();
      try {
        if (urlTemPeriodoSemExecutar(urlAtual, periodo) || !urlConfirmaPesquisa(urlAtual, periodo)) {
          const { seletor } = await submeterFiltroPortal(page);
          seletorFiltro = seletor;
          const aposSubmit = await aguardarListagemPortalPronta(page, periodo, timeoutListagem);
          if (aposSubmit.urlOk) return lerFiltroDaPagina(page);
        }
      } catch {
        /* fallback GET abaixo */
      }

      const inicioGet = agoraMonotonicoMs();
      let getTimedOut = false;
      try {
        const destino = montarUrlPesquisaPortal(page.url(), periodo);
        seletorFiltro = seletorFiltro ?? 'GET executar=1 (contrato Portal)';
        await page.goto(destino, {
          waitUntil: 'domcontentloaded',
          timeout: PLAYWRIGHT_TIMEOUT,
        });
        await aguardarListagemPortalPronta(page, periodo, timeoutListagem);
      } catch {
        getTimedOut = true;
        /* confirmação em confirmarFiltroAplicado */
      }
      loggerTempos.info(
        {
          op: 'get_controlado',
          ms: deltaMonotonicoMs(inicioGet, agoraMonotonicoMs()),
          timedOut: getTimedOut,
          confirmada: pesquisaPortalConfirmadaNaUrl(page.url(), periodo),
        },
        'Tempo: GET controlado (executar=1) + confirmação da listagem'
      );
      return lerFiltroDaPagina(page);
    },
    capturar(
      pagina: number,
      _direcao: DirecaoDocumentoFiscal,
      opcoes?: { acumuladosAntes?: number }
    ): Promise<PaginaListagem> {
      return capturarPaginaListagem(page, pagina, opcoes);
    },
    async avancar(): Promise<boolean> {
      for (const seletor of PROXIMA) {
        const botao = page.locator(seletor).first();
        if ((await botao.count().catch(() => 0)) === 0) continue;
        const classe = await botao.locator('..').locator('..').getAttribute('class').catch(() => null);
        if (proximaDesabilitada([classe])) return false;
        await botao.click({ timeout: 5000 });
        await aguardarConteudoListagemPortal(page, Math.min(15000, PLAYWRIGHT_TIMEOUT));
        return true;
      }
      return false;
    },
  };
}
