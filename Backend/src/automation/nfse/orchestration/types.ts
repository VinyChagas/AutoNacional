/**
 * Contratos do orquestrador fiscal nativo (Commit 07 / revisão 22.7.1).
 * Não inicia navegador, login, CAPTCHA nem SEFIN por conta própria.
 */
import type { Page } from 'playwright';
import type { InventarioNfse } from '../contracts/inventario';
import type { PeriodoConsultaPortal } from '../contracts/periodo';
import type { RelatorioReconciliacaoNfse } from '../checkpoint';
import type { TransporteHttpMtls } from '../recovery/types';
import type { ProvedorCredencialMtls } from '../recovery/mtls-provider';
import type { DocumentoExportavelNfse, RelatorioAuditoriaFiscal } from '../infrastructure';
import type { RepositorioFiscalNfse } from '../infrastructure/fiscal-repository';
import type { DiscoverNfseInput } from '../discovery/discovery-service';
import type { ResultadoDescobertaNfse } from '../discovery/types';
import type { EntradaRecuperacaoSefin, ResultadoRecuperacaoSefin } from '../recovery/types';

export type ModoExecucaoFiscal = 'LEGADO' | 'NATIVO_CONTROLADO';

/**
 * Distingue o legado padrão, o nativo autorizado e a recusa após pedido explícito.
 * NATIVO_RECUSADO nunca deve cair no legado em silêncio.
 */
export type SituacaoDecisaoIntegracao =
  | 'LEGADO_SOLICITADO'
  | 'NATIVO_SOLICITADO'
  | 'NATIVO_RECUSADO';

export type CompatibilidadePdfNativo = 'LEGADO_PRESERVADO' | 'NAO_APLICAVEL' | 'BLOQUEIA_SUBSTITUICAO';

/**
 * Autorização explícita por execução. Ausente ou `autorizada !== true` = desativada.
 * Não é inferida por A1, storage, PDF ou login.
 */
export interface AutorizacaoExecucaoNativa {
  readonly autorizada: true;
  /** Motivo interno auditável (sem segredos). */
  readonly motivo?: string;
}

export type CodigoErroOrquestracaoNfse =
  | 'FLAG_INVALIDA'
  | 'FLAG_DESATIVADA'
  | 'AUTORIZACAO_AUSENTE'
  | 'CNPJ_INVALIDO'
  | 'PERIODO_INVALIDO'
  | 'PAGE_AUSENTE'
  | 'CONTEXTO_INVALIDO'
  | 'RAIZ_FISCAL_AUSENTE'
  | 'CERTIFICADO_INDISPONIVEL'
  | 'DESCOBERTA_INCOMPLETA'
  | 'SITUACAO_INDETERMINADA'
  | 'PLANEJAMENTO_BLOQUEADO'
  | 'PDF_EXIGE_LEGADO'
  | 'EXECUCAO_EM_USO'
  | 'FALHA_RECUPERACAO'
  | 'FALHA_PERSISTENCIA'
  | 'FALHA_AUDITORIA'
  | 'FALHA_ORQUESTRACAO';

export class OrquestracaoNfseError extends Error {
  readonly codigo: CodigoErroOrquestracaoNfse;

  constructor(codigo: CodigoErroOrquestracaoNfse, mensagem: string) {
    super(mensagem);
    this.name = 'OrquestracaoNfseError';
    this.codigo = codigo;
  }
}

export interface DiagnosticoOrquestracaoNfse {
  codigo: string;
  mensagem: string;
}

export interface ResultadoFluxoFiscalNativo {
  modo: ModoExecucaoFiscal;
  execucaoId: string;
  cnpj: string;
  periodoConsulta: PeriodoConsultaPortal;
  inventario: InventarioNfse | null;
  descobertos: number;
  vigentes: number;
  canceladas: number;
  indeterminadas: number;
  persistidos: number;
  pendentes: number;
  coberturaPercentual: number;
  conclusaoReconciliacao: RelatorioReconciliacaoNfse['conclusao'] | null;
  estadoAuditoria: RelatorioAuditoriaFiscal['estado'] | null;
  caminhoAuditoria: string | null;
  documentosAptos: DocumentoExportavelNfse[];
  loteLiberado: boolean;
  compatibilidadePdf: CompatibilidadePdfNativo;
  diagnosticos: DiagnosticoOrquestracaoNfse[];
  recuperacoes: Array<{
    chaveMascarada: string;
    resultado: string;
    codigo: string | null;
  }>;
}

export type DescobridorNfse = (input: DiscoverNfseInput) => Promise<ResultadoDescobertaNfse>;

export type RecuperadorXmlNfse = (entrada: EntradaRecuperacaoSefin) => Promise<ResultadoRecuperacaoSefin>;

export interface DependenciasFluxoFiscalNativo {
  descobrir: DescobridorNfse;
  recuperar: RecuperadorXmlNfse;
  transporte: TransporteHttpMtls;
  provedorA1: ProvedorCredencialMtls;
  repositorio: RepositorioFiscalNfse;
}

export interface EntradaFluxoFiscalNativo {
  page: Page;
  cnpj: string;
  periodoConsulta: PeriodoConsultaPortal;
  execucaoId: string;
  tipo: 'emitidas' | 'recebidas' | 'ambas';
  baixarPdf: boolean;
  raizFiscal: string;
  dependencias: DependenciasFluxoFiscalNativo;
}

export interface DecisaoIntegracaoNativa {
  modo: ModoExecucaoFiscal;
  situacao: SituacaoDecisaoIntegracao;
  executarNativo: boolean;
  motivo: string;
  compatibilidadePdf: CompatibilidadePdfNativo;
  codigoRecusa?: CodigoErroOrquestracaoNfse;
}

export interface ContextoIntegracaoExecution {
  page: Page | null | undefined;
  cnpj: string;
  dataInicio: string;
  dataFim: string;
  tipo: string;
  baixarPdf: boolean;
  execucaoId: string;
  certificadoEmMemoria?: { pfx: Buffer; passphrase: string } | null;
  tipoAutenticacao: 'certificado' | 'credenciais';
  env?: NodeJS.ProcessEnv;
  /**
   * Autorização explícita desta execução.
   * Desativada por padrão. Só `autorizada: true` habilita o pedido nativo.
   */
  autorizacaoNativa?: AutorizacaoExecucaoNativa | null;
}

export function autorizacaoNativaAtiva(
  autorizacao: AutorizacaoExecucaoNativa | null | undefined
): boolean {
  return autorizacao?.autorizada === true;
}
