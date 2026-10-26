/**
 * UI-01e-C / C1 / D — Correlação, proteção conservadora e revisão monotônica (Frontend).
 *
 * Com `revisao` Backend (ambas as partes):
 * - maior → aplicar; igual → duplicata; menor → atrasado.
 * Sem revisão (legado): proteção C1 conservadora (não inventa revisão local).
 *
 * - Identidade: batch_id + empresa_id + execucao_id (nunca só CNPJ).
 * - Não usar contagens/páginas/% como prova de “mais recente”.
 * - fiscal_seq local só documenta aplicações aceitas; não é versão Backend.
 */
import type { ExecutionRow } from './execution-row.model';
import type { EstadoFaseFiscal, ProgressoFiscalNfse } from './progresso-fiscal.model';

export interface ContextoAplicacaoFiscal {
  batchIdAtual: string;
  /** Contador monotônico da sessão (incrementado a cada aplicação aceita). */
  proximoSeq: number;
}

export type DecisaoAplicacaoFiscal =
  | { acao: 'aplicar'; row: ExecutionRow; proximoSeq: number }
  | { acao: 'ignorar'; motivo: string; proximoSeq: number; diagnostico?: string }
  | { acao: 'limpar'; row: ExecutionRow; proximoSeq: number };

/** Estados intermediários do inventário (não “fechados”). */
const INTERMEDIARIOS = new Set<EstadoFaseFiscal>([
  'nao_iniciada',
  'em_andamento',
  'parcial',
  'indisponivel',
]);

/** Terminais de erro/interrupção — sem ordem entre si. */
const TERMINAIS_ERRO = new Set<EstadoFaseFiscal>([
  'falha',
  'cancelada',
  'timeout',
  'limite',
]);

const diagnosticosEmitidos = new Set<string>();

function empresaIdStr(row: ExecutionRow): string {
  return String(row.empresa_id);
}

function isConclusaoConfiavel(p: ProgressoFiscalNfse): boolean {
  return (
    p.inventario.estado === 'completa' &&
    p.inventario.conclusao_confiavel === true
  );
}

function isIntermediario(estado: EstadoFaseFiscal): boolean {
  return INTERMEDIARIOS.has(estado);
}

function isTerminalErro(estado: EstadoFaseFiscal): boolean {
  return TERMINAIS_ERRO.has(estado);
}

/**
 * Diagnóstico sanitizado (sem XML/PFX/senhas/tokens). Deduplicado por chave.
 */
export function registrarDiagnosticoFiscalConservador(chave: string, detalhe: string): void {
  if (diagnosticosEmitidos.has(chave)) return;
  diagnosticosEmitidos.add(chave);
  // eslint-disable-next-line no-console
  console.warn(`[fiscal-conservador] ${detalhe}`);
}

/** Limpa dedupe de diagnósticos (testes). */
export function limparDiagnosticosFiscalConservador(): void {
  diagnosticosEmitidos.clear();
}

/**
 * Avalia se o snapshot entrante regressaria o inventário já conhecido.
 * Não usa totais/páginas para decidir.
 */
export function avaliarProtecaoRegressaoFiscal(
  atual: ProgressoFiscalNfse,
  entrante: ProgressoFiscalNfse
): { permitir: boolean; motivo: string } {
  if (atual.execucao_id !== entrante.execucao_id) {
    return { permitir: false, motivo: 'execucao_divergente' };
  }

  const estAtual = atual.inventario.estado;
  const estNovo = entrante.inventario.estado;

  // Mesmo estado de inventário (e mesma confiabilidade no caso completa): permite refresh.
  if (estAtual === estNovo) {
    if (estAtual === 'completa') {
      if (atual.inventario.conclusao_confiavel && !entrante.inventario.conclusao_confiavel) {
        return { permitir: false, motivo: 'regressao_conclusao_confiavel' };
      }
    }
    return { permitir: true, motivo: 'mesmo_estado' };
  }

  // Conclusão confiável: não aceitar intermediários (parcial / em_andamento / …).
  if (isConclusaoConfiavel(atual) && isIntermediario(estNovo)) {
    return { permitir: false, motivo: 'regressao_completo_para_intermediario' };
  }

  // Conclusão confiável vs terminal de erro: conflito sem versão → preservar.
  if (isConclusaoConfiavel(atual) && isTerminalErro(estNovo)) {
    return { permitir: false, motivo: 'conflito_completo_vs_terminal_erro' };
  }

  // Terminal de erro: não aceitar intermediário.
  if (isTerminalErro(estAtual) && isIntermediario(estNovo)) {
    return { permitir: false, motivo: 'regressao_terminal_para_intermediario' };
  }

  // Terminal de erro vs completa confiável: conflito sem versão → preservar.
  if (isTerminalErro(estAtual) && isConclusaoConfiavel(entrante)) {
    return { permitir: false, motivo: 'conflito_terminal_erro_vs_completo' };
  }

  // Dois terminais de erro distintos: sem hierarquia → preservar existente.
  if (isTerminalErro(estAtual) && isTerminalErro(estNovo) && estAtual !== estNovo) {
    return { permitir: false, motivo: 'conflito_terminais_erro' };
  }

  // Terminal de erro vs completa não confiável: preservar terminal.
  if (isTerminalErro(estAtual) && estNovo === 'completa' && !entrante.inventario.conclusao_confiavel) {
    return { permitir: false, motivo: 'conflito_terminal_vs_completa_nao_confiavel' };
  }

  // Conclusão confiável vs completa não confiável já tratado no mesmo_estado;
  // completa não confiável entrante com estados diferentes: se atual é confiável, bloquear.
  if (isConclusaoConfiavel(atual) && estNovo === 'completa' && !entrante.inventario.conclusao_confiavel) {
    return { permitir: false, motivo: 'regressao_conclusao_confiavel' };
  }

  return { permitir: true, motivo: 'ok' };
}

/**
 * Tenta aplicar progresso fiscal à linha.
 * `origem`: sse | polling — mesma identidade e proteção de regressão.
 */
export function decidirAplicacaoFiscal(
  row: ExecutionRow,
  fiscal: ProgressoFiscalNfse,
  ctx: ContextoAplicacaoFiscal,
  origem: 'sse' | 'polling'
): DecisaoAplicacaoFiscal {
  const seq = ctx.proximoSeq;
  if (!ctx.batchIdAtual) {
    return { acao: 'ignorar', motivo: 'batch_ausente', proximoSeq: seq };
  }
  if (fiscal.batch_id !== null && fiscal.batch_id !== ctx.batchIdAtual) {
    return { acao: 'ignorar', motivo: 'lote_divergente', proximoSeq: seq };
  }
  if (origem === 'polling' && fiscal.batch_id === null) {
    return { acao: 'ignorar', motivo: 'fiscal_sem_lote', proximoSeq: seq };
  }
  if (empresaIdStr(row) !== fiscal.empresa_id) {
    return { acao: 'ignorar', motivo: 'empresa_divergente', proximoSeq: seq };
  }

  const atual = row.progresso_fiscal;
  if (atual && atual.execucao_id !== fiscal.execucao_id) {
    return { acao: 'ignorar', motivo: 'execucao_divergente', proximoSeq: seq };
  }
  if (row.execucao_id && row.execucao_id !== fiscal.execucao_id) {
    return { acao: 'ignorar', motivo: 'execucao_linha_divergente', proximoSeq: seq };
  }

  const revAtual = typeof atual?.revisao === 'number' && atual.revisao > 0 ? atual.revisao : null;
  const revNovo = typeof fiscal.revisao === 'number' && fiscal.revisao > 0 ? fiscal.revisao : null;

  // UI-01e-D — ambas com revisão Backend: ordenação monotônica (não usa fiscal_seq).
  if (revAtual != null && revNovo != null) {
    if (revNovo < revAtual) {
      return { acao: 'ignorar', motivo: 'revisao_atrasada', proximoSeq: seq };
    }
    if (revNovo === revAtual) {
      return { acao: 'ignorar', motivo: 'revisao_duplicata', proximoSeq: seq };
    }
    // revNovo > revAtual → aplicar (fonte de verdade Backend).
  } else if (atual) {
    // Legado / sem revisão: proteção C1 (não inventar revisão local).
    const prot = avaliarProtecaoRegressaoFiscal(atual, fiscal);
    if (!prot.permitir) {
      const diag = `exec=${fiscal.execucao_id} emp=${fiscal.empresa_id} lote=${ctx.batchIdAtual} origem=${origem} de=${atual.inventario.estado} para=${fiscal.inventario.estado} motivo=${prot.motivo}`;
      registrarDiagnosticoFiscalConservador(
        `${fiscal.execucao_id}:${prot.motivo}:${atual.inventario.estado}:${fiscal.inventario.estado}`,
        diag
      );
      return {
        acao: 'ignorar',
        motivo: prot.motivo,
        diagnostico: diag,
        proximoSeq: seq,
      };
    }
  }

  const nextSeq = seq + 1;
  return {
    acao: 'aplicar',
    proximoSeq: nextSeq,
    row: {
      ...row,
      execucao_id: fiscal.execucao_id,
      progresso_fiscal: fiscal,
      fiscal_seq: nextSeq,
    },
  };
}

/**
 * Evento SSE: exige batch_id do evento === lote da sessão.
 */
export function decidirAplicacaoFiscalSse(
  row: ExecutionRow,
  eventBatchId: string,
  eventEmpresaId: string,
  eventExecucaoId: string,
  fiscal: ProgressoFiscalNfse,
  ctx: ContextoAplicacaoFiscal
): DecisaoAplicacaoFiscal {
  if (eventBatchId !== ctx.batchIdAtual) {
    return { acao: 'ignorar', motivo: 'sse_outro_lote', proximoSeq: ctx.proximoSeq };
  }
  if (eventEmpresaId !== fiscal.empresa_id || eventExecucaoId !== fiscal.execucao_id) {
    return { acao: 'ignorar', motivo: 'sse_identidade_inconsistente', proximoSeq: ctx.proximoSeq };
  }
  if (fiscal.batch_id !== null && fiscal.batch_id !== eventBatchId) {
    return { acao: 'ignorar', motivo: 'sse_fiscal_batch_divergente', proximoSeq: ctx.proximoSeq };
  }
  const fiscalNorm: ProgressoFiscalNfse = {
    ...fiscal,
    batch_id: fiscal.batch_id ?? eventBatchId,
  };
  return decidirAplicacaoFiscal(row, fiscalNorm, ctx, 'sse');
}

/**
 * Polling: se status terminal e Backend omitiu `fiscal`, limpa snapshot local.
 * Com fiscal válido: mesmas verificações de identidade e regressão (não assume “mais novo” que SSE).
 */
export function decidirPollingFiscal(
  row: ExecutionRow,
  fiscalRaw: ProgressoFiscalNfse | null | undefined,
  statusBackend: string,
  ctx: ContextoAplicacaoFiscal
): DecisaoAplicacaoFiscal {
  const terminal =
    statusBackend === 'concluido' ||
    statusBackend === 'falhou' ||
    row.status === 'OK' ||
    row.status === 'ERRO';

  if (fiscalRaw) {
    return decidirAplicacaoFiscal(row, fiscalRaw, ctx, 'polling');
  }

  if (terminal && row.progresso_fiscal) {
    return {
      acao: 'limpar',
      proximoSeq: ctx.proximoSeq,
      row: {
        ...row,
        progresso_fiscal: undefined,
      },
    };
  }

  return { acao: 'ignorar', motivo: 'polling_sem_fiscal', proximoSeq: ctx.proximoSeq };
}
