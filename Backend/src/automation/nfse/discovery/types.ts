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

export type FonteChaveDescoberta = 'HREF_DOWNLOAD_XML' | 'DATA_CHAVE' | 'NAO_IDENTIFICADA';

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
  problemas: string[];
}

export interface DiagnosticoDescoberta {
  codigo: string;
  mensagem: string;
  direcao?: DirecaoDocumentoFiscal;
  pagina?: number;
  linha?: number;
  chaveNacional?: string;
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
  capturar(pagina: number, direcao: DirecaoDocumentoFiscal): Promise<PaginaListagem>;
  avancar(direcao: DirecaoDocumentoFiscal): Promise<boolean>;
}
