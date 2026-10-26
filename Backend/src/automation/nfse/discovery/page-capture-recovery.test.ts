import { describe, expect, it } from 'vitest';
import { evidenciaSituacaoVazia } from './row-parser';
import {
  linhaTemChaveConfirmada,
  paginaIncompletaAnteTotalizador,
  paginaRequerRecaptura,
  paginaTemLinhaSemChave,
} from './page-capture-recovery';
import type { LinhaListagem, PaginaListagem } from './types';

const CHAVE = '1'.repeat(50);

function linha(parcial: Partial<LinhaListagem> & { linha: number }): LinhaListagem {
  return {
    pagina: 1,
    hrefs: [],
    dataChave: null,
    textos: [],
    evidenciaSituacao: evidenciaSituacaoVazia(),
    ...parcial,
  };
}

function pagina(parcial: Partial<PaginaListagem> & { linhas: LinhaListagem[] }): PaginaListagem {
  return {
    url: 'https://www.nfse.gov.br/EmissorNacional/Notas/Recebidas',
    paginaIndicador: 3,
    totalizador: null,
    semRegistros: false,
    proxima: { presente: false, desabilitado: true },
    fingerprint: 'fp',
    ...parcial,
  };
}

describe('API-03H — recuperação localizada da página', () => {
  it('confirma chave por href', () => {
    expect(
      linhaTemChaveConfirmada(
        linha({ linha: 0, hrefs: [`/EmissorNacional/Notas/Download/NFSe/${CHAVE}`] })
      )
    ).toBe(true);
  });

  it('confirma chave única no texto da célula (sem inventar)', () => {
    expect(
      linhaTemChaveConfirmada(linha({ linha: 0, textos: [`Acesso ${CHAVE}`] }))
    ).toBe(true);
  });

  it('linha sem chave confirmada continua bloqueada', () => {
    const sem = linha({
      linha: 11,
      dataChave: 'MW85eTRUeExBcE1mV09YVjJrMVlZOU1taXRPMlVLSWdJVk5EUWQxaFVhcVNv',
    });
    expect(linhaTemChaveConfirmada(sem)).toBe(false);
    expect(paginaTemLinhaSemChave(pagina({ linhas: [sem] }))).toBe(true);
    expect(paginaRequerRecaptura(pagina({ linhas: [sem] }))).toBe(true);
  });

  it('detecta página final incompleta ante totalizador (45 vs 42)', () => {
    expect(
      paginaIncompletaAnteTotalizador({
        totalizador: 45,
        acumuladosAntes: 30,
        linhasNaPagina: 12,
        ultimaPagina: true,
      })
    ).toBe(true);

    const incompleta = pagina({
      totalizador: 45,
      linhas: Array.from({ length: 12 }, (_, i) =>
        linha({
          linha: i,
          hrefs: [`/EmissorNacional/Notas/Download/NFSe/${String(i).padStart(50, '0')}`],
        })
      ),
      proxima: { presente: true, desabilitado: true },
    });
    expect(paginaRequerRecaptura(incompleta, { acumuladosAntes: 30 })).toBe(true);
  });

  it('não exige recaptura quando 45/45 e chaves ok', () => {
    const completa = pagina({
      totalizador: 45,
      linhas: Array.from({ length: 15 }, (_, i) =>
        linha({
          linha: i,
          hrefs: [`/EmissorNacional/Notas/Download/NFSe/${String(i).padStart(50, '0')}`],
        })
      ),
      proxima: { presente: false, desabilitado: true },
    });
    expect(paginaRequerRecaptura(completa, { acumuladosAntes: 30 })).toBe(false);
  });

  it('lista vazia confirmada não dispara recaptura', () => {
    expect(
      paginaRequerRecaptura(
        pagina({
          semRegistros: true,
          linhas: [],
          totalizador: 0,
        })
      )
    ).toBe(false);
  });
});
