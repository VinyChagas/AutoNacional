/**
 * UI-01e-B1/B2 — Retenção limitada do progresso fiscal após finalização (mesmo processo).
 *
 * RESTART: snapshots em memória NÃO sobrevivem. Evidências em disco NÃO permitem
 * reconstrução integral segura (faltam batch_id/empresa_id/CNPJ completo indexados).
 * Após restart, o polling pode devolver execução sem campo `fiscal`.
 *
 * Não armazena Playwright, XML, PFX, senhas, tokens, cookies nem resultado bruto Discovery.
 */
import type { ProgressoFiscalNfse } from './types';
import { limparRevisoesProgressoFiscal } from './revisao';

/** TTL após marcação de finalização. */
export const RETENCAO_FISCAL_TTL_MS = 24 * 60 * 60 * 1000;

/** Máximo global de snapshots em memória. */
export const RETENCAO_FISCAL_MAX_SNAPSHOTS = 2000;

/** Snapshot de polling + fiscal (dados planos; sem handles de browser). */
export interface SnapshotProgressoFiscalPolling {
  empresa_id: string;
  cnpj: string;
  /** Lote real; null em homologação admin sem batch. */
  batch_id: string | null;
  execucao_id: string;
  status: string;
  etapa_atual: string;
  progresso: number;
  mensagem: string;
  qtd_notas_emitidas: number;
  qtd_notas_recebidas: number;
  qtd_notas_canceladas: number;
  resultado_final: string | null;
  tipo_autenticacao?: string;
  /** ADN | PLAYWRIGHT — indicador de navegadores ignora ADN. */
  motor?: 'ADN' | 'PLAYWRIGHT';
  periodo_inicio?: string;
  periodo_fim?: string;
  fiscal: ProgressoFiscalNfse;
}

export interface OpcoesRetencaoProgressoFiscal {
  /** true na finalização — inicia TTL. false/omitido = execução ainda ativa (não evictável por limite). */
  marcadoFinalizado?: boolean;
  /** Epoch ms — testes com relógio controlado. */
  agora?: number;
}

interface EntradaRetencao {
  snapshot: SnapshotProgressoFiscalPolling;
  /** Momento da última retenção. */
  retidoEm: number;
  /** null = ainda considerada ativa para TTL/evicção. */
  finalizadoEm: number | null;
}

const porExecucao = new Map<string, EntradaRetencao>();
/** Índice lote+empresa → execucao_id (só quando batch_id real). */
const porLoteEmpresa = new Map<string, string>();

let relogio: () => number = () => Date.now();
let descartesPorLimiteAtivas = 0;

function agoraMs(override?: number): number {
  return override ?? relogio();
}

function chaveLoteEmpresa(batchId: string, empresaId: string): string {
  return `${batchId}::${empresaId}`;
}

function clonarSnapshot(s: SnapshotProgressoFiscalPolling): SnapshotProgressoFiscalPolling {
  return structuredClone(s);
}

function removerIndiceLoteSeAponta(entrada: EntradaRetencao, execId: string): void {
  const bid = entrada.snapshot.batch_id;
  if (!bid) return;
  const k = chaveLoteEmpresa(bid, entrada.snapshot.empresa_id);
  if (porLoteEmpresa.get(k) === execId) {
    porLoteEmpresa.delete(k);
  }
}

function removerEntrada(execId: string): void {
  const entrada = porExecucao.get(execId);
  if (!entrada) return;
  removerIndiceLoteSeAponta(entrada, execId);
  porExecucao.delete(execId);
}

function expirado(entrada: EntradaRetencao, agora: number): boolean {
  if (entrada.finalizadoEm == null) return false;
  return agora - entrada.finalizadoEm > RETENCAO_FISCAL_TTL_MS;
}

/** Remove finalizados cujo TTL expirou. Preserva entradas ainda ativas (finalizadoEm null). */
function limparExpirados(agora: number): void {
  for (const [execId, entrada] of [...porExecucao.entries()]) {
    if (expirado(entrada, agora)) {
      removerEntrada(execId);
    }
  }
}

/**
 * Evicta finalizados mais antigos até caber no limite.
 * Nunca remove entradas com finalizadoEm == null (ativas).
 * @returns false se ainda não há espaço para uma nova inserção (só ativas no limite).
 */
function evictarFinalizadosAntigosSeNecessario(agora: number, reservarNova: boolean): boolean {
  limparExpirados(agora);
  const limite = RETENCAO_FISCAL_MAX_SNAPSHOTS;
  const alvo = reservarNova ? limite - 1 : limite;
  if (porExecucao.size <= alvo) return true;

  const finalizados: { execId: string; finalizadoEm: number }[] = [];
  for (const [execId, entrada] of porExecucao.entries()) {
    if (entrada.finalizadoEm != null) {
      finalizados.push({ execId, finalizadoEm: entrada.finalizadoEm });
    }
  }
  finalizados.sort((a, b) => a.finalizadoEm - b.finalizadoEm);

  for (const item of finalizados) {
    if (porExecucao.size <= alvo) break;
    removerEntrada(item.execId);
  }

  return porExecucao.size <= alvo;
}

/**
 * Relógio injetável para testes (sem esperas reais de 24h).
 * Passar null restaura Date.now.
 */
export function definirRelogioRetencaoFiscal(fn: (() => number) | null): void {
  relogio = fn ?? (() => Date.now());
}

/** Contador de inserções recusadas por limite com apenas ativas (diagnóstico). */
export function descartesRetencaoPorLimiteAtivas(): number {
  return descartesPorLimiteAtivas;
}

/**
 * Retém (ou atualiza) o snapshot. Isola por execucao_id.
 * Limpeza oportunística: TTL + limite global.
 * Armazena e devolve clones — sem compartilhar referência mutável.
 */
export function retenirProgressoFiscal(
  snapshot: SnapshotProgressoFiscalPolling,
  opcoes?: OpcoesRetencaoProgressoFiscal
): boolean {
  const agora = agoraMs(opcoes?.agora);
  const execId = snapshot.execucao_id.trim();
  const empresaId = snapshot.empresa_id.trim();
  if (!execId || !empresaId) return false;
  if (snapshot.fiscal.execucao_id !== execId) return false;
  if (snapshot.fiscal.empresa_id !== empresaId) return false;
  if (
    snapshot.batch_id !== null &&
    snapshot.fiscal.batch_id !== null &&
    snapshot.fiscal.batch_id !== snapshot.batch_id
  ) {
    return false;
  }

  const existente = porExecucao.get(execId);
  const ehAtualizacao = Boolean(existente);

  if (!ehAtualizacao) {
    if (!evictarFinalizadosAntigosSeNecessario(agora, true)) {
      descartesPorLimiteAtivas += 1;
      return false;
    }
  } else {
    limparExpirados(agora);
  }

  const normalizado = clonarSnapshot({
    ...snapshot,
    empresa_id: empresaId,
    execucao_id: execId,
    batch_id: snapshot.batch_id,
    fiscal: {
      ...snapshot.fiscal,
      empresa_id: empresaId,
      execucao_id: execId,
      batch_id: snapshot.batch_id,
    },
  });

  let finalizadoEm: number | null = existente?.finalizadoEm ?? null;
  if (opcoes?.marcadoFinalizado) {
    finalizadoEm = agora;
  }

  // Atualização: limpar índice antigo se o lote mudou.
  if (existente) {
    removerIndiceLoteSeAponta(existente, execId);
  }

  porExecucao.set(execId, {
    snapshot: normalizado,
    retidoEm: agora,
    finalizadoEm,
  });

  if (normalizado.batch_id) {
    const k = chaveLoteEmpresa(normalizado.batch_id, empresaId);
    const anterior = porLoteEmpresa.get(k);
    if (anterior && anterior !== execId) {
      // Mesmo lote+empresa aponta para outra execução: remove índice antigo só se ainda válido;
      // a entrada da outra execução permanece isolada por execucao_id.
      porLoteEmpresa.set(k, execId);
    } else {
      porLoteEmpresa.set(k, execId);
    }
  }

  return true;
}

function snapshotPublico(entrada: EntradaRetencao, agora: number): SnapshotProgressoFiscalPolling | null {
  if (expirado(entrada, agora)) return null;
  return clonarSnapshot(entrada.snapshot);
}

export function obterSnapshotPorExecucao(
  execucaoId: string,
  agora?: number
): SnapshotProgressoFiscalPolling | null {
  const now = agoraMs(agora);
  limparExpirados(now);
  const entrada = porExecucao.get(execucaoId.trim());
  if (!entrada) return null;
  return snapshotPublico(entrada, now);
}

/**
 * Consulta retenção por lote real + empresa.
 * Não inventa batchId; sem batch não há índice de lote.
 */
export function obterSnapshotPorLoteEmpresa(
  batchId: string,
  empresaId: string,
  agora?: number
): SnapshotProgressoFiscalPolling | null {
  const now = agoraMs(agora);
  limparExpirados(now);
  const bid = batchId.trim();
  const eid = empresaId.trim();
  if (!bid || !eid) return null;
  const execId = porLoteEmpresa.get(chaveLoteEmpresa(bid, eid));
  if (!execId) return null;
  const entrada = porExecucao.get(execId);
  if (!entrada || entrada.snapshot.batch_id !== bid || entrada.snapshot.empresa_id !== eid) {
    return null;
  }
  return snapshotPublico(entrada, now);
}

/** Todos os snapshots retidos (não expirados) de um lote. */
export function listarSnapshotsPorLote(
  batchId: string,
  agora?: number
): SnapshotProgressoFiscalPolling[] {
  const now = agoraMs(agora);
  limparExpirados(now);
  const bid = batchId.trim();
  if (!bid) return [];
  const out: SnapshotProgressoFiscalPolling[] = [];
  for (const entrada of porExecucao.values()) {
    if (entrada.snapshot.batch_id !== bid) continue;
    const pub = snapshotPublico(entrada, now);
    if (pub) out.push(pub);
  }
  return out;
}

/** Simula reinício do processo (esvazia retenção + revisões em memória). */
export function limparRetencaoProgressoFiscal(): void {
  porExecucao.clear();
  porLoteEmpresa.clear();
  descartesPorLimiteAtivas = 0;
  limparRevisoesProgressoFiscal();
}

export function tamanhoRetencaoProgressoFiscal(): number {
  return porExecucao.size;
}

/** Metadados internos (testes): finalizadoEm da execução. */
export function obterMetadadosRetencaoFiscal(
  execucaoId: string
): { retidoEm: number; finalizadoEm: number | null } | null {
  const e = porExecucao.get(execucaoId.trim());
  if (!e) return null;
  return { retidoEm: e.retidoEm, finalizadoEm: e.finalizadoEm };
}
