/**
 * UI-01d — Visão fiscal da linha de execução (somente Frontend).
 * Deriva Inventário / Validação / Recuperação dos dados já existentes
 * (status, contagens, stage, resultado_final). Não inventa métricas SSE.
 */
import type { ExecutionRow, ExecutionRowMetodo, ExecutionRowStatus } from './execution-row.model';

export type InventarioEstado =
  | 'Aguardando'
  | 'Em andamento'
  | 'Concluído'
  | 'Incompleto'
  | 'Falha';

export type ValidacaoEstado =
  | 'Não iniciada'
  | 'Em andamento'
  | 'Concluída'
  | 'Incompleta'
  | 'Falha'
  | 'Não disponível';

export type RecuperacaoEstado =
  | 'Aguardando'
  | 'Não disponível'
  | 'Não executada';

export interface ContagensFiscais {
  emitidas: number;
  recebidas: number;
  canceladas: number;
  total: number;
}

export interface InventarioView {
  estado: InventarioEstado;
  contagens: ContagensFiscais;
  /** Exibir números só quando há dado real ou execução finalizada. */
  exibirContagens: boolean;
}

export interface ValidacaoView {
  estado: ValidacaoEstado;
}

export interface RecuperacaoView {
  estado: RecuperacaoEstado;
  /** Sempre false nesta etapa: SEFIN/recuperação nativa não exposta ao FE. */
  exibirProgresso: boolean;
}

export interface AutenticacaoView {
  metodo: ExecutionRowMetodo;
  rotulo: string;
  aguardandoCaptcha: boolean;
}

export interface StatusView {
  status: ExecutionRowStatus;
  mensagem: string;
}

export interface VisaoFiscalLinha {
  autenticacao: AutenticacaoView;
  inventario: InventarioView;
  validacao: ValidacaoView;
  recuperacao: RecuperacaoView;
  status: StatusView;
  discoveryOnly: boolean;
}

function contagensDe(row: ExecutionRow): ContagensFiscais {
  const emitidas = row.qtd_emitidas ?? 0;
  const recebidas = row.qtd_recebidas ?? 0;
  const canceladas = row.qtd_canceladas ?? 0;
  return {
    emitidas,
    recebidas,
    canceladas,
    total: emitidas + recebidas,
  };
}

function temContagem(c: ContagensFiscais): boolean {
  return c.emitidas > 0 || c.recebidas > 0 || c.canceladas > 0;
}

/** Discovery-Only / homologação — nunca tratar como recuperação concluída. */
export function isDiscoveryOnlyResultado(resultadoFinal?: string | null): boolean {
  if (!resultadoFinal) return false;
  const r = resultadoFinal.toUpperCase();
  return r.includes('DISCOVERY_ONLY') || r.includes('HOMOLOGACAO_DISCOVERY');
}

export function isDiscoveryIncompleto(resultadoFinal?: string | null): boolean {
  if (!resultadoFinal) return false;
  const r = resultadoFinal.toUpperCase();
  return r.includes('INCOMPLETA') || r.includes('INCOMPLETO');
}

/** Cancelamento / bloqueio Discovery — não tratar inventário como concluído. */
export function isDiscoveryCanceladoOuBloqueado(resultadoFinal?: string | null): boolean {
  if (!resultadoFinal) return false;
  const r = resultadoFinal.toUpperCase();
  return r.includes('CANCELADA') || r.includes('BLOQUEADA');
}

/** Stages de download/inventário já emitidos pelo Backend (legado). */
const STAGES_INVENTARIO = new Set([
  'baixar_emitidas',
  'baixar_recebidas',
  'acessar_recebidas',
  'pesquisar_recebidas',
  'pesquisar_emitidas',
  'nenhuma_emitida',
  'nenhuma_recebida',
  'acessar_emitidas',
]);

export function stageSugereInventario(stage?: string | null): boolean {
  if (!stage) return false;
  return STAGES_INVENTARIO.has(stage) || stage.startsWith('baixar_') || stage.startsWith('pesquisar_');
}

export function mapearInventario(row: ExecutionRow): InventarioView {
  const contagens = contagensDe(row);
  const discovery = isDiscoveryOnlyResultado(row.resultado_final);
  const incompleto = isDiscoveryIncompleto(row.resultado_final);

  if (row.status === 'FILA') {
    return { estado: 'Aguardando', contagens, exibirContagens: false };
  }

  if (row.status === 'ERRO') {
    return {
      estado: 'Falha',
      contagens,
      exibirContagens: temContagem(contagens),
    };
  }

  if (row.status === 'OK') {
    if (discovery && isDiscoveryCanceladoOuBloqueado(row.resultado_final)) {
      return { estado: 'Falha', contagens, exibirContagens: true };
    }
    if (discovery && incompleto) {
      return { estado: 'Incompleto', contagens, exibirContagens: true };
    }
    // Status OK = esta execução encerrou a etapa de inventário/download.
    // Contagens ≠ inventário nativo completo nem documentos classificados.
    return { estado: 'Concluído', contagens, exibirContagens: true };
  }

  // EM_EXECUCAO / AGUARDANDO_CAPTCHA — contagens só se já houve evento counts.
  return {
    estado: 'Em andamento',
    contagens,
    exibirContagens: temContagem(contagens),
  };
}

/**
 * Sem eventos/contratos de classificação no SSE atual:
 * não afirma validação documental individual.
 */
export function mapearValidacao(row: ExecutionRow): ValidacaoView {
  if (row.status === 'FILA') {
    return { estado: 'Não iniciada' };
  }
  if (row.status === 'EM_EXECUCAO' || row.status === 'AGUARDANDO_CAPTCHA') {
    return { estado: 'Não iniciada' };
  }
  // Finalizado legado ou Discovery: Backend não envia evidência de validação por documento.
  return { estado: 'Não disponível' };
}

/**
 * Recuperação SEFIN / nativa não ativada nesta UI.
 * Contagens de download legado NÃO são progresso de recuperação.
 */
export function mapearRecuperacao(row: ExecutionRow): RecuperacaoView {
  if (isDiscoveryOnlyResultado(row.resultado_final)) {
    return { estado: 'Não executada', exibirProgresso: false };
  }
  if (row.status === 'FILA') {
    return { estado: 'Aguardando', exibirProgresso: false };
  }
  if (row.status === 'EM_EXECUCAO' || row.status === 'AGUARDANDO_CAPTCHA') {
    return { estado: 'Não executada', exibirProgresso: false };
  }
  // Legado concluído/erro: recuperação nativa não disponível no contrato FE.
  return { estado: 'Não disponível', exibirProgresso: false };
}

export function mapearAutenticacao(row: ExecutionRow): AutenticacaoView {
  const aguardandoCaptcha = row.status === 'AGUARDANDO_CAPTCHA';
  return {
    metodo: row.metodo,
    rotulo: row.metodo === 'CERTIFICADO' ? 'Certificado A1' : 'Credenciais',
    aguardandoCaptcha,
  };
}

export function mapearVisaoFiscal(row: ExecutionRow): VisaoFiscalLinha {
  return {
    autenticacao: mapearAutenticacao(row),
    inventario: mapearInventario(row),
    validacao: mapearValidacao(row),
    recuperacao: mapearRecuperacao(row),
    status: {
      status: row.status,
      mensagem: row.status === 'OK' ? '' : row.mensagem || '',
    },
    discoveryOnly: isDiscoveryOnlyResultado(row.resultado_final),
  };
}
