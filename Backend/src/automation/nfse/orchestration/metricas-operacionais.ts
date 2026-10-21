/**
 * API-02W — telemetria de duração (relógio monotônico) e contadores operacionais.
 * Não inventa métricas: campos ausentes permanecem null.
 */

/** Marca monotônica em milissegundos (process.hrtime). */
export function agoraMonotonicoMs(): number {
  return Number(process.hrtime.bigint() / 1_000_000n);
}

export function deltaMonotonicoMs(inicioMs: number, fimMs: number = agoraMonotonicoMs()): number {
  const d = fimMs - inicioMs;
  return d >= 0 ? d : 0;
}

export interface DuracoesOperacionaisNfse {
  chromiumMs: number | null;
  autenticacaoMs: number | null;
  descobertaEmitidasMs: number | null;
  descobertaRecebidasMs: number | null;
  recuperacaoSefinMs: number | null;
  persistenciaExportacaoMs: number | null;
  duracaoTotalMs: number | null;
}

export interface ContadoresOperacionaisNfse {
  /** Chaves/notas descobertas no Portal (não confundir com XML SEFIN). */
  notasDescobertas: number | null;
  /** XMLs confirmados e persistidos no store fiscal. */
  xmlsPersistidos: number | null;
  /** XMLs copiados para downloads nesta execução. */
  xmlsExportados: number | null;
  /** XMLs já existentes nos downloads (hash igual). */
  xmlsJaExistentes: number | null;
}

export interface MetricasOperacionaisNfse {
  duracoes: DuracoesOperacionaisNfse;
  contadores: ContadoresOperacionaisNfse;
}

export function metricasOperacionaisVazias(): MetricasOperacionaisNfse {
  return {
    duracoes: {
      chromiumMs: null,
      autenticacaoMs: null,
      descobertaEmitidasMs: null,
      descobertaRecebidasMs: null,
      recuperacaoSefinMs: null,
      persistenciaExportacaoMs: null,
      duracaoTotalMs: null,
    },
    contadores: {
      notasDescobertas: null,
      xmlsPersistidos: null,
      xmlsExportados: null,
      xmlsJaExistentes: null,
    },
  };
}

/** Payload JSON estável para status/batch (snake_case). */
export function serializarMetricasOperacionais(
  m: MetricasOperacionaisNfse | null | undefined
): Record<string, number | null> | null {
  if (!m) return null;
  return {
    chromium_ms: m.duracoes.chromiumMs,
    autenticacao_ms: m.duracoes.autenticacaoMs,
    descoberta_emitidas_ms: m.duracoes.descobertaEmitidasMs,
    descoberta_recebidas_ms: m.duracoes.descobertaRecebidasMs,
    recuperacao_sefin_ms: m.duracoes.recuperacaoSefinMs,
    persistencia_exportacao_ms: m.duracoes.persistenciaExportacaoMs,
    duracao_total_ms: m.duracoes.duracaoTotalMs,
    notas_descobertas: m.contadores.notasDescobertas,
    xmls_persistidos: m.contadores.xmlsPersistidos,
    xmls_exportados: m.contadores.xmlsExportados,
    xmls_ja_existentes: m.contadores.xmlsJaExistentes,
  };
}

export class CronometroMonotonico {
  private readonly t0: number;
  private marcas = new Map<string, number>();

  constructor() {
    this.t0 = agoraMonotonicoMs();
  }

  marcar(nome: string): void {
    this.marcas.set(nome, agoraMonotonicoMs());
  }

  /** Duração entre duas marcas; null se alguma ausente. */
  entre(inicio: string, fim: string): number | null {
    const a = this.marcas.get(inicio);
    const b = this.marcas.get(fim);
    if (a == null || b == null) return null;
    return deltaMonotonicoMs(a, b);
  }

  desdeInicioAte(fim: string): number | null {
    const b = this.marcas.get(fim);
    if (b == null) return null;
    return deltaMonotonicoMs(this.t0, b);
  }

  totalAteAgora(): number {
    return deltaMonotonicoMs(this.t0);
  }
}
