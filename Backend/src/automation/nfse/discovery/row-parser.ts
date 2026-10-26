/**
 * Leitura de uma linha da listagem.
 * A situação fiscal permanece sem classificação: só a evidência bruta é guardada.
 */
import type { DirecaoDocumentoFiscal } from '../contracts/documento-fiscal';
import { extrairChaveDaLinha } from './chave';
import type {
  EvidenciaSituacaoBruta,
  IconeSituacaoBruto,
  LinhaListagem,
  RegistroDescobertaNfse,
} from './types';

const TR = /<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi;
const TD = /<td\b([^>]*)>([\s\S]*?)<\/td>/gi;
const IMG = /<img\b([^>]*)\/?>/gi;
const ATTR = /([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;

export function evidenciaSituacaoVazia(): EvidenciaSituacaoBruta {
  return { dataSituacao: null, textoColuna: null, classeColuna: null, icones: [] };
}

export function atributosDaTag(tag: string): Record<string, string> {
  const atributos: Record<string, string> = {};
  for (const match of tag.matchAll(ATTR)) {
    atributos[match[1].toLowerCase()] = (match[3] ?? match[4] ?? '').replace(/&amp;/g, '&');
  }
  return atributos;
}

export function iconesDoFragmento(fragmento: string): IconeSituacaoBruto[] {
  const icones: IconeSituacaoBruto[] = [];
  for (const match of fragmento.matchAll(IMG)) {
    const atributos = atributosDaTag(match[0]);
    icones.push({
      src: atributos.src ?? null,
      title: atributos.title ?? null,
      dataOriginalTitle:
        atributos['data-original-title'] ?? atributos['data-bs-original-title'] ?? null,
      alt: atributos.alt ?? null,
      ariaLabel: atributos['aria-label'] ?? null,
    });
  }
  return icones;
}

/** Ícone fiscal conhecido (bypass / gerada / cancelada / substituição) ou descrição de decisão. */
export function iconeFiscalSituacao(icone: IconeSituacaoBruto): boolean {
  const blob = [icone.src, icone.alt, icone.title, icone.dataOriginalTitle, icone.ariaLabel]
    .filter(Boolean)
    .join(' ');
  return (
    /tb[-_]?(nota[-_]?bypass|gerada|cancelada|substitu)/i.test(blob) ||
    /decis[aã]o\s*(administrativa|judicial)/i.test(blob)
  );
}

function textoSemTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokensDeClasse(classe: string): string[] {
  return classe.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function celulaDeSituacao(classe: string): boolean {
  const tokens = tokensDeClasse(classe);
  if (tokens.includes('acao') || tokens.includes('acoes') || tokens.includes('menu')) return false;
  return tokens.includes('situacao');
}

export function interpretarHtmlTabela(html: string, pagina = 1): LinhaListagem[] {
  const linhas: LinhaListagem[] = [];
  let indice = 0;
  for (const match of html.matchAll(TR)) {
    const abertura = atributosDaTag(match[1]);
    const corpo = match[2];
    const textos: string[] = [];
    let evidencia = evidenciaSituacaoVazia();
    evidencia = {
      ...evidencia,
      dataSituacao: abertura['data-situacao']?.trim() || null,
    };

    let iconesSituacao: ReturnType<typeof iconesDoFragmento> = [];
    for (const td of corpo.matchAll(TD)) {
      const atributos = atributosDaTag(td[1]);
      const classe = atributos.class ?? '';
      textos.push(textoSemTags(td[2]));
      // API-03L — data-situacao na TD (ou em descendente) quando ausente no TR.
      if (!evidencia.dataSituacao) {
        const noTd = atributos['data-situacao']?.trim();
        if (noTd) {
          evidencia = { ...evidencia, dataSituacao: noTd };
        } else {
          const nested = [...td[2].matchAll(/data-situacao\s*=\s*("([^"]*)"|'([^']*)')/gi)];
          const valor = nested[0]?.[2] ?? nested[0]?.[3];
          if (valor?.trim()) {
            evidencia = { ...evidencia, dataSituacao: valor.trim() };
          }
        }
      }
      if (!celulaDeSituacao(classe)) continue;
      iconesSituacao = iconesDoFragmento(td[2]);
      evidencia = {
        dataSituacao: evidencia.dataSituacao,
        textoColuna: textoSemTags(td[2]) || null,
        classeColuna: classe || null,
        icones: iconesSituacao,
      };
    }

    // API-03K — mescla ícones fiscais da linha mesmo se a TD situacao já tiver outro <img>.
    const iconesLinha = iconesDoFragmento(corpo).filter(iconeFiscalSituacao);
    if (iconesLinha.length > 0) {
      const mesclados = [...iconesSituacao];
      for (const fiscal of iconesLinha) {
        if (
          !mesclados.some(
            (item) =>
              item.src === fiscal.src &&
              item.alt === fiscal.alt &&
              item.dataOriginalTitle === fiscal.dataOriginalTitle
          )
        ) {
          mesclados.push(fiscal);
        }
      }
      const textoBypass = mesclados
        .map((i) => i.alt || i.dataOriginalTitle || i.title || '')
        .find((t) => /decis[aã]o\s*(administrativa|judicial)/i.test(t));
      evidencia = {
        ...evidencia,
        textoColuna: evidencia.textoColuna || textoBypass || null,
        icones: mesclados,
      };
    }

    const hrefs = [...corpo.matchAll(/href\s*=\s*("([^"]*)"|'([^']*)')/gi)].map((item) =>
      (item[2] ?? item[3] ?? '').replace(/&amp;/g, '&')
    );

    linhas.push({
      pagina,
      linha: indice,
      hrefs,
      dataChave: abertura['data-chave']?.trim() || null,
      textos,
      evidenciaSituacao: evidencia,
    });
    indice += 1;
  }
  return linhas;
}

export function descricoesDeEvidencia(evidencia: EvidenciaSituacaoBruta): string[] {
  const descricoes: string[] = [];
  if (evidencia.dataSituacao) descricoes.push(`data-situacao=${evidencia.dataSituacao}`);
  if (evidencia.textoColuna) descricoes.push(`td-situacao.texto=${evidencia.textoColuna}`);
  if (evidencia.classeColuna) descricoes.push(`td-situacao.classe=${evidencia.classeColuna}`);
  for (const icone of evidencia.icones) {
    if (icone.src) descricoes.push(`td-situacao.img.src=${icone.src}`);
    if (icone.title) descricoes.push(`td-situacao.img.title=${icone.title}`);
    if (icone.dataOriginalTitle) {
      descricoes.push(`td-situacao.img.data-original-title=${icone.dataOriginalTitle}`);
    }
    if (icone.alt) descricoes.push(`td-situacao.img.alt=${icone.alt}`);
    if (icone.ariaLabel) descricoes.push(`td-situacao.img.aria-label=${icone.ariaLabel}`);
  }
  return descricoes;
}

export function registroDaLinha(
  linha: LinhaListagem,
  direcao: DirecaoDocumentoFiscal
): RegistroDescobertaNfse {
  const chave = extrairChaveDaLinha({
    hrefs: linha.hrefs,
    dataChave: linha.dataChave,
    textos: linha.textos,
  });
  return {
    chaveNacional: chave.chave,
    direcao,
    pagina: linha.pagina,
    linha: linha.linha,
    fonteChave: chave.fonte,
    evidenciaSituacao: linha.evidenciaSituacao,
    textosCelulas: [...linha.textos],
    problemas: [...new Set(chave.problemas)],
  };
}
