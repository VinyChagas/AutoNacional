/**
 * Validação inicial do XML nacional de NFS-e.
 * Confirma chave e CNPJ pelo papel fiscal: emit/prest, toma/tomador ou interm.
 * API-03O — intermediário (interm) é vínculo válido distinto de tomador.
 * dCompet é apenas metadado.
 * Namespace oficial (Manual Integrado SNNFS-e): http://www.sped.fazenda.gov.br/nfse
 * Parser próprio: não resolve entidades externas nem acessa rede.
 */
import { ErroRecuperacaoSefin, LIMITES_RECUPERACAO_PADRAO, type EstadoValidacaoXml } from './types';
import type { DirecaoDocumentoFiscal } from '../contracts/documento-fiscal';

/** URI oficial do leiaute nacional NFS-e (gov.br / Manual Integrado). */
export const NAMESPACE_OFICIAL_NFSE = 'http://www.sped.fazenda.gov.br/nfse';

/** Papel fiscal confirmado no XML (não confundir com direção Portal EMITIDA/RECEBIDA). */
export const PAPEIS_FISCAIS_XML = ['PRESTADOR', 'TOMADOR', 'INTERMEDIARIO'] as const;
export type PapelFiscalXml = (typeof PAPEIS_FISCAIS_XML)[number];

export interface LeituraXmlNfse {
  validacao: EstadoValidacaoXml;
  chaveXml: string | null;
  cnpjEmitente: string | null;
  cnpjTomador: string | null;
  /** API-03J — CPF no papel tomador quando não há CNPJ (pessoa física). */
  cpfTomador: string | null;
  /** API-03O — CNPJ em interm/intermediario. */
  cnpjIntermediario: string | null;
  /** API-03O — papel pelo qual o CNPJ da empresa foi confirmado. */
  papelConfirmado: PapelFiscalXml | null;
  dCompet: string | null;
  namespace?: string | null;
}

export function validarXmlNfse(
  xml: string,
  esperado: { chave: string; cnpj: string; direcao: DirecaoDocumentoFiscal }
): LeituraXmlNfse {
  const texto = xml.trim();
  if (!texto) {
    throw new ErroRecuperacaoSefin('XML_VAZIO', 'PERMANENTE', 'XML vazio.');
  }
  if (Buffer.byteLength(texto, 'utf8') > LIMITES_RECUPERACAO_PADRAO.maxBytesXml) {
    throw new ErroRecuperacaoSefin('LIMITE_XML', 'PERMANENTE', 'O XML excede o limite configurado.');
  }
  if (/<html[\s>]/i.test(texto)) {
    throw new ErroRecuperacaoSefin('HTML_NO_LUGAR_DE_XML', 'PERMANENTE', 'O conteúdo é HTML, não XML de NFS-e.');
  }
  // Sem resolução de entidade: DOCTYPE/ENTITY são recusados (mitigação XXE).
  if (/<!DOCTYPE/i.test(texto) || /<!ENTITY/i.test(texto)) {
    throw new ErroRecuperacaoSefin(
      'XML_ENTIDADE_EXTERNA',
      'PERMANENTE',
      'XML com DOCTYPE ou ENTITY não é aceito.'
    );
  }

  const arvore = lerArvore(texto);
  if (!arvore.bemFormado) {
    throw new ErroRecuperacaoSefin('XML_MALFORMADO', 'PERMANENTE', 'XML malformado.');
  }
  if (arvore.raiz !== 'NFSe' || !arvore.temInfNfse) {
    return incompleta(arvore, extrairNamespaceRaizNfse(texto));
  }

  const namespaceRaiz = extrairNamespaceRaizNfse(texto);
  if (!namespaceRaiz) {
    throw new ErroRecuperacaoSefin(
      'NAMESPACE_AUSENTE',
      'PERMANENTE',
      'Raiz NFSe sem declaração de namespace oficial.'
    );
  }
  if (namespaceRaiz !== NAMESPACE_OFICIAL_NFSE) {
    throw new ErroRecuperacaoSefin(
      'NAMESPACE_INVALIDO',
      'PERMANENTE',
      'Namespace da raiz NFSe diverge do leiaute nacional.'
    );
  }

  if (arvore.idInfNfseInvalido && !arvore.chaveDeElemento) {
    throw new ErroRecuperacaoSefin(
      'ID_INFNFSE_INVALIDO',
      'PERMANENTE',
      'O atributo Id de infNFSe não segue o formato NFS + 50 dígitos.'
    );
  }

  const chaveXml = arvore.chave;
  const cnpjEsperado = esperado.cnpj;

  if (!chaveXml) {
    return incompleta(arvore, namespaceRaiz);
  }
  if (chaveXml !== esperado.chave) {
    throw new ErroRecuperacaoSefin('CHAVE_DIVERGENTE', 'PERMANENTE', 'A chave do XML não é a chave consultada.');
  }

  const vinculo = resolverVinculoFiscal(arvore, cnpjEsperado, esperado.direcao);
  if (vinculo.estado === 'CONFIRMADA') {
    return {
      validacao: 'CONFIRMADA',
      chaveXml,
      cnpjEmitente: arvore.cnpjEmitente,
      cnpjTomador: arvore.cnpjTomador,
      cpfTomador: arvore.cpfTomador,
      cnpjIntermediario: arvore.cnpjIntermediario,
      papelConfirmado: vinculo.papel,
      dCompet: arvore.dCompet,
      namespace: namespaceRaiz,
    };
  }
  if (vinculo.estado === 'DIVERGENTE') {
    throw new ErroRecuperacaoSefin('CNPJ_DIVERGENTE', 'PERMANENTE', vinculo.mensagem);
  }
  if (vinculo.estado === 'TOMADOR_CPF') {
    throw new ErroRecuperacaoSefin('TOMADOR_CPF_SEM_CNPJ', 'PERMANENTE', vinculo.mensagem);
  }
  return incompleta(arvore, namespaceRaiz);
}

type VinculoFiscal =
  | { estado: 'CONFIRMADA'; papel: PapelFiscalXml }
  | { estado: 'DIVERGENTE'; mensagem: string }
  | { estado: 'TOMADOR_CPF'; mensagem: string }
  | { estado: 'INSUFICIENTE' };

/**
 * API-03O — resolve o papel pelo CNPJ da empresa em prest/toma/interm.
 * Direção Portal (EMITIDA/RECEBIDA) restringe quais papéis são elegíveis,
 * mas intermediário não é reclassificado como tomador.
 */
function resolverVinculoFiscal(
  arvore: ArvoreXml,
  cnpjEsperado: string,
  direcao: DirecaoDocumentoFiscal
): VinculoFiscal {
  if (direcao === 'EMITIDA') {
    if (!arvore.cnpjEmitente) return { estado: 'INSUFICIENTE' };
    if (arvore.cnpjEmitente !== cnpjEsperado) {
      return {
        estado: 'DIVERGENTE',
        mensagem: 'O CNPJ do emitente não é o da empresa consultada.',
      };
    }
    return { estado: 'CONFIRMADA', papel: 'PRESTADOR' };
  }

  // RECEBIDA (listagem Portal): tomador OU intermediário.
  const tomadorOk = Boolean(arvore.cnpjTomador && arvore.cnpjTomador === cnpjEsperado);
  const intermOk = Boolean(arvore.cnpjIntermediario && arvore.cnpjIntermediario === cnpjEsperado);

  if (tomadorOk) {
    return { estado: 'CONFIRMADA', papel: 'TOMADOR' };
  }
  if (intermOk) {
    return { estado: 'CONFIRMADA', papel: 'INTERMEDIARIO' };
  }

  // Tomador PF sem CNPJ e sem vínculo de intermediário da empresa.
  if (
    !arvore.cnpjTomador &&
    arvore.cpfTomador &&
    /^\d{11}$/.test(arvore.cpfTomador) &&
    !intermOk
  ) {
    return {
      estado: 'TOMADOR_CPF',
      mensagem:
        'O XML traz tomador pessoa física (CPF) sem CNPJ; não é possível confirmar vínculo com a empresa.',
    };
  }

  // Há CNPJ de tomador ou intermediário, mas nenhum é a empresa.
  if (
    (arvore.cnpjTomador && arvore.cnpjTomador !== cnpjEsperado) ||
    (arvore.cnpjIntermediario && arvore.cnpjIntermediario !== cnpjEsperado)
  ) {
    return {
      estado: 'DIVERGENTE',
      mensagem:
        arvore.cnpjIntermediario && !arvore.cnpjTomador
          ? 'O CNPJ do intermediário não é o da empresa consultada.'
          : 'O CNPJ do tomador não é o da empresa consultada.',
    };
  }

  // Sem CNPJ de tomador nem de intermediário.
  return { estado: 'INSUFICIENTE' };
}

function incompleta(arvore: ArvoreXml, namespace: string | null = null): LeituraXmlNfse {
  return {
    validacao: 'PENDENTE',
    chaveXml: arvore.chave,
    cnpjEmitente: arvore.cnpjEmitente,
    cnpjTomador: arvore.cnpjTomador,
    cpfTomador: arvore.cpfTomador,
    cnpjIntermediario: arvore.cnpjIntermediario,
    papelConfirmado: null,
    dCompet: arvore.dCompet,
    namespace,
  };
}

/**
 * Lê xmlns default ou xmlns:prefix na tag raiz NFSe.
 * Não navega pela árvore e não resolve entidades.
 */
export function extrairNamespaceRaizNfse(xml: string): string | null {
  const match = /<(?:[\w.-]+:)?NFSe\b([^>]*)>/i.exec(xml);
  if (!match) return null;
  const attrs = match[1] ?? '';
  const padrao = /\sxmlns\s*=\s*["']([^"']+)["']/.exec(attrs);
  if (padrao?.[1]) return padrao[1].trim();
  const prefixado = /\sxmlns:[\w.-]+\s*=\s*["']([^"']+)["']/.exec(attrs);
  if (prefixado?.[1]) return prefixado[1].trim();
  return null;
}

interface ArvoreXml {
  bemFormado: boolean;
  raiz: string | null;
  temInfNfse: boolean;
  /** Preferência: texto de <chNFSe>; senão Id="NFS{50}". */
  chave: string | null;
  chaveDeElemento: string | null;
  chaveDeId: string | null;
  idInfNfseInvalido: boolean;
  cnpjEmitente: string | null;
  cnpjTomador: string | null;
  cpfTomador: string | null;
  cnpjIntermediario: string | null;
  dCompet: string | null;
}

/**
 * Lê Id de infNFSe no formato nacional NFS + 50 dígitos.
 * null = atributo ausente; ok:false = presente porém inválido.
 */
export function extrairChaveDoIdInfNfse(
  brutoTag: string
): { ok: true; chave: string } | { ok: false } | null {
  const match = /\bId\s*=\s*["']([^"']*)["']/i.exec(brutoTag);
  if (!match) return null;
  const valor = (match[1] ?? '').trim();
  const chaveMatch = /^NFS(\d{50})$/.exec(valor);
  if (!chaveMatch?.[1]) return { ok: false };
  return { ok: true, chave: chaveMatch[1] };
}

function lerArvore(xml: string): ArvoreXml {
  const arvore: ArvoreXml = {
    bemFormado: false,
    raiz: null,
    temInfNfse: false,
    chave: null,
    chaveDeElemento: null,
    chaveDeId: null,
    idInfNfseInvalido: false,
    cnpjEmitente: null,
    cnpjTomador: null,
    cpfTomador: null,
    cnpjIntermediario: null,
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
    if (atual === 'chNFSe' && !arvore.chaveDeElemento) {
      arvore.chaveDeElemento = valor.replace(/\D/g, '');
    }
    if (atual === 'dCompet' && !arvore.dCompet) arvore.dCompet = valor;
    if (atual === 'CNPJ' && !arvore.cnpjEmitente && papelNoContexto(pilha, PAPEIS_EMITENTE)) {
      arvore.cnpjEmitente = valor.replace(/\D/g, '');
    }
    if (atual === 'CNPJ' && !arvore.cnpjTomador && papelNoContexto(pilha, PAPEIS_TOMADOR)) {
      arvore.cnpjTomador = valor.replace(/\D/g, '');
    }
    if (atual === 'CPF' && !arvore.cpfTomador && papelNoContexto(pilha, PAPEIS_TOMADOR)) {
      arvore.cpfTomador = valor.replace(/\D/g, '');
    }
    if (
      atual === 'CNPJ' &&
      !arvore.cnpjIntermediario &&
      papelNoContexto(pilha, PAPEIS_INTERMEDIARIO)
    ) {
      arvore.cnpjIntermediario = valor.replace(/\D/g, '');
    }
  };

  while (i < xml.length) {
    if (xml.startsWith('<?', i)) {
      const fim = xml.indexOf('?>', i);
      if (fim < 0) return finalizarArvore(arvore);
      i = fim + 2;
      continue;
    }
    if (xml.startsWith('<!--', i)) {
      const fim = xml.indexOf('-->', i + 4);
      if (fim < 0) return finalizarArvore(arvore);
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
    if (fim < 0) return finalizarArvore(arvore);
    const bruto = xml.slice(i + 1, fim).trim();
    i = fim + 1;
    if (!bruto || bruto.startsWith('?') || bruto.startsWith('!')) continue;
    if (bruto.startsWith('/')) {
      const nome = nomeLocal(bruto.slice(1));
      if (pilha.pop() !== nome) return finalizarArvore(arvore);
      continue;
    }
    const autoFecha = bruto.endsWith('/');
    const nome = nomeLocal(bruto);
    if (!arvore.raiz) arvore.raiz = nome;
    if (nome === 'infNFSe') {
      arvore.temInfNfse = true;
      if (!arvore.chaveDeId && !arvore.idInfNfseInvalido) {
        const lido = extrairChaveDoIdInfNfse(bruto);
        if (lido === null) {
          // atributo Id ausente — chave pode vir de <chNFSe>
        } else if (lido.ok) {
          arvore.chaveDeId = lido.chave;
        } else {
          arvore.idInfNfseInvalido = true;
        }
      }
    }
    if (!autoFecha) pilha.push(nome);
  }
  guardarTexto();
  arvore.bemFormado = pilha.length === 0;
  return finalizarArvore(arvore);
}

function finalizarArvore(arvore: ArvoreXml): ArvoreXml {
  arvore.chave = arvore.chaveDeElemento || arvore.chaveDeId || null;
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
const PAPEIS_INTERMEDIARIO = new Set(['interm', 'intermediario', 'intermediário']);

function papelNoContexto(pilha: string[], papeis: Set<string>): boolean {
  const pai = pilha[pilha.length - 2];
  if (!pai || !papeis.has(pai)) return false;
  for (let indice = 0; indice < pilha.length - 2; indice += 1) {
    const ancestral = pilha[indice];
    if (
      PAPEIS_EMITENTE.has(ancestral) ||
      PAPEIS_TOMADOR.has(ancestral) ||
      PAPEIS_INTERMEDIARIO.has(ancestral)
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

/** True quando falta o CNPJ do papel exigido pela direção (considera intermediário). */
export function vinculoCnpjAusenteParaDirecao(
  leitura: Pick<LeituraXmlNfse, 'cnpjEmitente' | 'cnpjTomador' | 'cnpjIntermediario'>,
  direcao: DirecaoDocumentoFiscal
): boolean {
  if (direcao === 'EMITIDA') return !leitura.cnpjEmitente;
  return !leitura.cnpjTomador && !leitura.cnpjIntermediario;
}
