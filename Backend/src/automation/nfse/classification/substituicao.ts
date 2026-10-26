/**
 * API-03D — vínculos de substituição comprováveis pelo XML nacional.
 *
 * Regras (leiaute DPS / TStat):
 * - `subst/chSubstda` na substituta aponta a chave da original.
 * - cStat sozinho NÃO prova situação atual (cancelamento é evento; cStat não muda).
 * - Original comprovadamente substituída → fora da meta de XMLs vigentes (CANCELADA).
 * - Substituta permanece VIGENTE até cancelamento próprio.
 * - Cadeias A←B←C: só a ponta sem sucessora é vigente; intermediárias saem da meta.
 * - Documento desconhecido permanece intocado.
 */
import {
  criarDocumentoFiscal,
  validarChaveNacional,
  type DocumentoFiscalNfse,
} from '../contracts/documento-fiscal';
import {
  calcularTotaisInventario,
  montarInventario,
  type InventarioNfse,
} from '../contracts/inventario';

export interface VinculoSubstituicaoXml {
  /** Chave da nota que contém `<subst>` (substituta). */
  chaveSubstituta: string;
  /** Valor de `chSubstda` (original substituída). */
  chaveOriginalSubstituida: string;
  cStatSubstituta: string | null;
  cMotivo: string | null;
  xMotivo: string | null;
}

export interface LeituraSubstituicaoXml {
  chaveNacional: string | null;
  cStat: string | null;
  dCompet: string | null;
  nNFSe: string | null;
  vinculo: VinculoSubstituicaoXml | null;
}

const RE_CHAVE = /\b(\d{50})\b/;

/**
 * Extrai chave, cStat e vínculo de substituição sem parser DOM externo.
 * Não resolve entidades; ignora assinatura.
 */
export function lerSubstituicaoDoXmlNfse(xml: string): LeituraSubstituicaoXml {
  const texto = String(xml ?? '');
  const chaveDeId = texto.match(/\bId\s*=\s*["']NFS(\d{50})["']/i)?.[1] ?? null;
  const chaveDeTag = texto.match(/<chNFSe[^>]*>\s*(\d{50})\s*<\/chNFSe>/i)?.[1] ?? null;
  const chaveNacional = chaveDeId || chaveDeTag;

  const cStat = texto.match(/<cStat[^>]*>\s*([^<]+?)\s*<\/cStat>/i)?.[1]?.trim() ?? null;
  const dCompet = texto.match(/<dCompet[^>]*>\s*([^<]+?)\s*<\/dCompet>/i)?.[1]?.trim() ?? null;
  const nNFSe = texto.match(/<nNFSe[^>]*>\s*([^<]+?)\s*<\/nNFSe>/i)?.[1]?.trim() ?? null;

  const blocoSubst = texto.match(/<subst\b[^>]*>([\s\S]*?)<\/subst>/i)?.[1] ?? null;
  let vinculo: VinculoSubstituicaoXml | null = null;
  if (blocoSubst && chaveNacional) {
    const chSubstda = blocoSubst.match(/<chSubstda[^>]*>\s*(\d{50})\s*<\/chSubstda>/i)?.[1] ?? null;
    if (chSubstda && chSubstda !== chaveNacional) {
      vinculo = {
        chaveSubstituta: chaveNacional,
        chaveOriginalSubstituida: chSubstda,
        cStatSubstituta: cStat,
        cMotivo: blocoSubst.match(/<cMotivo[^>]*>\s*([^<]+?)\s*<\/cMotivo>/i)?.[1]?.trim() ?? null,
        xMotivo: blocoSubst.match(/<xMotivo[^>]*>\s*([^<]+?)\s*<\/xMotivo>/i)?.[1]?.trim() ?? null,
      };
    }
  }

  return { chaveNacional, cStat, dCompet, nNFSe, vinculo };
}

export function coletarVinculosSubstituicao(
  xmls: readonly string[]
): VinculoSubstituicaoXml[] {
  const porSubstituta = new Map<string, VinculoSubstituicaoXml>();
  for (const xml of xmls) {
    const lido = lerSubstituicaoDoXmlNfse(xml);
    if (!lido.vinculo) continue;
    try {
      validarChaveNacional(lido.vinculo.chaveSubstituta);
      validarChaveNacional(lido.vinculo.chaveOriginalSubstituida);
    } catch {
      continue;
    }
    porSubstituta.set(lido.vinculo.chaveSubstituta, lido.vinculo);
  }
  return [...porSubstituta.values()];
}

/**
 * Conjunto de chaves que foram substituídas por alguma outra no grafo (transitivo).
 * A ponta final da cadeia (sem sucessora) NÃO entra no conjunto.
 */
export function chavesOriginaisSubstituidas(
  vinculos: readonly VinculoSubstituicaoXml[]
): Set<string> {
  const substituidas = new Set<string>();
  for (const v of vinculos) {
    substituidas.add(v.chaveOriginalSubstituida);
  }
  // Cadeia: se A←B e B←C, A e B saem; C permanece se não for chSubstda de ninguém.
  return substituidas;
}

/**
 * Ajusta inventário: originais com vínculo comprovado → CANCELADA (fora da meta vigente).
 * Substitutas não são forçadas a VIGENTE se o Portal as marcou CANCELADA/INDETERMINADA
 * sem evidência própria — apenas removemos a original da meta.
 * Preserva histórico via evidências com chaves.
 */
export function ajustarInventarioPorSubstituicoes(
  inventario: InventarioNfse,
  vinculos: readonly VinculoSubstituicaoXml[]
): InventarioNfse {
  if (vinculos.length === 0) return inventario;
  const originais = chavesOriginaisSubstituidas(vinculos);
  if (originais.size === 0) return inventario;

  const porSubstituta = new Map(vinculos.map((v) => [v.chaveOriginalSubstituida, v]));

  const documentos = inventario.documentos.map((doc) => {
    if (!originais.has(doc.chaveNacional)) return doc;
    if (doc.situacao === 'CANCELADA') {
      // Já fora da meta; só enriquece evidência se ainda não houver vínculo.
      const v = porSubstituta.get(doc.chaveNacional);
      if (!v) return doc;
      const jaTem = doc.evidencias.some((e) => e.descricao.includes('chSubstda='));
      if (jaTem) return doc;
      return criarDocumentoFiscal({
        ...doc,
        evidencias: [
          ...doc.evidencias,
          {
            origem: 'XML',
            descricao: `original_substituida;substituta=${v.chaveSubstituta};chSubstda=${v.chaveOriginalSubstituida}`,
          },
        ],
      });
    }
    const v = porSubstituta.get(doc.chaveNacional);
    return criarDocumentoFiscal({
      chaveNacional: doc.chaveNacional,
      cnpj: doc.cnpj,
      direcao: doc.direcao,
      situacao: 'CANCELADA',
      periodoConsulta: doc.periodoConsulta,
      competenciaFiscalXml: doc.competenciaFiscalXml,
      origemClassificacao: 'XML',
      evidencias: [
        ...doc.evidencias,
        {
          origem: 'XML',
          descricao: v
            ? `original_substituida;substituta=${v.chaveSubstituta};chSubstda=${v.chaveOriginalSubstituida}`
            : `original_substituida;chave=${doc.chaveNacional}`,
        },
      ],
    });
  });

  return montarInventario({
    id: inventario.id,
    cnpj: inventario.cnpj,
    periodoConsulta: inventario.periodoConsulta,
    documentos,
    completude: inventario.completude,
  });
}

/** Atalho: XMLs → inventário ajustado. */
export function ajustarInventarioComXmlsSubstituicao(
  inventario: InventarioNfse,
  xmls: readonly string[]
): InventarioNfse {
  return ajustarInventarioPorSubstituicoes(inventario, coletarVinculosSubstituicao(xmls));
}

export function totaisAposSubstituicao(inventario: InventarioNfse): ReturnType<typeof calcularTotaisInventario> {
  return calcularTotaisInventario(inventario.documentos);
}

/** Utilitário de teste/diagnóstico. */
export function extrairChave50(texto: string): string | null {
  return texto.match(RE_CHAVE)?.[1] ?? null;
}
