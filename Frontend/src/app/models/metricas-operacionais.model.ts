/**
 * API-02W — métricas operacionais da execução (API snake_case → UI).
 * null = indisponível → exibir "—"; 0 só quando medido de fato.
 */

export interface MetricasOperacionaisApi {
  chromium_ms?: number | null;
  autenticacao_ms?: number | null;
  descoberta_emitidas_ms?: number | null;
  descoberta_recebidas_ms?: number | null;
  recuperacao_sefin_ms?: number | null;
  persistencia_exportacao_ms?: number | null;
  duracao_total_ms?: number | null;
  notas_descobertas?: number | null;
  xmls_persistidos?: number | null;
  xmls_exportados?: number | null;
  xmls_ja_existentes?: number | null;
}

/** Formata duração ms → "4m 18s" / "45s" / "—". */
export function formatarDuracaoMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

/** Número ou "—" quando indisponível (não confunde null com zero). */
export function formatarMetricaNumero(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return String(n);
}

export function xmlsDisponiveisDownloads(m: MetricasOperacionaisApi | null | undefined): number | null {
  if (!m) return null;
  const exp = m.xmls_exportados;
  const iguais = m.xmls_ja_existentes;
  if (exp == null && iguais == null) return null;
  return (exp ?? 0) + (iguais ?? 0);
}
