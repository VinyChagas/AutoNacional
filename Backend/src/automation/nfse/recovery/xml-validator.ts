/**
 * Validação inicial do XML nacional de NFS-e.
 * Confirma chave e CNPJ pelo pai imediato: emit/prest/prestador e toma/tomador.
 * Ignora participante aninhado em outro (intermediário, emitente ou tomador).
 * dCompet é apenas metadado.
 */
import { ErroRecuperacaoSefin, type EstadoValidacaoXml } from './types';
import type { DirecaoDocumentoFiscal } from '../contracts/documento-fiscal';

export interface LeituraXmlNfse {
  validacao: EstadoValidacaoXml;
  chaveXml: string | null;
  cnpjEmitente: string | null;
  cnpjTomador: string | null;
  dCompet: string | null;
}

export function validarXmlNfse(
  xml: string,
  esperado: { chave: string; cnpj: string; direcao: DirecaoDocumentoFiscal }
): LeituraXmlNfse {
  const texto = xml.trim();
  if (!texto) {
    throw new ErroRecuperacaoSefin('XML_VAZIO', 'PERMANENTE', 'XML vazio.');
  }
  if (/<html[\s>]/i.test(texto)) {
    throw new ErroRecuperacaoSefin('HTML_NO_LUGAR_DE_XML', 'PERMANENTE', 'O conteúdo é HTML, não XML de NFS-e.');
  }

  const arvore = lerArvore(texto);
  if (!arvore.bemFormado) {
    throw new ErroRecuperacaoSefin('XML_MALFORMADO', 'PERMANENTE', 'XML malformado.');
  }
  if (arvore.raiz !== 'NFSe' || !arvore.temInfNfse) {
    return incompleta(arvore);
  }

  const chaveXml = arvore.chave;
  const cnpjEsperado = esperado.cnpj;
  const cnpjPapel = esperado.direcao === 'EMITIDA' ? arvore.cnpjEmitente : arvore.cnpjTomador;

  if (!chaveXml || !cnpjPapel) {
    return incompleta(arvore);
  }
  if (chaveXml !== esperado.chave) {
    throw new ErroRecuperacaoSefin('CHAVE_DIVERGENTE', 'PERMANENTE', 'A chave do XML não é a chave consultada.');
  }
  if (cnpjPapel !== cnpjEsperado) {
    throw new ErroRecuperacaoSefin(
      'CNPJ_DIVERGENTE',
      'PERMANENTE',
      esperado.direcao === 'EMITIDA'
        ? 'O CNPJ do emitente não é o da empresa consultada.'
        : 'O CNPJ do tomador não é o da empresa consultada.'
    );
  }

  return {
    validacao: 'CONFIRMADA',
    chaveXml,
    cnpjEmitente: arvore.cnpjEmitente,
    cnpjTomador: arvore.cnpjTomador,
    dCompet: arvore.dCompet,
  };
}

function incompleta(arvore: ArvoreXml): LeituraXmlNfse {
  return {
    validacao: 'PENDENTE',
    chaveXml: arvore.chave,
    cnpjEmitente: arvore.cnpjEmitente,
    cnpjTomador: arvore.cnpjTomador,
    dCompet: arvore.dCompet,
  };
}

interface ArvoreXml {
  bemFormado: boolean;
  raiz: string | null;
  temInfNfse: boolean;
  chave: string | null;
  cnpjEmitente: string | null;
  cnpjTomador: string | null;
  dCompet: string | null;
}

function lerArvore(xml: string): ArvoreXml {
  const arvore: ArvoreXml = {
    bemFormado: false,
    raiz: null,
    temInfNfse: false,
    chave: null,
    cnpjEmitente: null,
    cnpjTomador: null,
    dCompet: null,
  };
  const pilha: string[] = [];
  let texto = '';
  let i = 0;

  const guardarTexto = () => {
    const valor = texto.trim();
    texto = '';
    if (!valor || pilha.length === 0) return;
    const atual = pilha[pilha.length - 1];
    if (atual === 'chNFSe' && !arvore.chave) arvore.chave = valor.replace(/\D/g, '');
    if (atual === 'dCompet' && !arvore.dCompet) arvore.dCompet = valor;
    if (atual === 'CNPJ' && !arvore.cnpjEmitente && papelNoContexto(pilha, PAPEIS_EMITENTE)) {
      arvore.cnpjEmitente = valor.replace(/\D/g, '');
    }
    if (atual === 'CNPJ' && !arvore.cnpjTomador && papelNoContexto(pilha, PAPEIS_TOMADOR)) {
      arvore.cnpjTomador = valor.replace(/\D/g, '');
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
    if (nome === 'infNFSe') arvore.temInfNfse = true;
    if (!autoFecha) pilha.push(nome);
  }
  guardarTexto();
  arvore.bemFormado = pilha.length === 0;
  return arvore;
}

function fimDaTag(xml: string, inicio: number): number {
  let aspas: '"' | "'" | null = null;
  for (let i = inicio; i < xml.length; i += 1) {
    const caractere = xml[i];
    if (aspas) {
      if (caractere === aspas) aspas = null;
      continue;
    }
    if (caractere === '"' || caractere === "'") {
      aspas = caractere;
      continue;
    }
    if (caractere === '>') return i;
  }
  return -1;
}

const PAPEIS_EMITENTE = new Set(['emit', 'prest', 'prestador']);
const PAPEIS_TOMADOR = new Set(['toma', 'tomador']);
const OUTROS_PARTICIPANTES = new Set(['interm', 'intermediario', 'intermediário']);

function papelNoContexto(pilha: string[], papeis: Set<string>): boolean {
  const pai = pilha[pilha.length - 2];
  if (!pai || !papeis.has(pai)) return false;
  for (let indice = 0; indice < pilha.length - 2; indice += 1) {
    const ancestral = pilha[indice];
    if (PAPEIS_EMITENTE.has(ancestral) || PAPEIS_TOMADOR.has(ancestral) || OUTROS_PARTICIPANTES.has(ancestral)) {
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
