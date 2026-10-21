/**
 * UI-01e-B — Contrato de progresso fiscal estruturado (Backend).
 * Reutiliza completude nativa; não inventa métricas; sem XML/PFX/senhas.
 */
import type { EstadoCompletudeInventario } from '../contracts/inventario';

export const FASES_FISCAIS = ['inventario', 'validacao', 'recuperacao'] as const;
export type FaseFiscal = (typeof FASES_FISCAIS)[number];

export const ESTADOS_FASE_FISCAL = [
  'nao_iniciada',
  'em_andamento',
  'parcial',
  'completa',
  'falha',
  'cancelada',
  'timeout',
  'limite',
  'nao_executada',
  'indisponivel',
] as const;
export type EstadoFaseFiscal = (typeof ESTADOS_FASE_FISCAL)[number];

/** Totais comprováveis do inventário / classificação Discovery-Only. */
export interface TotaisProgressoFiscal {
  emitidas: number;
  recebidas: number;
  canceladas: number;
  vigentes: number;
  indeterminadas: number;
  /** Documentos únicos = emitidas + recebidas (mesmo critério do Discovery-Only). */
  descobertos: number;
  paginas: number;
}

export interface ProgressoFaseInventario {
  estado: EstadoFaseFiscal;
  completude: EstadoCompletudeInventario | null;
  /** true somente com completude COMPLETO e veredito PASS do motor. */
  conclusao_confiavel: boolean;
  totais: TotaisProgressoFiscal;
}

export interface ProgressoFaseValidacao {
  estado: EstadoFaseFiscal;
  /** Classificação ocorre na montagem do inventário — não é etapa DOM separada. */
  origem: 'PORTAL' | 'indisponivel';
  vigentes: number;
  canceladas: number;
  indeterminadas: number;
  conclusao_confiavel: boolean;
}

export interface ProgressoFaseRecuperacao {
  /** Discovery-Only: sempre nao_executada. */
  estado: EstadoFaseFiscal;
  conclusao_confiavel: false;
}

/**
 * Identidade canônica:
 * - execucao_id = ID Prisma da execução (string), o mesmo usado como execucaoId na homologação.
 * - empresa_id = ID da empresa na fila.
 * - batch_id = lote SSE (ausente em fluxos admin sem lote).
 * - execucaoDbId numérico ≠ batchId; não são intercambiáveis.
 */
export interface ProgressoFiscalNfse {
  versao: 1;
  batch_id: string | null;
  empresa_id: string;
  execucao_id: string;
  cnpj: string;
  inventario: ProgressoFaseInventario;
  validacao: ProgressoFaseValidacao;
  recuperacao: ProgressoFaseRecuperacao;
  codigo: string | null;
  message: string | null;
  /** Espelho operacional da ponte (quando houver). */
  estado_operacional: string | null;
  veredito_discovery: 'PASS' | 'FAIL' | 'INCOMPLETO' | null;
}

/** Evento SSE no canal existente (type discriminado). */
export interface ExecutionFiscalEvent {
  type: 'execution:fiscal';
  batch_id: string;
  empresa_id: string;
  execucao_id: string;
  cnpj: string;
  fiscal: ProgressoFiscalNfse;
}
