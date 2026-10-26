/**
 * API-03L — diagnóstico estruturado de NFS-e INDETERMINADA.
 * Sem credenciais, certificados, cookies ou tokens.
 */
import type { DirecaoDocumentoFiscal } from '../contracts/documento-fiscal';
import type { PeriodoConsultaPortal } from '../contracts/periodo';
import type { EvidenciaColunaSituacao, ClassificacaoSituacaoNfse } from './situacao';

export const CODIGO_DIAGNOSTICO_INDETERMINADA = 'SITUACAO_INDETERMINADA';

export interface DiagnosticoNotaIndeterminada {
  codigo: typeof CODIGO_DIAGNOSTICO_INDETERMINADA;
  empresaCnpj: string;
  competenciaInicio: string;
  competenciaFim: string;
  chaveNacional: string;
  numeroNota: string | null;
  direcao: DirecaoDocumentoFiscal | null;
  pagina: number | null;
  linha: number | null;
  dataSituacaoBruto: string | null;
  textoColuna: string | null;
  classeColuna: string | null;
  icones: Array<{
    src: string | null;
    alt: string | null;
    title: string | null;
    dataOriginalTitle: string | null;
  }>;
  evidenciasFiscais: string[];
  regraAplicada: string;
  motivoBloqueio: string;
  fonteClassificacao: string;
  codigoSituacaoDesconhecido: string | null;
}

export function inferirNumeroNotaDosTextos(textos: readonly string[] | null | undefined): string | null {
  if (!textos?.length) return null;
  for (const texto of textos) {
    const t = (texto ?? '').trim();
    // Número NFS-e típico na listagem (evita chave de 50 dígitos e CNPJ 14).
    if (/^\d{1,12}$/.test(t)) return t;
  }
  return null;
}

export function motivoBloqueioIndeterminada(
  classificacao: ClassificacaoSituacaoNfse,
  evidencia: EvidenciaColunaSituacao
): { regraAplicada: string; motivoBloqueio: string } {
  if (classificacao.conflitos.length > 0) {
    return {
      regraAplicada: 'CONFLITO_SITUACAO',
      motivoBloqueio:
        'Coluna Situação com evidências atuais incompatíveis; permanece indeterminada.',
    };
  }
  if (classificacao.codigoSituacaoDesconhecido) {
    return {
      regraAplicada: 'CODIGO_SITUACAO_DESCONHECIDO',
      motivoBloqueio: `Código data-situacao não catalogado: ${classificacao.codigoSituacaoDesconhecido}.`,
    };
  }
  const temIcone = evidencia.icones.some(
    (i) => i.src || i.alt || i.title || i.dataOriginalTitle || i.ariaLabel
  );
  const temTexto = Boolean(evidencia.textoColuna?.trim());
  const temCodigo = Boolean(evidencia.dataSituacao?.trim());
  if (!temCodigo && !temIcone && !temTexto) {
    return {
      regraAplicada: 'SEM_EVIDENCIA_SITUACAO',
      motivoBloqueio:
        'Nenhuma evidência fiscal na coluna Situação (sem data-situacao, ícone ou texto reconhecível).',
    };
  }
  return {
    regraAplicada: 'EVIDENCIA_NAO_RECONHECIDA',
    motivoBloqueio:
      'Evidência capturada não mapeia para VIGENTE/CANCELADA (ícone/texto/código sem regra explícita).',
  };
}

export function montarDiagnosticoNotaIndeterminada(input: {
  cnpj: string;
  periodoConsulta: PeriodoConsultaPortal;
  chaveNacional: string;
  numeroNota?: string | null;
  direcao?: DirecaoDocumentoFiscal | null;
  pagina?: number | null;
  linha?: number | null;
  evidencia: EvidenciaColunaSituacao;
  classificacao: ClassificacaoSituacaoNfse;
}): DiagnosticoNotaIndeterminada {
  const { regraAplicada, motivoBloqueio } = motivoBloqueioIndeterminada(
    input.classificacao,
    input.evidencia
  );
  return {
    codigo: CODIGO_DIAGNOSTICO_INDETERMINADA,
    empresaCnpj: input.cnpj,
    competenciaInicio: input.periodoConsulta.inicio,
    competenciaFim: input.periodoConsulta.fim,
    chaveNacional: input.chaveNacional,
    numeroNota: input.numeroNota ?? null,
    direcao: input.direcao ?? null,
    pagina: input.pagina ?? null,
    linha: input.linha ?? null,
    dataSituacaoBruto: input.evidencia.dataSituacao?.trim() || null,
    textoColuna: input.evidencia.textoColuna?.trim() || null,
    classeColuna: input.evidencia.classeColuna?.trim() || null,
    icones: input.evidencia.icones.map((icone) => ({
      src: icone.src,
      alt: icone.alt,
      title: icone.title,
      dataOriginalTitle: icone.dataOriginalTitle,
    })),
    evidenciasFiscais: input.classificacao.evidencias.slice(0, 12),
    regraAplicada,
    motivoBloqueio,
    fonteClassificacao: input.classificacao.fonte,
    codigoSituacaoDesconhecido: input.classificacao.codigoSituacaoDesconhecido,
  };
}

/** Payload seguro para log/erro (sem segredos). */
export function resumoDiagnosticoIndeterminadaParaLog(
  d: DiagnosticoNotaIndeterminada
): Record<string, unknown> {
  return {
    codigo: d.codigo,
    cnpj: d.empresaCnpj,
    competencia: `${d.competenciaInicio}-${d.competenciaFim}`,
    chaveNacional: d.chaveNacional,
    numeroNota: d.numeroNota,
    direcao: d.direcao,
    pagina: d.pagina,
    linha: d.linha,
    dataSituacao: d.dataSituacaoBruto,
    textoColuna: d.textoColuna,
    classeColuna: d.classeColuna,
    icones: d.icones,
    regraAplicada: d.regraAplicada,
    motivoBloqueio: d.motivoBloqueio,
    fonte: d.fonteClassificacao,
    codigoSituacaoDesconhecido: d.codigoSituacaoDesconhecido,
    evidenciasFiscais: d.evidenciasFiscais,
  };
}
