/**
 * Análise de lote e continuidade de cursor NSU.
 * Próximo cursor = maior NSU do lote (não NSU+1 cego).
 */
import type { DistribuicaoNsuItem, LoteDistribuicaoNsuResponse } from './types';

export const MAX_LOTE_DOCUMENTADO = 50;

export interface LoteAnaliseAdn {
  statusProcessamento?: string;
  quantidade: number;
  nsus: number[];
  menorNsu?: number;
  maiorNsu?: number;
  proximoCursor?: number;
  tiposDocumento: Record<string, number>;
  tiposEvento: Record<string, number>;
  comChave: number;
  comXml: number;
  loteCheio: boolean;
  fimDistribuicao: boolean;
  progresso: boolean;
}

export function analisarLote(
  data: LoteDistribuicaoNsuResponse | undefined,
  cursorSolicitado: number,
  statusHttp: number
): LoteAnaliseAdn {
  const lote = data?.LoteDFe ?? [];
  const statusProcessamento = data?.StatusProcessamento;
  const nsus = lote
    .map((i) => i.NSU)
    .filter((n): n is number => typeof n === 'number' && Number.isFinite(n));

  const menorNsu = nsus.length ? Math.min(...nsus) : undefined;
  const maiorNsu = nsus.length ? Math.max(...nsus) : undefined;

  const tiposDocumento: Record<string, number> = {};
  const tiposEvento: Record<string, number> = {};
  let comChave = 0;
  let comXml = 0;

  for (const item of lote) {
    const td = item.TipoDocumento ?? 'DESCONHECIDO';
    tiposDocumento[td] = (tiposDocumento[td] ?? 0) + 1;
    if (item.TipoEvento) {
      tiposEvento[item.TipoEvento] = (tiposEvento[item.TipoEvento] ?? 0) + 1;
    }
    if (item.ChaveAcesso) comChave += 1;
    if (item.ArquivoXml) comXml += 1;
  }

  const fimDistribuicao =
    statusProcessamento === 'NENHUM_DOCUMENTO_LOCALIZADO' ||
    ((statusHttp === 404 || statusHttp === 200) &&
      lote.length === 0 &&
      statusProcessamento !== 'DOCUMENTOS_LOCALIZADOS');

  const progresso =
    (statusProcessamento === 'DOCUMENTOS_LOCALIZADOS' &&
      lote.length > 0 &&
      maiorNsu != null &&
      maiorNsu !== cursorSolicitado) ||
    (lote.length > 0 && maiorNsu != null && maiorNsu > cursorSolicitado);

  return {
    statusProcessamento,
    quantidade: lote.length,
    nsus: [...nsus].sort((a, b) => a - b),
    menorNsu,
    maiorNsu,
    proximoCursor: maiorNsu,
    tiposDocumento,
    tiposEvento,
    comChave,
    comXml,
    loteCheio: lote.length >= MAX_LOTE_DOCUMENTADO,
    fimDistribuicao,
    progresso,
  };
}

/** Deduplicação de item de lote (documento e evento podem compartilhar chave). */
export function dedupeKeyDistribuicao(item: DistribuicaoNsuItem): string {
  const nsu = item.NSU ?? 'x';
  const tipo = item.TipoDocumento ?? 'NENHUM';
  const chave = item.ChaveAcesso ?? '';
  const evt = item.TipoEvento ?? '';
  return `${nsu}|${tipo}|${chave}|${evt}`;
}
