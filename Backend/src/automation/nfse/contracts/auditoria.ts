/**
 * Conferência entre documentos vigentes do inventário e XMLs recuperados.
 * Não abre arquivo e não calcula hash.
 */
import type { InventarioNfse } from './inventario';
import { xmlRecuperadoUtilizavel, type RecuperacaoDocumento } from './recuperacao';

export const STATUS_APROVACAO_AUDITORIA = ['APROVADA', 'REPROVADA'] as const;
export type StatusAprovacaoAuditoria = (typeof STATUS_APROVACAO_AUDITORIA)[number];

export interface AuditoriaRecuperacao {
  totalVigentes: number;
  xmlsValidos: number;
  xmlsAusentes: number;
  xmlsInvalidos: number;
  xmlsDuplicados: number;
  canceladasExcluidas: number;
  /** Fração de 0 a 1 dos vigentes com exatamente um XML utilizável. */
  coberturaVigentes: number;
  statusAprovacao: StatusAprovacaoAuditoria;
}

function agruparPorChave(
  recuperacoes: readonly RecuperacaoDocumento[]
): Map<string, RecuperacaoDocumento[]> {
  const grupos = new Map<string, RecuperacaoDocumento[]>();
  for (const item of recuperacoes) {
    const lista = grupos.get(item.chaveNacional) ?? [];
    lista.push(item);
    grupos.set(item.chaveNacional, lista);
  }
  return grupos;
}

function recuperacaoInvalida(item: RecuperacaoDocumento): boolean {
  if (item.resultado === 'FALHOU') return true;
  if (item.resultado === 'RECUPERADO' || item.resultado === 'REUTILIZADO') {
    return !xmlRecuperadoUtilizavel(item);
  }
  return false;
}

export function auditarRecuperacao(
  inventario: InventarioNfse,
  recuperacoes: readonly RecuperacaoDocumento[]
): AuditoriaRecuperacao {
  const porChave = agruparPorChave(recuperacoes);
  const vigentes = inventario.documentos.filter((documento) => documento.situacao === 'VIGENTE');
  const canceladas = inventario.documentos.filter((documento) => documento.situacao === 'CANCELADA');

  let xmlsValidos = 0;
  let xmlsAusentes = 0;
  let xmlsInvalidos = 0;
  let xmlsDuplicados = 0;
  let vigentesCobertos = 0;

  for (const documento of vigentes) {
    const itens = porChave.get(documento.chaveNacional) ?? [];
    const validos = itens.filter(xmlRecuperadoUtilizavel);
    const invalidos = itens.filter(recuperacaoInvalida);

    xmlsValidos += validos.length;
    if (validos.length > 1) xmlsDuplicados += validos.length - 1;
    if (validos.length === 1) vigentesCobertos += 1;
    if (validos.length === 0 && invalidos.length > 0) xmlsInvalidos += invalidos.length;
    if (validos.length === 0 && invalidos.length === 0) xmlsAusentes += 1;
  }

  const chavesRecuperadas = new Set(recuperacoes.map((item) => item.chaveNacional));
  const canceladasExcluidas = canceladas.filter(
    (documento) => !chavesRecuperadas.has(documento.chaveNacional)
  ).length;
  const canceladaIncluida = canceladas.length - canceladasExcluidas;
  const indeterminadaComXml = inventario.documentos
    .filter((documento) => documento.situacao === 'INDETERMINADA')
    .some((documento) => (porChave.get(documento.chaveNacional) ?? []).some(xmlRecuperadoUtilizavel));

  const coberturaVigentes = vigentes.length === 0 ? 1 : vigentesCobertos / vigentes.length;
  const statusAprovacao: StatusAprovacaoAuditoria =
    coberturaVigentes === 1 &&
    xmlsAusentes === 0 &&
    xmlsInvalidos === 0 &&
    xmlsDuplicados === 0 &&
    canceladaIncluida === 0 &&
    !indeterminadaComXml
      ? 'APROVADA'
      : 'REPROVADA';

  return {
    totalVigentes: vigentes.length,
    xmlsValidos,
    xmlsAusentes,
    xmlsInvalidos,
    xmlsDuplicados,
    canceladasExcluidas,
    coberturaVigentes,
    statusAprovacao,
  };
}
