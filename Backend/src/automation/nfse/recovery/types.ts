/**
 * Tipos da recuperação de XML pela API SEFIN.
 * O material criptográfico não entra em log, checkpoint nem URL.
 */
import type { DirecaoDocumentoFiscal, SituacaoDocumentoFiscal } from '../contracts/documento-fiscal';
import type { PeriodoConsultaPortal } from '../contracts/periodo';

export const URL_BASE_SEFIN = 'https://sefin.nfse.gov.br/SefinNacional';
export const HOST_SEFIN = 'sefin.nfse.gov.br';

export const LIMITES_RECUPERACAO_PADRAO = {
  timeoutMs: 20_000,
  maxBytesResposta: 2_000_000,
  maxBytesGzip: 1_500_000,
  maxBytesXml: 4_000_000,
} as const;

export type LimitesRecuperacaoSefin = {
  timeoutMs: number;
  maxBytesResposta: number;
  maxBytesGzip: number;
  maxBytesXml: number;
};

export type ClasseErroRecuperacao = 'TRANSITORIO' | 'PERMANENTE' | 'BLOQUEANTE';

export type EstadoValidacaoXml = 'CONFIRMADA' | 'PENDENTE' | 'FALHOU' | 'NAO_APLICADA';

export type ResultadoConsultaSefin = 'RECUPERADO' | 'FALHOU' | 'BLOQUEADO';

export class ErroRecuperacaoSefin extends Error {
  readonly codigo: string;
  readonly classe: ClasseErroRecuperacao;

  constructor(codigo: string, classe: ClasseErroRecuperacao, mensagem: string) {
    super(mensagem);
    this.name = 'ErroRecuperacaoSefin';
    this.codigo = codigo;
    this.classe = classe;
  }
}

/** PKCS#12 em memória, fornecido pelo adaptador. Não persiste e não vai para log. */
export interface CredencialMtls {
  pfx: Buffer;
  senha: string;
}

export interface RespostaHttpSefin {
  status: number;
  body: Buffer;
}

export interface TransporteHttpMtls {
  consultar(
    url: URL,
    credencial: CredencialMtls,
    limites: LimitesRecuperacaoSefin
  ): Promise<RespostaHttpSefin>;
}

export interface RegistroLogRecuperacao {
  info(dados: Record<string, unknown>, mensagem: string): void;
  warn(dados: Record<string, unknown>, mensagem: string): void;
}

export interface ResultadoRecuperacaoSefin {
  chaveNacional: string;
  cnpj: string;
  direcao: DirecaoDocumentoFiscal;
  periodoConsulta: PeriodoConsultaPortal | null;
  resultado: ResultadoConsultaSefin;
  validacaoXml: EstadoValidacaoXml;
  classeErro: ClasseErroRecuperacao | null;
  codigo: string | null;
  mensagem: string;
  dCompet: string | null;
  hashSha256: string | null;
  xml: string | null;
}

export interface EntradaRecuperacaoSefin {
  chave: string;
  cnpj: string;
  direcao: DirecaoDocumentoFiscal;
  credencial: CredencialMtls | null;
  transporte: TransporteHttpMtls;
  periodoConsulta?: PeriodoConsultaPortal;
  situacao?: SituacaoDocumentoFiscal;
  baseUrl?: string;
  limites?: Partial<LimitesRecuperacaoSefin>;
  log?: RegistroLogRecuperacao;
}
