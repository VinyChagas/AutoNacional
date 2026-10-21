/**
 * UI-01e-C — Tipagem espelho do contrato Backend ProgressoFiscalNfse.
 * Não inventa campos; campos opcionais no consumo via type guards.
 */

export const ESTADOS_COMPLETUDE_INVENTARIO = ['COMPLETO', 'PARCIAL', 'INDETERMINADO'] as const;
export type EstadoCompletudeInventario = (typeof ESTADOS_COMPLETUDE_INVENTARIO)[number];

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

export interface TotaisProgressoFiscal {
  emitidas: number;
  recebidas: number;
  canceladas: number;
  vigentes: number;
  indeterminadas: number;
  descobertos: number;
  paginas: number;
}

export interface ProgressoFaseInventario {
  estado: EstadoFaseFiscal;
  completude: EstadoCompletudeInventario | null;
  conclusao_confiavel: boolean;
  totais: TotaisProgressoFiscal;
}

export interface ProgressoFaseValidacao {
  estado: EstadoFaseFiscal;
  origem: 'PORTAL' | 'indisponivel';
  vigentes: number;
  canceladas: number;
  indeterminadas: number;
  conclusao_confiavel: boolean;
}

export interface ProgressoFaseRecuperacao {
  estado: EstadoFaseFiscal;
  conclusao_confiavel: false;
}

export interface ProgressoFiscalNfse {
  versao: 1;
  batch_id: string | null;
  empresa_id: string;
  execucao_id: string;
  cnpj: string;
  /**
   * Revisão monotônica Backend (UI-01e-D). Ausente em payloads legados.
   * FE não inventa revisão local.
   */
  revisao?: number;
  inventario: ProgressoFaseInventario;
  validacao: ProgressoFaseValidacao;
  recuperacao: ProgressoFaseRecuperacao;
  codigo: string | null;
  message: string | null;
  estado_operacional: string | null;
  veredito_discovery: 'PASS' | 'FAIL' | 'INCOMPLETO' | null;
}

/** Payload SSE `fiscal` (mesmo canal EventSource). */
export interface ExecutionFiscalStreamEvent {
  type: 'execution:fiscal';
  batch_id: string;
  empresa_id: string;
  execucao_id: string;
  cnpj: string;
  fiscal: ProgressoFiscalNfse;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isEstadoFase(v: unknown): v is EstadoFaseFiscal {
  return typeof v === 'string' && (ESTADOS_FASE_FISCAL as readonly string[]).includes(v);
}

function isCompletude(v: unknown): v is EstadoCompletudeInventario | null {
  if (v === null) return true;
  return typeof v === 'string' && (ESTADOS_COMPLETUDE_INVENTARIO as readonly string[]).includes(v);
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function parseTotais(raw: unknown): TotaisProgressoFiscal | null {
  if (!isRecord(raw)) return null;
  const emitidas = num(raw['emitidas']);
  const recebidas = num(raw['recebidas']);
  const canceladas = num(raw['canceladas']);
  const vigentes = num(raw['vigentes']);
  const indeterminadas = num(raw['indeterminadas']);
  const descobertos = num(raw['descobertos']);
  const paginas = num(raw['paginas']);
  if (
    emitidas == null ||
    recebidas == null ||
    canceladas == null ||
    vigentes == null ||
    indeterminadas == null ||
    descobertos == null ||
    paginas == null
  ) {
    return null;
  }
  return { emitidas, recebidas, canceladas, vigentes, indeterminadas, descobertos, paginas };
}

/** Valida e normaliza progresso fiscal do Backend (SSE ou polling). */
export function parseProgressoFiscalNfse(raw: unknown): ProgressoFiscalNfse | null {
  if (!isRecord(raw)) return null;
  if (raw['versao'] !== 1) return null;
  const empresa_id = typeof raw['empresa_id'] === 'string' ? raw['empresa_id'] : null;
  const execucao_id = typeof raw['execucao_id'] === 'string' ? raw['execucao_id'] : null;
  const cnpj = typeof raw['cnpj'] === 'string' ? raw['cnpj'] : null;
  if (!empresa_id || !execucao_id || !cnpj) return null;
  const batch_id =
    raw['batch_id'] === null
      ? null
      : typeof raw['batch_id'] === 'string'
        ? raw['batch_id']
        : null;
  if (raw['batch_id'] !== null && batch_id === null) return null;

  const invRaw = raw['inventario'];
  const valRaw = raw['validacao'];
  const recRaw = raw['recuperacao'];
  if (!isRecord(invRaw) || !isRecord(valRaw) || !isRecord(recRaw)) return null;

  const totais = parseTotais(invRaw['totais']);
  if (!totais || !isEstadoFase(invRaw['estado']) || !isCompletude(invRaw['completude'])) return null;
  if (typeof invRaw['conclusao_confiavel'] !== 'boolean') return null;

  if (!isEstadoFase(valRaw['estado'])) return null;
  if (valRaw['origem'] !== 'PORTAL' && valRaw['origem'] !== 'indisponivel') return null;
  const vVig = num(valRaw['vigentes']);
  const vCan = num(valRaw['canceladas']);
  const vInd = num(valRaw['indeterminadas']);
  if (vVig == null || vCan == null || vInd == null) return null;
  if (typeof valRaw['conclusao_confiavel'] !== 'boolean') return null;

  if (!isEstadoFase(recRaw['estado'])) return null;
  if (recRaw['conclusao_confiavel'] !== false) return null;

  const codigo = raw['codigo'] === null || typeof raw['codigo'] === 'string' ? (raw['codigo'] as string | null) : null;
  const message =
    raw['message'] === null || typeof raw['message'] === 'string' ? (raw['message'] as string | null) : null;
  const estado_operacional =
    raw['estado_operacional'] === null || typeof raw['estado_operacional'] === 'string'
      ? (raw['estado_operacional'] as string | null)
      : null;
  const vd = raw['veredito_discovery'];
  const veredito_discovery =
    vd === null || vd === 'PASS' || vd === 'FAIL' || vd === 'INCOMPLETO' ? vd : null;

  // revisao: opcional (legado); 0 = não publicada → trata como ausente no FE.
  let revisao: number | undefined;
  if (raw['revisao'] !== undefined) {
    const n = num(raw['revisao']);
    if (n == null || !Number.isInteger(n) || n < 0) return null;
    revisao = n > 0 ? n : undefined;
  }

  return {
    versao: 1,
    batch_id,
    empresa_id,
    execucao_id,
    cnpj,
    ...(revisao !== undefined ? { revisao } : {}),
    inventario: {
      estado: invRaw['estado'],
      completude: invRaw['completude'] as EstadoCompletudeInventario | null,
      conclusao_confiavel: invRaw['conclusao_confiavel'],
      totais,
    },
    validacao: {
      estado: valRaw['estado'],
      origem: valRaw['origem'],
      vigentes: vVig,
      canceladas: vCan,
      indeterminadas: vInd,
      conclusao_confiavel: valRaw['conclusao_confiavel'],
    },
    recuperacao: {
      estado: recRaw['estado'],
      conclusao_confiavel: false,
    },
    codigo,
    message,
    estado_operacional,
    veredito_discovery,
  };
}

export function parseExecutionFiscalStreamEvent(raw: unknown): ExecutionFiscalStreamEvent | null {
  if (!isRecord(raw)) return null;
  if (raw['type'] !== 'execution:fiscal') return null;
  const batch_id = typeof raw['batch_id'] === 'string' ? raw['batch_id'] : null;
  const empresa_id = typeof raw['empresa_id'] === 'string' ? raw['empresa_id'] : null;
  const execucao_id = typeof raw['execucao_id'] === 'string' ? raw['execucao_id'] : null;
  const cnpj = typeof raw['cnpj'] === 'string' ? raw['cnpj'] : null;
  const fiscal = parseProgressoFiscalNfse(raw['fiscal']);
  if (!batch_id || !empresa_id || !execucao_id || !cnpj || !fiscal) return null;
  if (fiscal.empresa_id !== empresa_id || fiscal.execucao_id !== execucao_id) return null;
  if (fiscal.batch_id !== null && fiscal.batch_id !== batch_id) return null;
  return { type: 'execution:fiscal', batch_id, empresa_id, execucao_id, cnpj, fiscal };
}

/** Rótulos de UI para estado de fase (contrato real). */
export function rotuloEstadoFaseFiscal(estado: EstadoFaseFiscal): string {
  switch (estado) {
    case 'completa':
      return 'Completo';
    case 'parcial':
      return 'Parcial';
    case 'em_andamento':
      return 'Em andamento';
    case 'falha':
      return 'Falha';
    case 'cancelada':
      return 'Cancelado';
    case 'timeout':
      return 'Timeout';
    case 'limite':
      return 'Limite atingido';
    case 'indisponivel':
      return 'Indisponível';
    case 'nao_iniciada':
      return 'Não iniciada';
    case 'nao_executada':
      return 'Não executada';
    default:
      return 'Indisponível';
  }
}
