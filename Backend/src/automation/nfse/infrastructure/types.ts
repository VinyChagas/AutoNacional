/**
 * Infraestrutura fiscal nativa: A1, armazenamento isolado e auditoria.
 * Não inicia execução, não consulta SEFIN e não altera o worker.
 */
import type { DirecaoDocumentoFiscal, SituacaoDocumentoFiscal } from '../contracts/documento-fiscal';
import type { PeriodoConsultaPortal } from '../contracts/periodo';
import type { ConclusaoReconciliacaoNfse } from '../checkpoint/types';

export const VERSAO_FORMATO_AUDITORIA = 1;

export type EstadoAuditoriaFiscal = 'RECONCILIADA' | 'PARCIAL' | 'BLOQUEADA';

export type CodigoErroInfraestruturaNfse =
  | 'CNPJ_INVALIDO'
  | 'CERTIFICADO_INEXISTENTE'
  | 'CERTIFICADO_INACESSIVEL'
  | 'SENHA_INDISPONIVEL'
  | 'SENHA_INVALIDA'
  | 'PFX_INVALIDO'
  | 'CERTIFICADO_EXPIRADO'
  | 'ERRO_DESCRIPTOGRAFIA'
  | 'ERRO_LEITURA'
  | 'RAIZ_INVALIDA'
  | 'CAMINHO_INVALIDO'
  | 'AUDITORIA_CONFLITO'
  | 'AUDITORIA_INCOMPATIVEL'
  | 'AUDITORIA_AUSENTE'
  | 'FALHA_ESCRITA'
  | 'FALHA_LEITURA';

export class InfraestruturaNfseError extends Error {
  readonly codigo: CodigoErroInfraestruturaNfse;

  constructor(codigo: CodigoErroInfraestruturaNfse, mensagem: string) {
    super(mensagem);
    this.name = 'InfraestruturaNfseError';
    this.codigo = codigo;
  }
}

/** Material A1 em memória, sem persistência permanente neste módulo. */
export interface MaterialCertificadoA1 {
  pfx: Buffer;
  passphrase: string;
}

/**
 * Fonte sob demanda do cadastro operacional.
 * Não deve ser chamada na importação do módulo.
 */
export interface FonteCertificadoA1 {
  carregar(cnpj: string): Promise<MaterialCertificadoA1>;
}

export interface DiagnosticoAuditoriaNfse {
  codigo: string;
  mensagem: string;
  chaveMascarada?: string;
}

export interface RelatorioAuditoriaFiscal {
  versaoFormato: number;
  execucaoId: string;
  /** SHA-256 hex (32 chars) do conteúdo fiscal canônico, sem auditadoEm. */
  snapshotId: string;
  cnpj: string;
  periodoConsulta: PeriodoConsultaPortal;
  fingerprintInventario: string;
  auditadoEm: string;
  descobertos: number;
  emitidas: number;
  recebidas: number;
  vigentes: number;
  canceladas: number;
  indeterminadas: number;
  persistidasVerificadas: number;
  pendentes: number;
  falhaTransitoria: number;
  falhaPermanente: number;
  inconsistencias: number;
  coberturaPercentual: number;
  conclusaoReconciliacao: ConclusaoReconciliacaoNfse;
  estado: EstadoAuditoriaFiscal;
  diagnosticos: DiagnosticoAuditoriaNfse[];
}

export interface DocumentoExportavelNfse {
  chaveNacional: string;
  direcao: DirecaoDocumentoFiscal;
  situacao: SituacaoDocumentoFiscal;
  caminhoRelativo: string;
  hashSha256: string;
  tamanhoBytes: number;
}

/**
 * Liberação do lote contábil completo.
 * Distinto da listagem técnica de documentos individualmente aptos.
 */
export interface AvaliacaoLoteExportacaoNfse {
  liberado: boolean;
  bloqueadoPorIndeterminada: boolean;
  motivos: string[];
}

export interface ResultadoListagemExportacaoNfse {
  aptos: DocumentoExportavelNfse[];
  lote: AvaliacaoLoteExportacaoNfse;
}

/** Máscara segura para referência em auditoria (não é prova fiscal). */
export function mascararChaveNacional(chave: string): string {
  if (!/^\d{50}$/.test(chave)) return '****';
  return `${chave.slice(0, 4)}…${chave.slice(-4)}`;
}
