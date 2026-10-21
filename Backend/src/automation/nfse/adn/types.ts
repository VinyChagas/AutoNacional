/**
 * Contratos ADN/NSU isolados do Portal e da SEFIN.
 * Completude de distribuição ≠ inventário mensal completo.
 */

import type { CredencialMtls } from '../recovery/types';
import type { AmbienteAdn } from './endpoints';

export type { AmbienteAdn, CredencialMtls };

export type StatusProcessamentoDistribuicao =
  | 'REJEICAO'
  | 'NENHUM_DOCUMENTO_LOCALIZADO'
  | 'DOCUMENTOS_LOCALIZADOS';

export type TipoDocumentoDistribuicao =
  | 'NENHUM'
  | 'DPS'
  | 'PEDIDO_REGISTRO_EVENTO'
  | 'NFSE'
  | 'EVENTO'
  | 'CNC';

export type ClassificacaoDocumentoAdn =
  | 'emitida'
  | 'recebida'
  | 'intermediada'
  | 'evento'
  | 'nao_classificado';

export type PapelFiscalAdn = 'emitente' | 'tomador' | 'intermediario';

export type StatusSyncAdn = 'COMPLETO' | 'PARCIAL' | 'ERRO' | 'NAO_INICIADO';

export interface DistribuicaoNsuItem {
  NSU?: number | null;
  ChaveAcesso?: string | null;
  TipoDocumento?: TipoDocumentoDistribuicao;
  TipoEvento?: string | null;
  ArquivoXml?: string | null;
  DataHoraGeracao?: string | null;
}

export interface LoteDistribuicaoNsuResponse {
  StatusProcessamento?: StatusProcessamentoDistribuicao;
  LoteDFe?: DistribuicaoNsuItem[] | null;
  Alertas?: Array<Record<string, unknown>> | null;
  Erros?: Array<Record<string, unknown>> | null;
  TipoAmbiente?: string;
  VersaoAplicativo?: string | null;
  DataHoraProcessamento?: string;
}

export interface DocumentoDistribuidoAdn {
  nsu?: number;
  chaveAcesso?: string;
  tipoDocumento?: TipoDocumentoDistribuicao | string;
  tipoEvento?: string;
  classificacao: ClassificacaoDocumentoAdn;
  papeis: PapelFiscalAdn[];
  cnpjPrestador?: string;
  cnpjTomador?: string;
  cnpjIntermediario?: string;
  competencia?: string;
  sha256: string;
  xmlValido: boolean;
  xml?: string;
  dataHoraGeracao?: string;
}

export interface CheckpointDistribuicaoAdn {
  cnpj: string;
  ambiente: AmbienteAdn;
  /** Último NSU confirmado (cursor UltimoNSU). */
  ultimoNsuConfirmado: number;
  nsuInicialSessao?: number;
  lotesProcessados: number;
  documentosProcessados: number;
  status: StatusSyncAdn;
  atualizadoEm: string;
  motivoParada?: string;
  /** Fim da fila NSU — não prova inventário mensal completo. */
  fimDistribuicaoConfirmado: boolean;
}

export interface LimitesAdn {
  timeoutMs: number;
  maxBytesResposta: number;
  maxBytesGzip: number;
  maxBytesXml: number;
  rateLimitMs: number;
  maxRequests: number;
}

export const LIMITES_ADN_PADRAO: LimitesAdn = {
  timeoutMs: 20_000,
  maxBytesResposta: 4_000_000,
  maxBytesGzip: 1_500_000,
  maxBytesXml: 4_000_000,
  rateLimitMs: 0,
  maxRequests: 20,
};

export interface RespostaHttpAdn {
  status: number;
  body: Buffer;
  durationMs: number;
  url: string;
}

export interface TransporteHttpAdn {
  get(
    url: URL,
    credencial: CredencialMtls,
    limites: Pick<LimitesAdn, 'timeoutMs' | 'maxBytesResposta'>
  ): Promise<RespostaHttpAdn>;
}

export interface ResultadoSyncAdn {
  cnpj: string;
  ambiente: AmbienteAdn;
  documentos: DocumentoDistribuidoAdn[];
  nsuInicial: number;
  ultimoNsuProcessado: number;
  lotesProcessados: number;
  requests: number;
  status: StatusSyncAdn;
  /** Caught-up na distribuição NSU — NÃO equivale a inventário mensal completo. */
  fimDistribuicaoConfirmado: boolean;
  motivoParada: string;
  duplicidades: number;
  xmlsInvalidos: number;
  contagens: {
    emitidas: number;
    recebidas: number;
    intermediadas: number;
    eventos: number;
    naoClassificados: number;
  };
  checkpoint?: CheckpointDistribuicaoAdn;
}
