/**
 * Classificação fiscal da coluna Situação.
 * Função pura: não abre navegador, não baixa arquivo e não consulta serviço externo.
 */
import {
  criarDocumentoFiscal,
  type DirecaoDocumentoFiscal,
  type DocumentoFiscalNfse,
  type EvidenciaSituacao,
  type SituacaoDocumentoFiscal,
} from '../contracts/documento-fiscal';
import type { CompetenciaFiscalXml, PeriodoConsultaPortal } from '../contracts/periodo';

/** Código observado no Portal Nacional para NFS-e cancelada. */
export const CODIGO_DATA_SITUACAO_CANCELADA = 'P104_NFSE_CANCELADA';

/**
 * Nenhum código data-situacao de vigência foi observado.
 * A lista fica vazia de propósito: código desconhecido não vira vigente.
 */
export const CODIGOS_DATA_SITUACAO_VIGENTE: readonly string[] = [];

export const CONFLITO_SITUACAO = 'CONFLITO_SITUACAO';
export const CODIGO_SITUACAO_DESCONHECIDO = 'CODIGO_SITUACAO_DESCONHECIDO';

export const FONTES_CLASSIFICACAO_SITUACAO = [
  'tr.data-situacao',
  'td.td-situacao',
  'icone.situacao',
  'nao_identificada',
] as const;
export type FonteClassificacaoSituacao = (typeof FONTES_CLASSIFICACAO_SITUACAO)[number];

export interface IconeColunaSituacao {
  src: string | null;
  title: string | null;
  dataOriginalTitle: string | null;
  alt: string | null;
  ariaLabel: string | null;
}

/** Evidência já restrita à linha e à coluna Situação. Menu de ações não entra. */
export interface EvidenciaColunaSituacao {
  dataSituacao: string | null;
  textoColuna: string | null;
  classeColuna: string | null;
  icones: readonly IconeColunaSituacao[];
}

export interface ClassificacaoSituacaoNfse {
  situacao: SituacaoDocumentoFiscal;
  origemClassificacao: 'PORTAL';
  fonte: FonteClassificacaoSituacao;
  evidenciaDeterminante: string | null;
  evidencias: string[];
  conflitos: string[];
  codigoSituacaoDesconhecido: string | null;
}

interface SinalAtual {
  situacao: 'CANCELADA' | 'VIGENTE';
  fonte: FonteClassificacaoSituacao;
  determinante: string;
  historicoEmissao: boolean;
}

const CANCELADA_FISCAL = /tb[-_]?cancelada\.svg|nfs-?e\s*cancelada|\bcancelada\b/i;
const GERADA = /tb[-_]?gerada\.svg|nfs-?e\s*gerada/i;
const EMITIDA = /nfs-?e\s*emitida/i;

export function classificarSituacao(evidencia: EvidenciaColunaSituacao): ClassificacaoSituacaoNfse {
  const brutas = descreverEvidenciaBruta(evidencia);
  const codigo = evidencia.dataSituacao?.trim() || null;
  const sinais = sinaisDaColuna(evidencia);

  if (codigo === CODIGO_DATA_SITUACAO_CANCELADA) {
    return fechar({
      situacao: 'CANCELADA',
      fonte: 'tr.data-situacao',
      evidenciaDeterminante: `data-situacao=${codigo}`,
      evidencias: [`data-situacao=${codigo}`, ...brutas, ...notasDeHistorico(sinais)],
      conflitos: [],
      codigoSituacaoDesconhecido: null,
    });
  }

  if (codigo && !CODIGOS_DATA_SITUACAO_VIGENTE.includes(codigo)) {
    const conflitos = sinaisConflitam(sinais) ? [CONFLITO_SITUACAO] : [];
    return fechar({
      situacao: 'INDETERMINADA',
      fonte: 'tr.data-situacao',
      evidenciaDeterminante: `data-situacao.desconhecido=${codigo}`,
      evidencias: [
        `data-situacao=${codigo}`,
        `data-situacao.desconhecido=${codigo}`,
        'código data-situacao não observado; ícone de vigência não substitui o código',
        ...brutas,
      ],
      conflitos,
      codigoSituacaoDesconhecido: codigo,
    });
  }

  if (sinaisConflitam(sinais)) {
    return fechar({
      situacao: 'INDETERMINADA',
      fonte: 'nao_identificada',
      evidenciaDeterminante: null,
      evidencias: [CONFLITO_SITUACAO, ...brutas, ...sinais.map((sinal) => `sinal=${sinal.determinante}`)],
      conflitos: [CONFLITO_SITUACAO],
      codigoSituacaoDesconhecido: null,
    });
  }

  const cancelada = escolher(sinais, 'CANCELADA');
  if (cancelada) {
    return fechar({
      situacao: 'CANCELADA',
      fonte: cancelada.fonte,
      evidenciaDeterminante: cancelada.determinante,
      evidencias: [cancelada.determinante, ...brutas, ...notasDeHistorico(sinais)],
      conflitos: [],
      codigoSituacaoDesconhecido: null,
    });
  }

  const vigente = sinais.find((sinal) => sinal.situacao === 'VIGENTE');
  if (vigente) {
    return fechar({
      situacao: 'VIGENTE',
      fonte: vigente.fonte,
      evidenciaDeterminante: vigente.determinante,
      evidencias: [vigente.determinante, ...brutas],
      conflitos: [],
      codigoSituacaoDesconhecido: null,
    });
  }

  return fechar({
    situacao: 'INDETERMINADA',
    fonte: 'nao_identificada',
    evidenciaDeterminante: null,
    evidencias: brutas.length > 0 ? brutas : ['nenhuma evidência de situação na coluna Situação'],
    conflitos: [],
    codigoSituacaoDesconhecido: null,
  });
}

export function evidenciasDaClassificacao(classificacao: ClassificacaoSituacaoNfse): EvidenciaSituacao[] {
  const descricoes = [
    `fonte=${classificacao.fonte}`,
    classificacao.evidenciaDeterminante ? `determinante=${classificacao.evidenciaDeterminante}` : '',
    ...classificacao.conflitos.map((codigo) => `conflito=${codigo}`),
    ...classificacao.evidencias,
  ].filter((item, indice, lista) => item && lista.indexOf(item) === indice);

  return descricoes.map((descricao) => ({ origem: 'PORTAL', descricao }));
}

export function documentoClassificado(input: {
  chaveNacional: string;
  cnpj: string;
  direcao: DirecaoDocumentoFiscal;
  periodoConsulta: PeriodoConsultaPortal;
  competenciaFiscalXml?: CompetenciaFiscalXml;
  evidencia: EvidenciaColunaSituacao;
}): DocumentoFiscalNfse {
  const classificacao = classificarSituacao(input.evidencia);
  return criarDocumentoFiscal({
    chaveNacional: input.chaveNacional,
    cnpj: input.cnpj,
    direcao: input.direcao,
    situacao: classificacao.situacao,
    periodoConsulta: input.periodoConsulta,
    competenciaFiscalXml: input.competenciaFiscalXml,
    origemClassificacao: classificacao.origemClassificacao,
    evidencias: evidenciasDaClassificacao(classificacao),
  });
}

function fechar(parcial: Omit<ClassificacaoSituacaoNfse, 'origemClassificacao'>): ClassificacaoSituacaoNfse {
  return { origemClassificacao: 'PORTAL', ...parcial };
}

function sinaisDaColuna(evidencia: EvidenciaColunaSituacao): SinalAtual[] {
  const sinais: SinalAtual[] = [];
  const texto = evidencia.textoColuna?.trim() ?? '';
  const classe = evidencia.classeColuna?.trim() ?? '';
  const doTexto = sinalDeTrecho(texto, 'td.td-situacao', `td-situacao.texto=${texto}`);
  const daClasse = sinalDeTrecho(classe, 'td.td-situacao', `td-situacao.classe=${classe}`);
  if (doTexto) sinais.push(doTexto);
  if (daClasse && daClasse.situacao === 'CANCELADA') sinais.push(daClasse);

  for (const icone of evidencia.icones) {
    sinais.push(...sinaisDoIcone(icone));
  }
  return sinais;
}

function sinaisDoIcone(icone: IconeColunaSituacao): SinalAtual[] {
  const atributos: Array<[string, string | null]> = [
    ['src', icone.src],
    ['data-original-title', icone.dataOriginalTitle],
    ['title', icone.title],
    ['alt', icone.alt],
    ['aria-label', icone.ariaLabel],
  ];
  const sinais: SinalAtual[] = [];
  for (const [nome, valor] of atributos) {
    const texto = valor?.trim() ?? '';
    const sinal = sinalDeTrecho(texto, 'icone.situacao', `td-situacao.img.${nome}=${texto}`);
    if (sinal) sinais.push(sinal);
  }
  return sinais;
}

function sinalDeTrecho(
  texto: string,
  fonte: FonteClassificacaoSituacao,
  determinante: string
): SinalAtual | null {
  if (!texto || ehSomenteAcaoCancelar(texto)) return null;
  if (CANCELADA_FISCAL.test(texto)) {
    return { situacao: 'CANCELADA', fonte, determinante, historicoEmissao: false };
  }
  if (GERADA.test(texto)) {
    return { situacao: 'VIGENTE', fonte, determinante, historicoEmissao: true };
  }
  if (EMITIDA.test(texto)) {
    return { situacao: 'VIGENTE', fonte, determinante, historicoEmissao: false };
  }
  return null;
}

function ehSomenteAcaoCancelar(texto: string): boolean {
  return /\bcancelar\b/i.test(texto) && !CANCELADA_FISCAL.test(texto);
}

function sinaisConflitam(sinais: readonly SinalAtual[]): boolean {
  const canceladaAtual = sinais.some((sinal) => sinal.situacao === 'CANCELADA');
  const vigenteAtual = sinais.some((sinal) => sinal.situacao === 'VIGENTE' && !sinal.historicoEmissao);
  return canceladaAtual && vigenteAtual;
}

function escolher(sinais: readonly SinalAtual[], situacao: 'CANCELADA' | 'VIGENTE'): SinalAtual | null {
  return sinais.find((sinal) => sinal.situacao === situacao) ?? null;
}

function notasDeHistorico(sinais: readonly SinalAtual[]): string[] {
  return sinais
    .filter((sinal) => sinal.historicoEmissao)
    .map((sinal) => `historico-emissao=${sinal.determinante}`);
}

function descreverEvidenciaBruta(evidencia: EvidenciaColunaSituacao): string[] {
  const descricoes: string[] = [];
  if (evidencia.dataSituacao?.trim()) descricoes.push(`data-situacao=${evidencia.dataSituacao.trim()}`);
  if (evidencia.textoColuna?.trim()) descricoes.push(`td-situacao.texto=${evidencia.textoColuna.trim()}`);
  if (evidencia.classeColuna?.trim()) descricoes.push(`td-situacao.classe=${evidencia.classeColuna.trim()}`);
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
