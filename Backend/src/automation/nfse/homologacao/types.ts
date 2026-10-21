/**
 * Contrato de homologação H1 — autorização vinculada ao contexto fiscal.
 * Não contém senha, PFX, tokens, cookies nem XML integral.
 * Não inicia SEFIN, navegador nem storage por conta própria.
 */
import type { PeriodoConsultaPortal } from '../contracts/periodo';

export const OPERACOES_HOMOLOGACAO = ['DISCOVERY_ONLY', 'SEFIN_RECOVERY'] as const;
export type OperacaoHomologacao = (typeof OPERACOES_HOMOLOGACAO)[number];

export type CodigoErroHomologacao =
  | 'AUTORIZACAO_AUSENTE'
  | 'AUTORIZACAO_MALFORMADA'
  | 'CNPJ_DIVERGENTE'
  | 'PERIODO_DIVERGENTE'
  | 'EXECUCAO_DIVERGENTE'
  | 'AUTORIZACAO_EXPIRADA'
  | 'OPERACAO_NAO_AUTORIZADA'
  | 'DIRETORIO_DIVERGENTE'
  | 'LIMITE_DOCUMENTOS'
  | 'LIMITE_PAGINAS'
  | 'LIMITE_REQUISICOES'
  | 'TIMEOUT'
  | 'INVENTARIO_INCOMPLETO'
  | 'SITUACAO_INDETERMINADA'
  | 'CERTIFICADO_INDISPONIVEL'
  | 'INTERRUPCAO'
  | 'FALHA_EVIDENCIA'
  | 'AUTORIZACAO_JA_CONSUMIDA'
  | 'AUTORIZACAO_CONCORRENCIA'
  | 'GATE_EXECUCAO_FECHADO'
  | 'DIRETORIO_INSEGURO'
  | 'CONTEXTO_INVALIDO';

export class HomologacaoNfseError extends Error {
  readonly codigo: CodigoErroHomologacao;

  constructor(codigo: CodigoErroHomologacao, mensagem: string) {
    super(mensagem);
    this.name = 'HomologacaoNfseError';
    this.codigo = codigo;
  }
}

/**
 * Autorização explícita de homologação.
 * `autorizada: true` isolado (Commit 07) NÃO é suficiente para H1 real.
 */
export interface AutorizacaoHomologacaoNfse {
  readonly versao: 1;
  /** Semântica H1: autorização tipada e vinculada — não genérica. */
  readonly autorizada: true;
  readonly cnpj: string;
  readonly periodoConsulta: PeriodoConsultaPortal;
  readonly execucaoId: string;
  readonly operacao: OperacaoHomologacao;
  /** ISO-8601; após este instante a autorização é inválida. */
  readonly validoAte: string;
  /** Raiz fiscal absoluta ou relativa autorizada para esta execução. */
  readonly diretorioFiscal: string;
  readonly limites: LimitesHomologacaoNfse;
  /** Motivo interno auditável (sem segredos). */
  readonly motivo?: string;
  readonly emitidoEm?: string;
}

export interface LimitesHomologacaoNfse {
  /** Máximo de documentos no inventário / elegíveis. */
  readonly maxDocumentos: number;
  /** Máximo de páginas de listagem por direção (H2.1). */
  readonly maxPaginas: number;
  /** Máximo de requisições SEFIN (0 em DISCOVERY_ONLY). */
  readonly maxRequisicoesSefin: number;
  /** Timeout operacional em ms (controle local). */
  readonly timeoutMs: number;
}

export interface ContextoValidacaoHomologacao {
  readonly cnpj: string;
  readonly periodoConsulta: PeriodoConsultaPortal;
  readonly execucaoId: string;
  readonly operacaoSolicitada: OperacaoHomologacao;
  readonly diretorioFiscal: string;
  readonly agora?: Date;
}

export interface ContagemLimitesHomologacao {
  documentos: number;
  paginas: number;
  requisicoesSefin: number;
}

export type EstadoLimitesHomologacao =
  | 'OK'
  | 'LIMITE_DOCUMENTOS'
  | 'LIMITE_PAGINAS'
  | 'LIMITE_REQUISICOES'
  | 'TIMEOUT'
  | 'INTERRUPCAO';

/** Veredito da homologação DISCOVERY_ONLY — nunca PASS com inventário incompleto. */
export type VereditoDiscoveryOnly = 'PASS' | 'FAIL' | 'INCOMPLETO';

export interface ResultadoDiscoveryOnlyHomologacao {
  readonly execucaoId: string;
  readonly cnpjMascarado: string;
  readonly periodoConsulta: PeriodoConsultaPortal;
  readonly veredito: VereditoDiscoveryOnly;
  readonly totais: {
    readonly emitidas: number;
    readonly recebidas: number;
    readonly vigentes: number;
    readonly canceladas: number;
    readonly indeterminadas: number;
    readonly paginas: number;
  };
  readonly estadoInventario: 'COMPLETO' | 'PARCIAL' | 'INDETERMINADO';
  readonly diagnosticos: readonly { codigo: string; mensagem: string }[];
  readonly evidencias: readonly EvidenciaHomologacaoSegura[];
  readonly limitesAplicados: LimitesHomologacaoNfse;
  readonly codigoErro: CodigoErroHomologacao | null;
  /** Garantias de isolamento H2.1. */
  readonly efeitosProibidos: {
    readonly sefin: false;
    readonly escritaXml: false;
    readonly checkpointRecuperacao: false;
    readonly navegadorAdicional: false;
    readonly loginAdicional: false;
  };
}

export interface EvidenciaHomologacaoSegura {
  readonly versao: 1;
  readonly execucaoId: string;
  readonly cnpjMascarado: string;
  readonly periodoConsulta: PeriodoConsultaPortal;
  readonly operacao: OperacaoHomologacao;
  readonly evento: string;
  readonly registradoEm: string;
  readonly detalhes: Record<string, string | number | boolean | null>;
}

export interface ResultadoGateHomologacao {
  readonly permitido: boolean;
  readonly operacao: OperacaoHomologacao;
  readonly motivo: string;
  readonly codigo?: CodigoErroHomologacao;
  /** DISCOVERY_ONLY nunca autoriza SEFIN. */
  readonly permiteSefin: boolean;
  readonly permitePersistenciaXml: boolean;
  readonly permiteCheckpointRecuperacao: boolean;
}
