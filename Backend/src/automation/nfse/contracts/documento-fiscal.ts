/**
 * Documento fiscal descoberto no Portal Nacional.
 * A situação já vem classificada por quem chamar o contrato.
 * Esta etapa não lê HTML, XML nem data-situacao.
 */
import { limparDocumento } from '../../../utils/documento-certificado';
import { ContratoNfseError } from './erros';
import {
  COMPETENCIA_FISCAL_XML,
  PERIODO_CONSULTA_PORTAL,
  periodosConsultaIguais,
  type CompetenciaFiscalXml,
  type PeriodoConsultaPortal,
} from './periodo';

export const TAMANHO_CHAVE_NACIONAL = 50;

export const SITUACOES_DOCUMENTO_FISCAL = ['VIGENTE', 'CANCELADA', 'INDETERMINADA'] as const;
export type SituacaoDocumentoFiscal = (typeof SITUACOES_DOCUMENTO_FISCAL)[number];

export const DIRECOES_DOCUMENTO_FISCAL = ['EMITIDA', 'RECEBIDA'] as const;
export type DirecaoDocumentoFiscal = (typeof DIRECOES_DOCUMENTO_FISCAL)[number];

/**
 * Correspondência com `TipoNotaUi` de download-operation-types.ts.
 * O contrato não importa aquele módulo para não acoplar Playwright.
 */
export const DIRECAO_PARA_TIPO_NOTA_UI = {
  EMITIDA: 'Emitidas',
  RECEBIDA: 'Recebidas',
} as const;

export const ORIGENS_CLASSIFICACAO = [
  'NAO_CLASSIFICADA',
  'PORTAL',
  'XML',
  'REVISAO_MANUAL',
] as const;
export type OrigemClassificacaoSituacao = (typeof ORIGENS_CLASSIFICACAO)[number];

export interface EvidenciaSituacao {
  origem: OrigemClassificacaoSituacao;
  descricao: string;
}

export interface DocumentoFiscalNfse {
  chaveNacional: string;
  cnpj: string;
  direcao: DirecaoDocumentoFiscal;
  situacao: SituacaoDocumentoFiscal;
  periodoConsulta: PeriodoConsultaPortal;
  competenciaFiscalXml?: CompetenciaFiscalXml;
  origemClassificacao: OrigemClassificacaoSituacao;
  evidencias: EvidenciaSituacao[];
}

export interface NovoDocumentoFiscalInput {
  chaveNacional: string;
  cnpj: string;
  direcao: DirecaoDocumentoFiscal;
  situacao: SituacaoDocumentoFiscal;
  periodoConsulta: PeriodoConsultaPortal;
  competenciaFiscalXml?: CompetenciaFiscalXml;
  origemClassificacao?: OrigemClassificacaoSituacao;
  evidencias?: EvidenciaSituacao[];
}

export function validarChaveNacional(chave: string): string {
  const digitos = chave.trim();
  if (!/^\d{50}$/.test(digitos)) {
    throw new ContratoNfseError(
      `Chave nacional inválida: esperado ${TAMANHO_CHAVE_NACIONAL} dígitos, recebido ${digitos.length} caracteres.`
    );
  }
  return digitos;
}

export function validarSituacaoFiscal(valor: string): SituacaoDocumentoFiscal {
  if ((SITUACOES_DOCUMENTO_FISCAL as readonly string[]).includes(valor)) {
    return valor as SituacaoDocumentoFiscal;
  }
  throw new ContratoNfseError(
    `Situação fiscal não permitida: ${valor}. Use VIGENTE, CANCELADA ou INDETERMINADA.`
  );
}

export function normalizarCnpjEmpresa(cnpj: string): string {
  const limpo = limparDocumento(cnpj);
  if (!/^\d{14}$/.test(limpo)) {
    throw new ContratoNfseError('CNPJ da empresa inválido: esperado 14 dígitos.');
  }
  return limpo;
}

function validarDirecao(valor: string): DirecaoDocumentoFiscal {
  if ((DIRECOES_DOCUMENTO_FISCAL as readonly string[]).includes(valor)) {
    return valor as DirecaoDocumentoFiscal;
  }
  throw new ContratoNfseError(`Direção fiscal não permitida: ${valor}.`);
}

function validarOrigem(valor: string): OrigemClassificacaoSituacao {
  if ((ORIGENS_CLASSIFICACAO as readonly string[]).includes(valor)) {
    return valor as OrigemClassificacaoSituacao;
  }
  throw new ContratoNfseError(`Origem de classificação não permitida: ${valor}.`);
}

function validarEvidencias(evidencias: EvidenciaSituacao[]): EvidenciaSituacao[] {
  return evidencias.map((evidencia) => {
    const origem = validarOrigem(evidencia.origem);
    const descricao = evidencia.descricao?.trim() ?? '';
    if (!descricao) {
      throw new ContratoNfseError('Evidência de situação sem descrição.');
    }
    return { origem, descricao };
  });
}

export function criarDocumentoFiscal(input: NovoDocumentoFiscalInput): DocumentoFiscalNfse {
  if (input.periodoConsulta.tipo !== PERIODO_CONSULTA_PORTAL) {
    throw new ContratoNfseError('Documento fiscal exige PERIODO_CONSULTA_PORTAL.');
  }
  if (
    input.competenciaFiscalXml &&
    input.competenciaFiscalXml.tipo !== COMPETENCIA_FISCAL_XML
  ) {
    throw new ContratoNfseError('Competência do documento precisa ser COMPETENCIA_FISCAL_XML.');
  }
  if (input.competenciaFiscalXml && !input.competenciaFiscalXml.dCompet.trim()) {
    throw new ContratoNfseError('dCompet vazio não é competência fiscal do XML.');
  }

  return {
    chaveNacional: validarChaveNacional(input.chaveNacional),
    cnpj: normalizarCnpjEmpresa(input.cnpj),
    direcao: validarDirecao(input.direcao),
    situacao: validarSituacaoFiscal(input.situacao),
    periodoConsulta: input.periodoConsulta,
    competenciaFiscalXml: input.competenciaFiscalXml,
    origemClassificacao: validarOrigem(input.origemClassificacao ?? 'NAO_CLASSIFICADA'),
    evidencias: validarEvidencias(input.evidencias ?? []),
  };
}

/**
 * A seleção já ocorreu pelo período do portal.
 * dCompet diferente não remove o documento.
 */
export function documentoPermaneceNoInventario(
  documento: DocumentoFiscalNfse,
  periodo: PeriodoConsultaPortal
): boolean {
  return periodosConsultaIguais(documento.periodoConsulta, periodo);
}

/**
 * API-03M — elegíveis à consulta SEFIN: vigentes e indeterminadas.
 * Canceladas / substituídas (fora da meta) não entram.
 */
export function entraNaRecuperacaoSefin(documento: DocumentoFiscalNfse): boolean {
  return documento.situacao === 'VIGENTE' || documento.situacao === 'INDETERMINADA';
}

/** Só o XML vigente entra na exportação contábil (Emitidas/Recebidas). */
export function entraNaExportacaoXmlVigentes(documento: DocumentoFiscalNfse): boolean {
  return documento.situacao === 'VIGENTE';
}

/**
 * API-03M — indeterminada com XML documentalmente válido vai para
 * Pendentes_Validacao_Fiscal (não conta como vigente confirmado).
 */
export function entraNaExportacaoXmlPendentesFiscais(documento: DocumentoFiscalNfse): boolean {
  return documento.situacao === 'INDETERMINADA';
}

/**
 * API-03M — indeterminada não interrompe mais a empresa.
 * Pendência fiscal vira indicador (CONCLUIDA_COM_PENDENCIAS), não hard-stop.
 */
export function bloqueiaProcessamentoAutomatico(_documento: DocumentoFiscalNfse): boolean {
  return false;
}
