/**
 * Checkpoint nativo da recuperação de NFS-e.
 * Persistência mínima e isolada: não usa download operacional, certificado nem SEFIN.
 */
import path from 'node:path';
import type { DirecaoDocumentoFiscal, SituacaoDocumentoFiscal } from '../contracts/documento-fiscal';
import { PERIODO_CONSULTA_PORTAL, type PeriodoConsultaPortal } from '../contracts/periodo';

export const VERSAO_FORMATO_CHECKPOINT = 1;

export const ESTADOS_DOCUMENTO_CHECKPOINT = [
  'PENDENTE',
  'EXCLUIDA_DA_RECUPERACAO',
  'BLOQUEADO',
  'EM_PROCESSAMENTO',
  'PERSISTIDO',
  'FALHA_TRANSITORIA',
  'FALHA_PERMANENTE',
  'INCONSISTENTE',
] as const;

export type EstadoDocumentoCheckpoint = (typeof ESTADOS_DOCUMENTO_CHECKPOINT)[number];

export type ConclusaoReconciliacaoNfse = 'RECONCILIADA' | 'NAO_RECONCILIADA';

export class CheckpointNfseError extends Error {
  readonly codigo: string;

  constructor(codigo: string, mensagem: string) {
    super(mensagem);
    this.name = 'CheckpointNfseError';
    this.codigo = codigo;
  }
}

export interface DocumentoCheckpointNfse {
  chaveNacional: string;
  direcao: DirecaoDocumentoFiscal;
  situacao: SituacaoDocumentoFiscal;
  estado: EstadoDocumentoCheckpoint;
  hashSha256: string | null;
  caminhoRelativo: string | null;
  tamanhoBytes: number | null;
  diagnostico: string | null;
  codigo: string | null;
  updatedAt: string;
}

export interface CheckpointNfse {
  versaoFormato: number;
  execucaoId: string;
  cnpj: string;
  periodoConsulta: PeriodoConsultaPortal;
  fingerprintInventario: string;
  createdAt: string;
  updatedAt: string;
  documentos: DocumentoCheckpointNfse[];
}

/** Arquivo já lido pelo chamador. A reconciliação não abre disco. */
export interface ArquivoVerificadoNfse {
  chaveNacional: string;
  existe: boolean;
  tamanhoBytes: number;
  hashSha256: string | null;
}

export interface RelatorioReconciliacaoNfse {
  descobertos: number;
  vigentes: number;
  canceladas: number;
  indeterminadas: number;
  persistidosIntegros: number;
  pendentes: number;
  falhaTransitoria: number;
  falhaPermanente: number;
  inconsistencias: number;
  /**
   * Persistidos íntegros divididos pelos vigentes.
   * Com zero vigentes e nenhuma inconsistência bloqueante, o valor é 1.
   * Indeterminada não zera esta fração; ela impede a conclusão à parte.
   */
  cobertura: number;
  chavesFaltantes: string[];
  chavesExcedentes: string[];
  chavesDuplicadas: string[];
  divergenciasHash: string[];
  identidadeConsistente: boolean;
  conclusao: ConclusaoReconciliacaoNfse;
  motivos: string[];
}

export interface AlteracaoRetomadaNfse {
  chaveNacional: string;
  de: EstadoDocumentoCheckpoint;
  para: EstadoDocumentoCheckpoint;
  motivo: string;
}

export interface ResultadoRetomadaNfse {
  checkpoint: CheckpointNfse;
  podeRetomarAutomaticamente: boolean;
  codigoBloqueio: string | null;
  alteracoes: AlteracaoRetomadaNfse[];
}

export interface OpcoesEscritaAtomica {
  antesDaEscrita?: () => void | Promise<void>;
  antesDoRename?: () => void | Promise<void>;
}

/**
 * Quando `jaComTrava` é true, o chamador já segura `CheckpointStore.comTrava`
 * para o mesmo CNPJ e período. Evita aquisição aninhada (deadlock no mesmo processo).
 */
export interface OpcoesTravaCheckpoint {
  jaComTrava?: boolean;
}

const SEGMENTO_SEGURO = /^[A-Za-z0-9._-]+$/;

export function segmentoPeriodo(periodo: PeriodoConsultaPortal): string {
  if (!periodo || periodo.tipo !== PERIODO_CONSULTA_PORTAL) {
    throw new CheckpointNfseError('CAMINHO_INVALIDO', 'Período sem tipo PERIODO_CONSULTA_PORTAL.');
  }
  const inicio = periodo.inicio.replaceAll('/', '-');
  const fim = periodo.fim.replaceAll('/', '-');
  const segmento = `${inicio}_${fim}`;
  if (!/^\d{2}-\d{2}-\d{4}_\d{2}-\d{2}-\d{4}$/.test(segmento)) {
    throw new CheckpointNfseError('CAMINHO_INVALIDO', 'Período não pode compor caminho.');
  }
  return segmento;
}

/**
 * Resolve segmentos já validados sob a raiz.
 * Rejeita vazio, absoluto, separador, `..` e escape da raiz.
 */
export function resolverCaminhoSeguro(raiz: string, segmentos: readonly string[]): string {
  if (typeof raiz !== 'string' || !raiz.trim()) {
    throw new CheckpointNfseError('CAMINHO_INVALIDO', 'Raiz de persistência ausente.');
  }
  if (segmentos.length === 0) {
    throw new CheckpointNfseError('CAMINHO_INVALIDO', 'Caminho sem segmentos.');
  }

  const raizResolvida = path.resolve(raiz);
  for (const segmento of segmentos) {
    if (typeof segmento !== 'string' || !SEGMENTO_SEGURO.test(segmento) || segmento === '.' || segmento === '..') {
      throw new CheckpointNfseError('CAMINHO_INVALIDO', 'Segmento de caminho recusado.');
    }
  }

  const candidato = path.resolve(raizResolvida, ...segmentos);
  const relativo = path.relative(raizResolvida, candidato);
  if (
    relativo === '' ||
    relativo.startsWith('..') ||
    path.isAbsolute(relativo) ||
    relativo.split(path.sep).includes('..')
  ) {
    throw new CheckpointNfseError('CAMINHO_INVALIDO', 'Caminho fora da raiz configurada.');
  }
  return candidato;
}
