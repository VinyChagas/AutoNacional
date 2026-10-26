/**
 * Extração heurística de campos fiscais do XML distribuído.
 * Parser próprio (sem rede/entidades externas), alinhado ao recovery/xml-validator.
 */
import { createHash } from 'node:crypto';
import type { PapelFiscalAdn } from './types';

export interface ExtracaoXmlAdn {
  bemFormado: boolean;
  raiz: string | null;
  chave: string | null;
  cnpjEmitente: string | null;
  cnpjTomador: string | null;
  cnpjIntermediario: string | null;
  dCompet: string | null;
  tipoEvento: string | null;
  pareceEvento: boolean;
  sha256: string;
}

const PAPEIS_EMITENTE = new Set(['emit', 'prest', 'prestador']);
const PAPEIS_TOMADOR = new Set(['toma', 'tomador', 'dest']);
const PAPEIS_INTERM = new Set(['interm', 'intermediario', 'intermediário']);

export function extrairCamposXmlAdn(xml: string): ExtracaoXmlAdn {
  const sha256 = createHash('sha256').update(xml).digest('hex');
  const base: ExtracaoXmlAdn = {
    bemFormado: false,
    raiz: null,
    chave: null,
    cnpjEmitente: null,
    cnpjTomador: null,
    cnpjIntermediario: null,
    dCompet: null,
    tipoEvento: null,
    pareceEvento: /<(?:[\w.-]+:)?evento\b/i.test(xml.slice(0, 800)),
    sha256,
  };

  if (!xml.trim().startsWith('<') || /<html[\s>]/i.test(xml)) {
    return base;
  }
  if (/<!DOCTYPE/i.test(xml) || /<!ENTITY/i.test(xml)) {
    return base;
  }

  const arvore = lerArvore(xml);
  return {
    ...arvore,
    pareceEvento: base.pareceEvento || arvore.raiz === 'evento' || Boolean(arvore.tipoEvento),
    sha256,
  };
}

export function identificarPapeisAdn(
  empresaCnpj: string,
  campos: Pick<ExtracaoXmlAdn, 'cnpjEmitente' | 'cnpjTomador' | 'cnpjIntermediario'>
): PapelFiscalAdn[] {
  const empresa = empresaCnpj.replace(/\D/g, '');
  const papeis: PapelFiscalAdn[] = [];
  if (campos.cnpjEmitente && campos.cnpjEmitente === empresa) papeis.push('emitente');
  if (campos.cnpjTomador && campos.cnpjTomador === empresa) papeis.push('tomador');
  if (campos.cnpjIntermediario && campos.cnpjIntermediario === empresa) {
    papeis.push('intermediario');
  }
  return papeis;
}

function lerArvore(xml: string): Omit<ExtracaoXmlAdn, 'sha256' | 'pareceEvento'> & {
  pareceEvento?: boolean;
} {
  const arvore = {
    bemFormado: false,
    raiz: null as string | null,
    chave: null as string | null,
    cnpjEmitente: null as string | null,
    cnpjTomador: null as string | null,
    cnpjIntermediario: null as string | null,
    dCompet: null as string | null,
    tipoEvento: null as string | null,
  };
  const pilha: string[] = [];
  let texto = '';
  let i = 0;

  const guardarTexto = () => {
    const valor = texto.trim();
    texto = '';
    if (!valor || pilha.length === 0) return;
    const atual = pilha[pilha.length - 1];
    if ((atual === 'chNFSe' || atual === 'chaveAcesso' || atual === 'ChaveAcesso') && !arvore.chave) {
      const digits = valor.replace(/\D/g, '');
      const m50 = digits.match(/\d{50}/);
      const m44 = digits.match(/\d{44}/);
      arvore.chave = m50?.[0] ?? m44?.[0] ?? (digits.length === 50 || digits.length === 44 ? digits : null);
    }
    if (atual === 'dCompet' && !arvore.dCompet) arvore.dCompet = valor;
    if ((atual === 'tpEvento' || atual === 'tipoEvento' || atual === 'TipoEvento') && !arvore.tipoEvento) {
      arvore.tipoEvento = valor;
    }
    if (atual === 'CNPJ' || atual === 'cnpj') {
      const cnpj = valor.replace(/\D/g, '');
      if (cnpj.length !== 14) return;
      if (!arvore.cnpjEmitente && papelNoContexto(pilha, PAPEIS_EMITENTE)) {
        arvore.cnpjEmitente = cnpj;
      } else if (!arvore.cnpjTomador && papelNoContexto(pilha, PAPEIS_TOMADOR)) {
        arvore.cnpjTomador = cnpj;
      } else if (!arvore.cnpjIntermediario && papelNoContexto(pilha, PAPEIS_INTERM)) {
        arvore.cnpjIntermediario = cnpj;
      }
    }
  };

  while (i < xml.length) {
    if (xml.startsWith('<?', i)) {
      const fim = xml.indexOf('?>', i);
      if (fim < 0) return arvore;
      i = fim + 2;
      continue;
    }
    if (xml.startsWith('<!--', i)) {
      const fim = xml.indexOf('-->', i + 4);
      if (fim < 0) return arvore;
      i = fim + 3;
      continue;
    }
    if (xml[i] !== '<') {
      texto += xml[i];
      i += 1;
      continue;
    }
    guardarTexto();
    const fim = fimDaTag(xml, i + 1);
    if (fim < 0) return arvore;
    const bruto = xml.slice(i + 1, fim).trim();
    i = fim + 1;
    if (!bruto || bruto.startsWith('?') || bruto.startsWith('!')) continue;
    if (bruto.startsWith('/')) {
      const nome = nomeLocal(bruto.slice(1));
      if (pilha.pop() !== nome) return arvore;
      continue;
    }
    const autoFecha = bruto.endsWith('/');
    const nome = nomeLocal(bruto);
    if (!arvore.raiz) arvore.raiz = nome;
    if (!autoFecha) pilha.push(nome);
  }
  guardarTexto();
  arvore.bemFormado = pilha.length === 0;
  return arvore;
}

function fimDaTag(xml: string, inicio: number): number {
  let aspas: '"' | "'" | null = null;
  for (let i = inicio; i < xml.length; i += 1) {
    const c = xml[i];
    if (aspas) {
      if (c === aspas) aspas = null;
      continue;
    }
    if (c === '"' || c === "'") {
      aspas = c;
      continue;
    }
    if (c === '>') return i;
  }
  return -1;
}

function papelNoContexto(pilha: string[], papeis: Set<string>): boolean {
  const pai = pilha[pilha.length - 2];
  if (!pai || !papeis.has(pai)) return false;
  for (let indice = 0; indice < pilha.length - 2; indice += 1) {
    const ancestral = pilha[indice];
    if (
      PAPEIS_EMITENTE.has(ancestral) ||
      PAPEIS_TOMADOR.has(ancestral) ||
      PAPEIS_INTERM.has(ancestral)
    ) {
      return false;
    }
  }
  return true;
}

function nomeLocal(tag: string): string {
  const nome = tag.replace(/\/$/, '').trim().split(/\s+/)[0] ?? '';
  const indice = nome.lastIndexOf(':');
  return indice >= 0 ? nome.slice(indice + 1) : nome;
}

export function normalizarCompetenciaAdn(raw?: string | null): string | undefined {
  if (!raw?.trim()) return undefined;
  const valor = raw.trim();
  const digits = valor.replace(/\D/g, '');
  if (digits.length === 6) {
    const a = Number(digits.slice(0, 4));
    if (a >= 2000 && a <= 2100) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}`;
    return `${digits.slice(2, 6)}-${digits.slice(0, 2)}`;
  }
  if (/^\d{4}-\d{2}/.test(valor)) return valor.slice(0, 7);
  return valor;
}
