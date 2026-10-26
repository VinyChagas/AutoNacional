/**
 * API-03H — recuperação localizada da leitura de página (sem inventar chaves).
 * Decide quando re-estabilizar/relêr; a descoberta continua bloqueando se a chave
 * não for confirmável após a tentativa.
 */
import { extrairChaveDaLinha } from './chave';
import type { LinhaListagem, PaginaListagem } from './types';

export function linhaTemChaveConfirmada(linha: Pick<LinhaListagem, 'hrefs' | 'dataChave' | 'textos'>): boolean {
  return extrairChaveDaLinha({
    hrefs: linha.hrefs,
    dataChave: linha.dataChave,
    textos: linha.textos,
  }).chave != null;
}

export function paginaTemLinhaSemChave(pagina: Pick<PaginaListagem, 'linhas'>): boolean {
  return pagina.linhas.some((linha) => !linhaTemChaveConfirmada(linha));
}

/**
 * Última página com totalizador conhecido e contagem aquém do esperado:
 * provável renderização incompleta (ex.: 12/15 na página final).
 */
export function paginaIncompletaAnteTotalizador(input: {
  totalizador: number | null;
  acumuladosAntes: number;
  linhasNaPagina: number;
  ultimaPagina: boolean;
}): boolean {
  if (input.totalizador == null || !input.ultimaPagina) return false;
  if (input.linhasNaPagina === 0) return false;
  return input.acumuladosAntes + input.linhasNaPagina < input.totalizador;
}

export function paginaRequerRecaptura(
  pagina: PaginaListagem,
  opcoes: { acumuladosAntes?: number } = {}
): boolean {
  if (pagina.semRegistros && pagina.linhas.length === 0) return false;
  if (paginaTemLinhaSemChave(pagina)) return true;
  const ultima =
    !pagina.proxima.presente || pagina.proxima.desabilitado;
  return paginaIncompletaAnteTotalizador({
    totalizador: pagina.totalizador,
    acumuladosAntes: opcoes.acumuladosAntes ?? 0,
    linhasNaPagina: pagina.linhas.length,
    ultimaPagina: ultima,
  });
}
