/**
 * Tipos da descoberta nativa de NFS-e.
 * O resultado bruto fica separado do inventário fiscal.
 */
import type { DirecaoDocumentoFiscal } from '../contracts/documento-fiscal';
import type { InventarioNfse } from '../contracts/inventario';
import type { PeriodoConsultaPortal } from '../contracts/periodo';

export const TIPOS_CONSULTA_DESCOBERTA = ['EMITIDAS', 'RECEBIDAS', 'AMBAS'] as const;
export type TipoConsultaDescoberta = (typeof TIPOS_CONSULTA_DESCOBERTA)[number];

export const STATUS_DESCOBERTA = [
  'DISCOVERY_COMPLETE',
  'DISCOVERY_INCOMPLETE',
  'DISCOVERY_FAILED',
] as const;
export type StatusDescobertaNfse = (typeof STATUS_DESCOBERTA)[number];

export type FonteChaveDescoberta =
  | 'HREF_DOWNLOAD_XML'
  | 'DATA_CHAVE'
  | 'TEXTO_CELULA'
  | 'NAO_IDENTIFICADA';

export interface IconeSituacaoBruto {
  src: string | null;
  title: string | null;
  dataOriginalTitle: string | null;
  alt: string | null;
  ariaLabel: string | null;
}

/** Evidência lida do DOM. Não classifica a nota. */
export interface EvidenciaSituacaoBruta {
  dataSituacao: string | null;
  textoColuna: string | null;
  classeColuna: string | null;
  icones: IconeSituacaoBruto[];
}

export interface LinhaListagem {
  pagina: number;
  linha: number;
  hrefs: string[];
  dataChave: string | null;
  textos: string[];
  evidenciaSituacao: EvidenciaSituacaoBruta;
}

export interface PaginaListagem {
  url: string;
  paginaIndicador: number | null;
  totalizador: number | null;
  semRegistros: boolean;
  linhas: LinhaListagem[];
  proxima: { presente: boolean; desabilitado: boolean };
  fingerprint: string;
}

export interface LeituraFiltroPortal {
  url: string;
  dataInicio: string;
  dataFim: string;
  semRegistros: boolean;
  quantidadeLinhas: number;
  temTabela: boolean;
}

export interface RegistroDescobertaNfse {
  chaveNacional: string | null;
  direcao: DirecaoDocumentoFiscal;
  pagina: number;
  linha: number;
  fonteChave: FonteChaveDescoberta;
  evidenciaSituacao: EvidenciaSituacaoBruta;
  /** Textos brutos das células (para número da NFS-e no diagnóstico API-03L). */
  textosCelulas?: string[];
  problemas: string[];
}

export interface DiagnosticoDescoberta {
  codigo: string;
  mensagem: string;
  direcao?: DirecaoDocumentoFiscal;
  pagina?: number;
  linha?: number;
  chaveNacional?: string;
  /** Etapa da falha (abrir_menu, aplicar_filtro, …) — sem segredos. */
  etapa?: string;
  /** Seletor tentado (quando aplicável). */
  seletor?: string;
  /** URL sanitizada (path + datas públicas). */
  url?: string;
}

export interface ResultadoDescobertaNfse {
  cnpj: string;
  periodoConsulta: PeriodoConsultaPortal;
  tipo: TipoConsultaDescoberta;
  status: StatusDescobertaNfse;
  inventario: InventarioNfse;
  registros: RegistroDescobertaNfse[];
  diagnosticos: DiagnosticoDescoberta[];
  paginasPercorridas: number;
}

export interface PortalListagem {
  abrir(direcao: DirecaoDocumentoFiscal): Promise<void>;
  aplicarPeriodo(
    periodo: PeriodoConsultaPortal,
    direcao: DirecaoDocumentoFiscal
  ): Promise<LeituraFiltroPortal>;
  capturar(
    pagina: number,
    direcao: DirecaoDocumentoFiscal,
    opcoes?: { acumuladosAntes?: number }
  ): Promise<PaginaListagem>;
  avancar(direcao: DirecaoDocumentoFiscal): Promise<boolean>;
}

/** Etapas cooperativas para timeout / AbortSignal (H2.1.1). */
export const ETAPAS_CONTROLE_DESCOBERTA = [
  'antes_navegacao',
  'antes_pagina',
  'antes_extracao',
  'apos_pagina',
  'antes_avancar',
] as const;
export type EtapaControleDescoberta = (typeof ETAPAS_CONTROLE_DESCOBERTA)[number];

/**
 * Controle cooperativo injetável.
 * Não cancela Playwright em voo — apenas impede novas etapas.
 */
export interface ControleDescoberta {
  readonly signal?: AbortSignal;
  readonly antesDeOperacao?: (etapa: EtapaControleDescoberta) => void;
}
