/**
 * API-03B — Reconciliação fiscal por execução (somente dados comprováveis).
 *
 * Regras:
 * - Canceladas NÃO entram na meta de XMLs vigentes.
 * - Indeterminadas impedem status "reconciliada".
 * - Não declara cobertura completa só por contagem de arquivos.
 * - xmls_novos = exportados nesta execução; xmls_preexistentes_downloads = já iguais.
 * - Ausência de dado → null (UI: "—"), nunca zero inventado.
 */
import type { ProgressoFiscalNfse } from '../progresso-fiscal/types';
import type { MetricasOperacionaisNfse } from './metricas-operacionais';
import { serializarMetricasOperacionais } from './metricas-operacionais';

export type StatusFiscalReconciliacao =
  | 'reconciliada'
  | 'sem_movimento'
  | 'parcial'
  | 'indeterminada'
  | 'concluida_com_pendencias'
  | 'erro'
  | 'indisponivel';

export interface PendenciaFiscalApi {
  chave_acesso: string;
  numero_nota: string | null;
  codigo: string;
  motivo: string;
  xml_recuperado: boolean;
  documento_exportado: boolean;
}

export interface ReconciliacaoExecucao {
  emitidas_descobertas: number | null;
  recebidas_descobertas: number | null;
  vigentes: number | null;
  canceladas: number | null;
  indeterminadas: number | null;
  /** XMLs válidos confirmados de vigentes (não inclui indeterminadas). */
  xmls_validos_confirmados: number | null;
  /** API-03M — XMLs indeterminados persistidos (atenção fiscal). */
  xmls_com_atencao_fiscal: number | null;
  /** Novos copiados para downloads nesta execução. */
  xmls_novos: number | null;
  /** Já existentes nos downloads (hash igual). */
  xmls_preexistentes_downloads: number | null;
  /** Disponíveis nos downloads = novos + preexistentes (quando medidos). */
  xmls_downloads: number | null;
  /**
   * Chaves vigentes ainda sem XML confirmado (contagem).
   * Só quando vigentes e xmls_validos são conhecidos.
   */
  chaves_vigentes_faltantes: number | null;
  /** API-03N — lista de chaves vigentes sem XML (quando conhecida). */
  chaves_vigentes_faltantes_lista: string[] | null;
  /** 0–100; null se não calculável com segurança. */
  cobertura_pct: number | null;
  status_fiscal: StatusFiscalReconciliacao;
  motivo_erro: string | null;
  etapa_falha: string | null;
  /** API-03M — detalhe por nota indeterminada. */
  pendencias_fiscais: PendenciaFiscalApi[] | null;
}

export interface EntradaReconciliacaoExecucao {
  statusExecucao: string;
  resultadoFinal?: string | null;
  mensagemErro?: string | null;
  etapaAtual?: string | null;
  qtdEmitidas?: number | null;
  qtdRecebidas?: number | null;
  qtdCanceladas?: number | null;
  fiscal?: ProgressoFiscalNfse | null;
  metricas?: MetricasOperacionaisNfse | null;
  xmlsComAtencaoFiscal?: number | null;
  pendenciasFiscais?: PendenciaFiscalApi[] | null;
  chavesPendentesExportadas?: readonly string[] | null;
  /** API-03N — chaves vigentes sem XML íntegro. */
  chavesVigentesFaltantesLista?: readonly string[] | null;
}

function nOrNull(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  return v;
}

/**
 * Monta snapshot de reconciliação a partir de progresso fiscal + métricas + contagens.
 * Não acessa disco; não inventa chaves.
 */
export function montarReconciliacaoExecucao(
  entrada: EntradaReconciliacaoExecucao
): ReconciliacaoExecucao {
  const totais = entrada.fiscal?.inventario?.totais;
  const validacao = entrada.fiscal?.validacao;

  const emitidas =
    nOrNull(totais?.emitidas) ??
    (entrada.qtdEmitidas != null ? nOrNull(entrada.qtdEmitidas) : null);
  const recebidas =
    nOrNull(totais?.recebidas) ??
    (entrada.qtdRecebidas != null ? nOrNull(entrada.qtdRecebidas) : null);

  const canceladas =
    nOrNull(validacao?.canceladas) ??
    nOrNull(totais?.canceladas) ??
    (entrada.qtdCanceladas != null ? nOrNull(entrada.qtdCanceladas) : null);

  const indeterminadas = nOrNull(validacao?.indeterminadas) ?? nOrNull(totais?.indeterminadas);

  // Vigentes: preferir validação/inventário. Fallback NÃO pode tratar indeterminada como vigente.
  let vigentes = nOrNull(validacao?.vigentes) ?? nOrNull(totais?.vigentes);
  if (vigentes == null && emitidas != null && recebidas != null) {
    const descobertos = emitidas + recebidas;
    if (canceladas != null) {
      const indet = indeterminadas ?? 0;
      vigentes = Math.max(0, descobertos - canceladas - indet);
    }
  }

  const cont = entrada.metricas?.contadores;
  const xmlsValidos = nOrNull(cont?.xmlsPersistidos);
  const xmlsAtencao = nOrNull(entrada.xmlsComAtencaoFiscal);
  const xmlsNovos = nOrNull(cont?.xmlsExportados);
  const xmlsPre = nOrNull(cont?.xmlsJaExistentes);
  let xmlsDownloads: number | null = null;
  if (xmlsNovos != null || xmlsPre != null) {
    xmlsDownloads = (xmlsNovos ?? 0) + (xmlsPre ?? 0);
  }

  const listaFaltantes =
    entrada.chavesVigentesFaltantesLista != null
      ? [...entrada.chavesVigentesFaltantesLista]
      : null;

  let faltantes: number | null = null;
  let cobertura: number | null = null;
  if (listaFaltantes != null) {
    faltantes = listaFaltantes.length;
  } else if (vigentes != null && xmlsValidos != null) {
    faltantes = Math.max(0, vigentes - xmlsValidos);
  }
  if (vigentes != null && xmlsValidos != null) {
    cobertura = vigentes === 0 ? 100 : Math.min(100, Math.round((xmlsValidos / vigentes) * 100));
  }

  const statusLower = (entrada.statusExecucao || '').toLowerCase();
  const resultadoFinal = (entrada.resultadoFinal || '').toUpperCase();
  const ehErro =
    (statusLower === 'erro' ||
      statusLower === 'falhou' ||
      statusLower === 'error' ||
      Boolean(entrada.mensagemErro?.trim())) &&
    resultadoFinal !== 'CONCLUIDA_COM_PENDENCIAS';

  let status_fiscal: StatusFiscalReconciliacao = 'indisponivel';
  if (resultadoFinal === 'CONCLUIDA_COM_PENDENCIAS' || ((indeterminadas ?? 0) > 0 && !ehErro)) {
    status_fiscal = 'concluida_com_pendencias';
  } else if (ehErro) {
    status_fiscal = 'erro';
  } else if (
    statusLower === 'ok' ||
    statusLower === 'concluido' ||
    statusLower === 'finalizado'
  ) {
    const descobertos =
      emitidas != null && recebidas != null ? emitidas + recebidas : null;
    if (descobertos === 0 || (vigentes === 0 && (descobertos ?? 0) === 0)) {
      status_fiscal = 'sem_movimento';
    } else if (faltantes === 0 && vigentes != null && xmlsValidos != null) {
      status_fiscal = 'reconciliada';
    } else if (xmlsValidos != null && vigentes != null && faltantes != null && faltantes > 0) {
      status_fiscal = 'parcial';
    } else if (descobertos != null && descobertos > 0 && xmlsValidos == null) {
      status_fiscal = 'parcial';
    } else if (vigentes === 0) {
      status_fiscal = 'sem_movimento';
    } else {
      status_fiscal = 'indisponivel';
    }
  }

  const motivo =
    entrada.mensagemErro?.trim() ||
    entrada.fiscal?.message?.trim() ||
    null;
  const etapa =
    entrada.etapaAtual?.trim() ||
    entrada.fiscal?.codigo?.trim() ||
    null;

  const exportadas = new Set(entrada.chavesPendentesExportadas ?? []);
  const pendencias =
    entrada.pendenciasFiscais?.map((p) => ({
      ...p,
      documento_exportado: p.documento_exportado || exportadas.has(p.chave_acesso),
    })) ?? null;

  return {
    emitidas_descobertas: emitidas,
    recebidas_descobertas: recebidas,
    vigentes,
    canceladas,
    indeterminadas,
    xmls_validos_confirmados: xmlsValidos,
    xmls_com_atencao_fiscal: xmlsAtencao,
    xmls_novos: xmlsNovos,
    xmls_preexistentes_downloads: xmlsPre,
    xmls_downloads: xmlsDownloads,
    chaves_vigentes_faltantes: faltantes,
    chaves_vigentes_faltantes_lista: listaFaltantes,
    cobertura_pct: cobertura,
    status_fiscal,
    motivo_erro: ehErro ? motivo : null,
    etapa_falha: ehErro ? etapa : null,
    pendencias_fiscais: pendencias,
  };
}

/** Serializa para API (mesmo shape). */
export function serializarReconciliacao(
  r: ReconciliacaoExecucao | null | undefined
): ReconciliacaoExecucao | null {
  return r ?? null;
}

/** Atalho: métricas serializadas + reconciliação a partir da entrada. */
export function montarPayloadOperacional(entrada: EntradaReconciliacaoExecucao): {
  metricas_operacionais: Record<string, number | null> | null;
  reconciliacao: ReconciliacaoExecucao;
} {
  return {
    metricas_operacionais: serializarMetricasOperacionais(entrada.metricas),
    reconciliacao: montarReconciliacaoExecucao(entrada),
  };
}
