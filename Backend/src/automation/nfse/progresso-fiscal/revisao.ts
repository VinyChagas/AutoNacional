/**
 * UI-01e-D — Revisão monotônica por execucao_id para ProgressoFiscalNfse.
 *
 * Ponto único de publicação: `publicarProgressoFiscal`.
 * Consultas (listar/obter retenção) NÃO incrementam.
 * Conteúdo idêntico (fingerprint) NÃO incrementa (duplicata / finalização sem mudança).
 * Evicção/TTL da retenção NÃO zera revisões (evita reinício em 1 para a mesma execução).
 *
 * RESTART completo (`limparRevisoesProgressoFiscal` / limpar retenção): mapa zera com o processo.
 */
import type { ProgressoFiscalNfse } from './types';

/** Primeira revisão atribuída a uma execução. */
export const REVISAO_FISCAL_INICIAL = 1;

/** Placeholder do adaptador antes da publicação. */
export const REVISAO_FISCAL_NAO_PUBLICADA = 0;

interface EstadoRevisaoExecucao {
  revisao: number;
  fingerprint: string;
}

const porExecucao = new Map<string, EstadoRevisaoExecucao>();

/** Serialização canônica (chaves ordenadas) — determinística e sem `revisao`. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

/**
 * Fingerprint estável do conteúdo fiscal apresentado.
 * Exclui `revisao`. Inclui identidade, fases, totais, códigos e mensagens (sem segredos).
 */
export function fingerprintProgressoFiscal(fiscal: ProgressoFiscalNfse): string {
  const { revisao: _ignorada, ...resto } = fiscal;
  return canonicalJson(resto);
}

/**
 * Atribui/reutiliza revisão monotônica para a execução.
 * Mesmo conteúdo → mesma revisão. Conteúdo novo → revisao + 1.
 * Não usa relógio, contagens isoladas nem ordem de chegada externa.
 */
export function publicarProgressoFiscal(fiscal: ProgressoFiscalNfse): ProgressoFiscalNfse {
  const execId = fiscal.execucao_id.trim();
  if (!execId) {
    return { ...fiscal, revisao: REVISAO_FISCAL_INICIAL };
  }

  const fingerprint = fingerprintProgressoFiscal(fiscal);
  const prev = porExecucao.get(execId);

  let revisao: number;
  if (prev && prev.fingerprint === fingerprint) {
    revisao = prev.revisao;
  } else if (prev) {
    revisao = prev.revisao + 1;
  } else {
    revisao = REVISAO_FISCAL_INICIAL;
  }

  porExecucao.set(execId, { revisao, fingerprint });
  return { ...fiscal, revisao };
}

export function obterRevisaoPublicada(execucaoId: string): number | null {
  return porExecucao.get(execucaoId.trim())?.revisao ?? null;
}

/** Simula restart / limpeza de ciclo de vida em memória. */
export function limparRevisoesProgressoFiscal(): void {
  porExecucao.clear();
}

export function tamanhoRevisoesProgressoFiscal(): number {
  return porExecucao.size;
}
