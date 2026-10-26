/**
 * API-03B / API-03M — reconciliação visual por empresa (null → "—").
 */
import { formatarMetricaNumero, type MetricasOperacionaisApi } from './metricas-operacionais.model';
import type { ExecutionRow } from './execution-row.model';

export type StatusFiscalUi =
  | 'reconciliada'
  | 'sem_movimento'
  | 'parcial'
  | 'indeterminada'
  | 'concluida_com_pendencias'
  | 'erro'
  | 'indisponivel';

export interface PendenciaFiscalApi {
  chave_acesso?: string | null;
  numero_nota?: string | null;
  codigo?: string | null;
  motivo?: string | null;
  xml_recuperado?: boolean | null;
  documento_exportado?: boolean | null;
}

export interface ReconciliacaoApi {
  emitidas_descobertas?: number | null;
  recebidas_descobertas?: number | null;
  vigentes?: number | null;
  canceladas?: number | null;
  indeterminadas?: number | null;
  xmls_validos_confirmados?: number | null;
  xmls_com_atencao_fiscal?: number | null;
  xmls_novos?: number | null;
  xmls_preexistentes_downloads?: number | null;
  xmls_downloads?: number | null;
  chaves_vigentes_faltantes?: number | null;
  chaves_vigentes_faltantes_lista?: string[] | null;
  cobertura_pct?: number | null;
  status_fiscal?: StatusFiscalUi | null;
  motivo_erro?: string | null;
  etapa_falha?: string | null;
  pendencias_fiscais?: PendenciaFiscalApi[] | null;
}

export interface PendenciaFiscalView {
  chaveAcesso: string;
  numeroNota: string;
  codigo: string;
  rotuloCodigo: string;
  motivo: string;
  xmlRecuperado: boolean;
  documentoExportado: boolean;
}

export interface ReconciliacaoLinhaView {
  emitidas: string;
  recebidas: string;
  vigentes: string;
  canceladas: string;
  indeterminadas: string;
  xmlsValidos: string;
  xmlsAtencaoFiscal: string;
  downloads: string;
  faltantes: string;
  cobertura: string;
  statusFiscal: StatusFiscalUi;
  rotuloStatusFiscal: string;
  motivoErro: string | null;
  etapaFalha: string | null;
  temIndeterminadas: boolean;
  temPendenciasFiscais: boolean;
  pendenciasFiscais: PendenciaFiscalView[];
  chavesVigentesFaltantesLista: string[];
  retomavelHint: string | null;
}

const ROTULOS: Record<StatusFiscalUi, string> = {
  reconciliada: 'Reconciliada',
  sem_movimento: 'Sem movimento',
  parcial: 'Parcial',
  indeterminada: 'Indeterminada',
  concluida_com_pendencias: 'Concluída com pendências',
  erro: 'Erro',
  indisponivel: '—',
};

const ROTULOS_PENDENCIA: Record<string, string> = {
  ATENCAO_SITUACAO_NAO_CONFIRMADA: 'XML recuperado — atenção fiscal',
  XML_INDETERMINADA_NAO_RECUPERADO: 'XML não recuperado',
  BLOQUEIO_VALIDACAO_DOCUMENTAL: 'Falha de validação documental',
};

export function rotuloStatusFiscal(s: StatusFiscalUi | null | undefined): string {
  if (!s) return '—';
  return ROTULOS[s] ?? '—';
}

export function rotuloCodigoPendencia(codigo: string | null | undefined): string {
  if (!codigo) return '—';
  return ROTULOS_PENDENCIA[codigo] ?? codigo;
}

function hintRetomada(row: ExecutionRow, r: ReconciliacaoApi | null): string | null {
  if (row.status !== 'ERRO') return null;
  const msg = (r?.motivo_erro || row.mensagem || '').toLowerCase();
  if (msg.includes('indeterminad')) return 'Exige revisão de situação fiscal';
  if (msg.includes('err_timed_out') || msg.includes('timeout')) return 'Aguardar portal e retentar';
  if (msg.includes('dashboard')) return 'Nova autenticação';
  if (msg.includes('cobertura fiscal') || msg.includes('nao_reconciliada')) {
    return 'Retomar recuperação SEFIN (checkpoint)';
  }
  if (msg.includes('nav_falha') || msg.includes('filtro') || msg.includes('lista_vazia')) {
    return 'Refazer descoberta';
  }
  if (msg.includes('fechou')) return 'Refazer descoberta (sessão interrompida)';
  return 'Revisar e retentar';
}

function mapearPendencias(api: ReconciliacaoApi | null): PendenciaFiscalView[] {
  const lista = api?.pendencias_fiscais;
  if (!lista?.length) return [];
  return lista.map((p) => ({
    chaveAcesso: p.chave_acesso || '—',
    numeroNota: p.numero_nota || '—',
    codigo: p.codigo || '—',
    rotuloCodigo: rotuloCodigoPendencia(p.codigo),
    motivo: p.motivo || '—',
    xmlRecuperado: Boolean(p.xml_recuperado),
    documentoExportado: Boolean(p.documento_exportado),
  }));
}

/** Deriva visão a partir do payload API ou fallback local (legado). */
export function mapearReconciliacaoLinha(row: ExecutionRow): ReconciliacaoLinhaView {
  const api = row.reconciliacao ?? null;
  const m: MetricasOperacionaisApi | null | undefined = row.metricas_operacionais;
  const fiscal = row.progresso_fiscal;

  const emitidas =
    api?.emitidas_descobertas ??
    fiscal?.inventario?.totais?.emitidas ??
    (row.status === 'OK' || row.status === 'ERRO' ? row.qtd_emitidas ?? 0 : null);
  const recebidas =
    api?.recebidas_descobertas ??
    fiscal?.inventario?.totais?.recebidas ??
    (row.status === 'OK' || row.status === 'ERRO' ? row.qtd_recebidas ?? 0 : null);
  const canceladas =
    api?.canceladas ??
    fiscal?.validacao?.canceladas ??
    fiscal?.inventario?.totais?.canceladas ??
    (row.status === 'OK' || row.status === 'ERRO' ? row.qtd_canceladas ?? 0 : null);
  const vigentes = api?.vigentes ?? fiscal?.validacao?.vigentes ?? fiscal?.inventario?.totais?.vigentes ?? null;
  const indeterminadas =
    api?.indeterminadas ?? fiscal?.validacao?.indeterminadas ?? fiscal?.inventario?.totais?.indeterminadas ?? null;

  const xmlsValidos = api?.xmls_validos_confirmados ?? m?.xmls_persistidos ?? null;
  const xmlsAtencao = api?.xmls_com_atencao_fiscal ?? null;
  let downloads = api?.xmls_downloads ?? null;
  if (downloads == null && m) {
    if (m.xmls_exportados != null || m.xmls_ja_existentes != null) {
      downloads = (m.xmls_exportados ?? 0) + (m.xmls_ja_existentes ?? 0);
    }
  }

  const listaFaltantes = api?.chaves_vigentes_faltantes_lista ?? [];
  let faltantes = api?.chaves_vigentes_faltantes ?? null;
  if (listaFaltantes.length > 0) {
    faltantes = listaFaltantes.length;
  } else if (faltantes == null && vigentes != null && xmlsValidos != null) {
    faltantes = Math.max(0, vigentes - xmlsValidos);
  }
  let cobertura = api?.cobertura_pct ?? null;
  if (cobertura == null && vigentes != null && xmlsValidos != null) {
    cobertura = vigentes === 0 ? 100 : Math.min(100, Math.round((xmlsValidos / vigentes) * 100));
  }

  let statusFiscal: StatusFiscalUi = api?.status_fiscal ?? 'indisponivel';
  if (!api?.status_fiscal) {
    if (row.status === 'ERRO') statusFiscal = 'erro';
    else if ((indeterminadas ?? 0) > 0 || row.resultado_final === 'CONCLUIDA_COM_PENDENCIAS') {
      statusFiscal = 'concluida_com_pendencias';
    } else if (row.status === 'OK') {
      const desc = (emitidas ?? 0) + (recebidas ?? 0);
      if (desc === 0) statusFiscal = 'sem_movimento';
      else if (faltantes === 0 && vigentes != null && xmlsValidos != null) statusFiscal = 'reconciliada';
      else if (xmlsValidos == null || (faltantes != null && faltantes > 0)) statusFiscal = 'parcial';
    }
  }

  const pendenciasFiscais = mapearPendencias(api);

  return {
    emitidas: formatarMetricaNumero(emitidas),
    recebidas: formatarMetricaNumero(recebidas),
    vigentes: formatarMetricaNumero(vigentes),
    canceladas: formatarMetricaNumero(canceladas),
    indeterminadas: formatarMetricaNumero(indeterminadas),
    xmlsValidos: formatarMetricaNumero(xmlsValidos),
    xmlsAtencaoFiscal: formatarMetricaNumero(xmlsAtencao),
    downloads: formatarMetricaNumero(downloads),
    faltantes: formatarMetricaNumero(faltantes),
    cobertura: cobertura == null ? '—' : `${cobertura}%`,
    statusFiscal,
    rotuloStatusFiscal: rotuloStatusFiscal(statusFiscal),
    motivoErro: api?.motivo_erro ?? (row.status === 'ERRO' ? row.mensagem || null : null),
    etapaFalha: api?.etapa_falha ?? (row.status === 'ERRO' ? row.ultimo_stage || null : null),
    temIndeterminadas: (indeterminadas ?? 0) > 0,
    temPendenciasFiscais: pendenciasFiscais.length > 0 || (indeterminadas ?? 0) > 0,
    pendenciasFiscais,
    chavesVigentesFaltantesLista: listaFaltantes,
    retomavelHint: hintRetomada(row, api),
  };
}

/** Progresso operacional: tentativas encerradas / total. */
export function percentualProcessadas(rows: ExecutionRow[]): number {
  if (rows.length === 0) return 0;
  const encerradas = rows.filter((r) => r.status === 'OK' || r.status === 'ERRO').length;
  return Math.round((encerradas / rows.length) * 100);
}

export function contarStatusFiscal(
  rows: ExecutionRow[],
  status: StatusFiscalUi
): number {
  return rows.filter((r) => mapearReconciliacaoLinha(r).statusFiscal === status).length;
}
