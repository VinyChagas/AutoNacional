/**
 * Adaptador puro: ResultadoSyncAdn (+ inventário parcial) → ProgressoFiscalNfse.
 *
 * REGRA: fim da distribuição NSU NÃO declara inventário mensal COMPLETO.
 * conclusao_confiavel permanece false; completude PARCIAL (ou INDETERMINADO).
 * Sem SEFIN, sem percentuais artificiais.
 */
import type { ResultadoAdaptacaoInventarioAdn } from '../adn/inventory-adapter';
import type { ConsolidacaoInventarioPersistidoAdn } from '../adn/inventario-persistido';
import type { ResultadoSyncAdn } from '../adn/types';
import type { IdentidadeProgressoFiscal } from './from-discovery-only';
import { REVISAO_FISCAL_NAO_PUBLICADA } from './revisao';
import type { EstadoFaseFiscal, ProgressoFiscalNfse, TotaisProgressoFiscal } from './types';

export interface EntradaAdaptadorSyncAdn {
  identidade: IdentidadeProgressoFiscal;
  sync: ResultadoSyncAdn;
  adaptacao: ResultadoAdaptacaoInventarioAdn;
  /** Consolidação persistido+sessão (competência solicitada). */
  consolidacao?: ConsolidacaoInventarioPersistidoAdn | null;
  /** Motivo operacional exibido na UI. */
  motivo?: string | null;
  /** Código de erro tipado (interrupção, gate, etc.). */
  codigoErro?: string | null;
  interrompido?: boolean;
}

const TOTAIS_ZEROS: TotaisProgressoFiscal = {
  emitidas: 0,
  recebidas: 0,
  canceladas: 0,
  vigentes: 0,
  indeterminadas: 0,
  descobertos: 0,
  paginas: 0,
};

function totaisDe(
  sync: ResultadoSyncAdn,
  adaptacao: ResultadoAdaptacaoInventarioAdn,
  consolidacao?: ConsolidacaoInventarioPersistidoAdn | null
): TotaisProgressoFiscal {
  // Preferir consolidação por competência (persistido + período solicitado).
  if (consolidacao?.evidenciaPersistenciaOk) {
    const p = consolidacao.periodo;
    const emitidas = p.emitidas;
    const recebidas = p.recebidas;
    // Eventos na pasta ADN ≈ cancelamentos/eventos; sem vínculo 1:1 com chave.
    const canceladas = p.eventos;
    const indeterminadas = p.naoClassificados + p.intermediadas;
    return {
      emitidas,
      recebidas,
      canceladas,
      vigentes: Math.max(0, emitidas + recebidas),
      indeterminadas,
      descobertos: emitidas + recebidas,
      paginas: sync.lotesProcessados,
    };
  }

  const docs = adaptacao.inventario.documentos;
  let emitidas = 0;
  let recebidas = 0;
  let vigentes = 0;
  let canceladas = 0;
  let indeterminadas = 0;
  for (const d of docs) {
    if (d.direcao === 'EMITIDA') emitidas += 1;
    else if (d.direcao === 'RECEBIDA') recebidas += 1;
    if (d.situacao === 'VIGENTE') vigentes += 1;
    else if (d.situacao === 'CANCELADA') canceladas += 1;
    else indeterminadas += 1;
  }
  // Preferir contagens do inventário mapeado; fallback nas contagens brutas do sync.
  if (docs.length === 0) {
    return {
      ...TOTAIS_ZEROS,
      emitidas: sync.contagens.emitidas,
      recebidas: sync.contagens.recebidas,
      descobertos: sync.contagens.emitidas + sync.contagens.recebidas,
      paginas: sync.lotesProcessados,
    };
  }
  return {
    emitidas,
    recebidas,
    canceladas,
    vigentes,
    indeterminadas,
    descobertos: emitidas + recebidas,
    paginas: sync.lotesProcessados,
  };
}

function estadoInventario(
  sync: ResultadoSyncAdn,
  adaptacao: ResultadoAdaptacaoInventarioAdn,
  codigoErro: string | null,
  interrompido: boolean
): { estado: EstadoFaseFiscal; completude: 'PARCIAL' | 'INDETERMINADO'; confiavel: false } {
  const completude = adaptacao.inventario.completude === 'INDETERMINADO' ? 'INDETERMINADO' : 'PARCIAL';

  if (interrompido || codigoErro === 'INTERRUPCAO') {
    return { estado: 'cancelada', completude, confiavel: false };
  }
  if (codigoErro === 'TIMEOUT') {
    return { estado: 'timeout', completude, confiavel: false };
  }
  if (
    codigoErro === 'LIMITE_REQUISICOES' ||
    codigoErro === 'LIMITE_DOCUMENTOS' ||
    codigoErro === 'LIMITE_ARMAZENAMENTO'
  ) {
    return { estado: 'limite', completude, confiavel: false };
  }
  if (sync.status === 'ERRO' || codigoErro) {
    return { estado: 'falha', completude, confiavel: false };
  }
  // COMPLETO no sync = fim da distribuição NSU — inventário mensal permanece parcial.
  return { estado: 'parcial', completude, confiavel: false };
}

/**
 * Converte sync ADN + inventário parcial em progresso fiscal para SSE/polling.
 * Nunca marca inventário como completa/COMPLETO com conclusao_confiavel.
 */
export function progressoFiscalDeSyncAdn(entrada: EntradaAdaptadorSyncAdn): ProgressoFiscalNfse {
  const { identidade, sync, adaptacao } = entrada;
  const codigoStr = entrada.codigoErro?.trim() || null;
  const interrompido = Boolean(entrada.interrompido);
  const inv = estadoInventario(sync, adaptacao, codigoStr, interrompido);
  const totais = totaisDe(sync, adaptacao, entrada.consolidacao);

  // Garantia explícita: nunca COMPLETO via ADN nesta etapa.
  if (adaptacao.inventarioMensalCompletoDeclarado !== false) {
    throw new Error('Adaptador ADN violou inventarioMensalCompletoDeclarado === false.');
  }
  if (inv.completude === ('COMPLETO' as string)) {
    throw new Error('progressoFiscalDeSyncAdn não pode declarar completude COMPLETO.');
  }

  const motivo =
    entrada.motivo?.trim() ||
    `ADN ${sync.status}; fimDistribuicao=${sync.fimDistribuicaoConfirmado}; ` +
      `inventário mensal NÃO comprovado (PARCIAL).`;

  return {
    versao: 1,
    batch_id: identidade.batchId,
    empresa_id: identidade.empresaId,
    execucao_id: identidade.execucaoId,
    cnpj: identidade.cnpj,
    revisao: REVISAO_FISCAL_NAO_PUBLICADA,
    inventario: {
      estado: inv.estado,
      completude: inv.completude,
      conclusao_confiavel: false,
      totais,
    },
    validacao: {
      estado: inv.estado === 'parcial' ? 'parcial' : inv.estado,
      origem: 'ADN',
      vigentes: totais.vigentes,
      canceladas: totais.canceladas,
      indeterminadas: totais.indeterminadas,
      conclusao_confiavel: false,
    },
    recuperacao: {
      estado: 'nao_executada',
      conclusao_confiavel: false,
    },
    codigo: codigoStr,
    message: motivo,
    estado_operacional: sync.status,
    veredito_discovery: null,
  };
}
