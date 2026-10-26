/**
 * Extração da chave nacional a partir do href ou de data-chave.
 * Não clica, não baixa e não aceita chave de 44 dígitos.
 */
import { TAMANHO_CHAVE_NACIONAL } from '../contracts/documento-fiscal';
import type { FonteChaveDescoberta } from './types';

const HREF_NFSE = /\/Notas\/Download\/NFSe\/(\d+)/i;
const CHAVE_50 = /\d{50}/;

export interface CandidatoChave {
  chave: string;
  fonte: Exclude<FonteChaveDescoberta, 'NAO_IDENTIFICADA'>;
}

export interface ChaveDaLinha {
  chave: string | null;
  fonte: FonteChaveDescoberta;
  problemas: string[];
  candidatos: CandidatoChave[];
}

export function chaveNacionalNoTexto(valor: string | null | undefined): string | null {
  if (!valor) return null;
  return valor.match(CHAVE_50)?.[0] ?? null;
}

export function analisarHrefDownload(href: string): { digitos: string | null } {
  const limpo = href.replace(/\s/g, '');
  const match = HREF_NFSE.exec(limpo);
  return { digitos: match?.[1] ?? null };
}

export function extrairChaveDaLinha(input: {
  hrefs: readonly string[];
  dataChave: string | null;
  /** Textos das células — só aceita chave se houver exatamente um candidato único de 50 dígitos. */
  textos?: readonly string[];
}): ChaveDaLinha {
  const candidatos: CandidatoChave[] = [];
  const problemas: string[] = [];
  let hrefValido = false;

  for (const href of input.hrefs) {
    if (!/\/Notas\/Download\/NFSe\//i.test(href)) continue;
    const { digitos } = analisarHrefDownload(href);
    if (!digitos) {
      problemas.push('CHAVE_INVALIDA');
      continue;
    }
    if (digitos.length === 44) {
      problemas.push('CHAVE_44_REJEITADA');
      continue;
    }
    if (digitos.length !== TAMANHO_CHAVE_NACIONAL) {
      problemas.push('CHAVE_INVALIDA');
      continue;
    }
    hrefValido = true;
    if (!candidatos.some((item) => item.chave === digitos && item.fonte === 'HREF_DOWNLOAD_XML')) {
      candidatos.push({ chave: digitos, fonte: 'HREF_DOWNLOAD_XML' });
    }
  }

  if (input.dataChave) {
    const extraida = chaveNacionalNoTexto(input.dataChave);
    if (!extraida) {
      if (!hrefValido) problemas.push('DATA_CHAVE_NAO_VERIFICAVEL');
    } else if (!candidatos.some((item) => item.chave === extraida && item.fonte === 'DATA_CHAVE')) {
      candidatos.push({ chave: extraida, fonte: 'DATA_CHAVE' });
    }
  }

  // Célula com chave visível (única) — não inventa; só confirma dígitos já renderizados.
  if (input.textos && input.textos.length > 0) {
    const noTexto = [
      ...new Set(
        input.textos
          .map((texto) => chaveNacionalNoTexto(texto))
          .filter((chave): chave is string => chave != null)
      ),
    ];
    if (noTexto.length === 1) {
      const chave = noTexto[0];
      if (!candidatos.some((item) => item.chave === chave && item.fonte === 'TEXTO_CELULA')) {
        candidatos.push({ chave, fonte: 'TEXTO_CELULA' });
      }
    } else if (noTexto.length > 1 && candidatos.length === 0) {
      problemas.push('CONFLITO_IDENTIFICADOR');
    }
  }

  const unicas = [...new Set(candidatos.map((item) => item.chave))];
  if (unicas.length > 1) {
    return {
      chave: null,
      fonte: candidatos[0]?.fonte ?? 'NAO_IDENTIFICADA',
      problemas: [...problemas, 'CONFLITO_IDENTIFICADOR'],
      candidatos,
    };
  }

  if (unicas.length === 1) {
    const escolhida =
      candidatos.find((item) => item.fonte === 'HREF_DOWNLOAD_XML') ??
      candidatos.find((item) => item.fonte === 'DATA_CHAVE') ??
      candidatos[0];
    return {
      chave: escolhida.chave,
      fonte: escolhida.fonte,
      problemas: problemas.filter((codigo) => codigo !== 'DATA_CHAVE_NAO_VERIFICAVEL'),
      candidatos,
    };
  }

  return {
    chave: null,
    fonte: 'NAO_IDENTIFICADA',
    problemas: problemas.length > 0 ? problemas : ['CHAVE_NAO_IDENTIFICADA'],
    candidatos,
  };
}
