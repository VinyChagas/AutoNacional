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
 * Código observado no Portal (piloto 7610) para NFS-e gerada/válida.
 * Alinha ao ícone `tb-gerada.svg` / título "NFS-e Gerada" já tratados como VIGENTE.
 * Outros códigos data-situacao continuam indeterminados até observação explícita.
 */
export const CODIGO_DATA_SITUACAO_GERADA = 'P100_GERADA';

/**
 * Prefixo Portal alinhado ao TStat 101 do leiaute nacional (XSD):
 * "101 - NFS-e de Substituição Gerada".
 * É a nota SUBSTITUTA (gerada), não a original cancelada por substituição.
 * cStat no XML é status de emissão; cancelamento é evento e não altera cStat.
 */
export const PREFIXO_DATA_SITUACAO_SUBSTITUICAO_GERADA = 'P101';

/**
 * Prefixo Portal alinhado ao TStat 102 do leiaute nacional:
 * "102 - NFS-e de Decisão Judicial ou Administrativa".
 * NFS-e gerada/válida (fluxo bypass municipal); permanece VIGENTE até
 * cancelamento comprovado (P104) ou substituição comprovada (P105 / vínculo XML).
 * Observado no Portal como P102_NFSE_DECISAO_JUDICIAL_GERADA.
 */
export const PREFIXO_DATA_SITUACAO_DECISAO_JUDICIAL = 'P102';

/**
 * Observado no Portal (AMIL 08/2026): original após substituição.
 * Fora da meta de XMLs vigentes; não bloqueia recuperação (como cancelada).
 */
export const CODIGO_DATA_SITUACAO_SUBSTITUIDA = 'P105_NFSE_SUBSTITUIDA';

/**
 * Códigos data-situacao de vigência observados no Portal.
 * Código fora desta lista (e ≠ cancelada / ≠ substituída / ≠ P101* / ≠ P102*) permanece INDETERMINADA.
 */
export const CODIGOS_DATA_SITUACAO_VIGENTE: readonly string[] = [CODIGO_DATA_SITUACAO_GERADA];

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
/** Substituta gerada (TStat 101) — permanece vigente até cancelamento próprio. */
const SUBSTITUICAO_GERADA =
  /tb[-_]?substitui[cç][aã]o|nfs-?e\s*de\s*substitui|substitui[cç][aã]o\s*gerada/i;
/** Original cancelada por substituição (evento 105102) — fora da meta de vigentes. */
const SUBSTITUIDA_ORIGINAL =
  /tb[-_]?substitu[ií]da\.svg|nfs-?e\s*substitu[ií]da|\bsubstitu[ií]da\b/i;
/**
 * TStat 102 — NFS-e emitida via decisão administrativa/judicial (gerada/válida).
 * API-03J — inclui ícone oficial do Portal `tb-nota-bypass.svg` (fluxo bypass).
 */
const DECISAO_JUDICIAL =
  /tb[-_]?nota[-_]?bypass\.svg|decis[aã]o\s*(administrativa|judicial)|nfs-?e\s*de\s*decis[aã]o|emitida\s+via\s+decis[aã]o/i;
const GERADA = /tb[-_]?gerada\.svg|nfs-?e\s*gerada/i;
const EMITIDA = /nfs-?e\s*emitida/i;

/** Normaliza data-situacao do Portal (case, ZWSP, espaços, hífens → underscore). */
export function normalizarCodigoDataSituacaoPortal(codigo: string | null | undefined): string {
  return (codigo ?? '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
}

export function ehCodigoSubstituicaoGeradaPortal(codigo: string | null | undefined): boolean {
  const c = normalizarCodigoDataSituacaoPortal(codigo);
  if (!c) return false;
  return (
    c === PREFIXO_DATA_SITUACAO_SUBSTITUICAO_GERADA ||
    c.startsWith(`${PREFIXO_DATA_SITUACAO_SUBSTITUICAO_GERADA}_`)
  );
}

/** NFS-e gerada por decisão adm./judicial (TStat 102) — vigente até evento posterior. */
export function ehCodigoDecisaoJudicialPortal(codigo: string | null | undefined): boolean {
  const c = normalizarCodigoDataSituacaoPortal(codigo);
  if (!c) return false;
  // P102, P102_*, P102NFSE_* (sem underscore imediato após 102).
  if (c === PREFIXO_DATA_SITUACAO_DECISAO_JUDICIAL || /^P102(?:_|[A-Z])/.test(c)) return true;
  // XML/cStat bruto ou data-situacao numérico alinhado ao TStat 102.
  return c === '102' || c === 'TSTAT_102' || c === 'CSTAT_102';
}

/** Ícone/texto Portal de bypass (decisão adm./judicial). */
export function ehEvidenciaBypassDecisaoJudicial(texto: string | null | undefined): boolean {
  return DECISAO_JUDICIAL.test((texto ?? '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim());
}

/**
 * API-03K — evidência explícita de decisão adm./judicial na coluna (código, texto ou ícone).
 * Não promove situações desconhecidas: exige P102/102, tb-nota-bypass ou texto de decisão.
 */
export function evidenciaTemDecisaoAdministrativaJudicial(
  evidencia: EvidenciaColunaSituacao
): { presente: boolean; determinante: string | null } {
  if (ehCodigoDecisaoJudicialPortal(evidencia.dataSituacao)) {
    return {
      presente: true,
      determinante: `data-situacao=${evidencia.dataSituacao?.trim()}`,
    };
  }
  const texto = evidencia.textoColuna?.trim() ?? '';
  if (ehEvidenciaBypassDecisaoJudicial(texto)) {
    return { presente: true, determinante: `td-situacao.texto=${texto}` };
  }
  for (const icone of evidencia.icones) {
    const attrs: Array<[string, string | null]> = [
      ['src', icone.src],
      ['alt', icone.alt],
      ['data-original-title', icone.dataOriginalTitle],
      ['title', icone.title],
      ['aria-label', icone.ariaLabel],
    ];
    for (const [nome, valor] of attrs) {
      if (ehEvidenciaBypassDecisaoJudicial(valor)) {
        return { presente: true, determinante: `td-situacao.img.${nome}=${valor?.trim()}` };
      }
    }
  }
  return { presente: false, determinante: null };
}

export function classificarSituacao(evidencia: EvidenciaColunaSituacao): ClassificacaoSituacaoNfse {
  const brutas = descreverEvidenciaBruta(evidencia);
  const codigoBruto = evidencia.dataSituacao?.replace(/[\u200B-\u200D\uFEFF]/g, '').trim() || null;
  const codigo = codigoBruto;
  const sinais = sinaisDaColuna(evidencia);
  const decisaoJudicial = evidenciaTemDecisaoAdministrativaJudicial(evidencia);

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

  if (codigo === CODIGO_DATA_SITUACAO_SUBSTITUIDA) {
    return fechar({
      situacao: 'CANCELADA',
      fonte: 'tr.data-situacao',
      evidenciaDeterminante: `data-situacao=${codigo}`,
      evidencias: [
        `data-situacao=${codigo}`,
        'P105_NFSE_SUBSTITUIDA = original substituída (fora da meta de vigentes)',
        ...brutas,
        ...notasDeHistorico(sinais),
      ],
      conflitos: [],
      codigoSituacaoDesconhecido: null,
    });
  }

  if (codigo === CODIGO_DATA_SITUACAO_GERADA) {
    return fechar({
      situacao: 'VIGENTE',
      fonte: 'tr.data-situacao',
      evidenciaDeterminante: `data-situacao=${codigo}`,
      evidencias: [`data-situacao=${codigo}`, ...brutas],
      conflitos: [],
      codigoSituacaoDesconhecido: null,
    });
  }

  if (ehCodigoSubstituicaoGeradaPortal(codigo)) {
    return fechar({
      situacao: 'VIGENTE',
      fonte: 'tr.data-situacao',
      evidenciaDeterminante: `data-situacao=${codigo}`,
      evidencias: [
        `data-situacao=${codigo}`,
        'TStat 101 = NFS-e de Substituição Gerada (substituta vigente)',
        ...brutas,
      ],
      conflitos: [],
      codigoSituacaoDesconhecido: null,
    });
  }

  if (ehCodigoDecisaoJudicialPortal(codigo)) {
    // Cancelamento/substituição comprovados na coluna prevalecem sobre o código de geração.
    const cancelada = escolher(sinais, 'CANCELADA');
    if (cancelada) {
      return fechar({
        situacao: 'CANCELADA',
        fonte: cancelada.fonte,
        evidenciaDeterminante: cancelada.determinante,
        evidencias: [
          cancelada.determinante,
          `data-situacao=${codigo}`,
          'evento posterior ao TStat 102 prevalece',
          ...brutas,
        ],
        conflitos: [],
        codigoSituacaoDesconhecido: null,
      });
    }
    return fechar({
      situacao: 'VIGENTE',
      fonte: 'tr.data-situacao',
      evidenciaDeterminante: `data-situacao=${codigo}`,
      evidencias: [
        `data-situacao=${codigo}`,
        'TStat 102 = NFS-e de Decisão Judicial/Administrativa (gerada válida)',
        ...brutas,
        ...notasDeHistorico(sinais),
      ],
      conflitos: [],
      codigoSituacaoDesconhecido: null,
    });
  }

  if (codigo && !CODIGOS_DATA_SITUACAO_VIGENTE.includes(codigo)) {
    // API-03K — bypass explícito (ícone/texto) prevalece sobre código ainda não catalogado.
    const canceladaComCodigo = escolher(sinais, 'CANCELADA');
    if (decisaoJudicial.presente && !canceladaComCodigo) {
      return fechar({
        situacao: 'VIGENTE',
        fonte: 'icone.situacao',
        evidenciaDeterminante: decisaoJudicial.determinante,
        evidencias: [
          decisaoJudicial.determinante!,
          `data-situacao=${codigo}`,
          'tb-nota-bypass / decisão adm.-judicial = TStat 102 vigente',
          ...brutas,
        ],
        conflitos: [],
        codigoSituacaoDesconhecido: null,
      });
    }
    const conflitos = sinaisConflitam(sinais) ? [CONFLITO_SITUACAO] : [];
    return fechar({
      situacao: 'INDETERMINADA',
      fonte: 'tr.data-situacao',
      evidenciaDeterminante: `data-situacao.desconhecido=${codigo}`,
      evidencias: [
        `data-situacao=${codigo}`,
        `data-situacao.desconhecido=${codigo}`,
        'código data-situacao não observado; ícone genérico não substitui o código',
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

  // API-03K — decisão adm./judicial explícita mesmo sem data-situacao / sem sinal genérico.
  if (decisaoJudicial.presente) {
    return fechar({
      situacao: 'VIGENTE',
      fonte: 'icone.situacao',
      evidenciaDeterminante: decisaoJudicial.determinante,
      evidencias: [
        decisaoJudicial.determinante!,
        'TStat 102 = NFS-e de Decisão Judicial/Administrativa (gerada válida)',
        ...brutas,
      ],
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
  const limpo = texto.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
  if (!limpo || ehSomenteAcaoCancelar(limpo)) return null;
  // Ordem: "substituição gerada" (substituta) antes de "substituída" (original).
  if (SUBSTITUICAO_GERADA.test(limpo)) {
    return { situacao: 'VIGENTE', fonte, determinante, historicoEmissao: true };
  }
  if (SUBSTITUIDA_ORIGINAL.test(limpo)) {
    return { situacao: 'CANCELADA', fonte, determinante, historicoEmissao: false };
  }
  if (CANCELADA_FISCAL.test(limpo)) {
    return { situacao: 'CANCELADA', fonte, determinante, historicoEmissao: false };
  }
  if (DECISAO_JUDICIAL.test(limpo)) {
    return { situacao: 'VIGENTE', fonte, determinante, historicoEmissao: true };
  }
  if (GERADA.test(limpo)) {
    return { situacao: 'VIGENTE', fonte, determinante, historicoEmissao: true };
  }
  if (EMITIDA.test(limpo)) {
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
