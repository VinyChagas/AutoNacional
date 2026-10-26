/**
 * Decisões de paginação a partir do que já foi capturado.
 * Não assume 15 linhas por página.
 */
import type { PaginaListagem } from './types';

export const LIMITE_SEGURANCA_PAGINAS = 500;

const VAZIO = [
  /nenhum\s+registro\s+encontrado/i,
  /nenhuma\s+nota\s+encontrada/i,
  /n[aã]o\s+h[aá]\s+registros/i,
  /nao\s+ha\s+registros/i,
];

export function textoIndicaSemRegistros(texto: string): boolean {
  return VAZIO.some((padrao) => padrao.test(texto));
}

export function fingerprintPagina(
  pagina: Pick<PaginaListagem, 'url' | 'paginaIndicador' | 'linhas'>
): string {
  const chaves = pagina.linhas.map((linha) => {
    const href = linha.hrefs.find((item) => /\/Notas\/Download\/NFSe\//i.test(item));
    return href || linha.dataChave || linha.textos.join(' ').slice(0, 80);
  });
  const digest = pagina.linhas.map((linha) => linha.textos.join('|')).join('||');
  return [pagina.paginaIndicador ?? '?', pagina.url, chaves.join(','), digest.slice(0, 240)].join(
    '#'
  );
}

export function comFingerprint(
  pagina: Omit<PaginaListagem, 'fingerprint'>
): PaginaListagem {
  return { ...pagina, fingerprint: fingerprintPagina(pagina) };
}

export function proximaDesabilitada(classes: Array<string | null | undefined>): boolean {
  return classes.some((classe) => (classe ?? '').toLowerCase().includes('disabled'));
}

export function parseTotalizador(texto: string | null | undefined): number | null {
  if (!texto) return null;
  const de = texto.match(/de\s+(\d+)\s+registros?/i);
  if (de) return Number(de[1]);
  const registros = texto.match(/(\d+)\s+registros?/i);
  if (registros) return Number(registros[1]);
  return null;
}
