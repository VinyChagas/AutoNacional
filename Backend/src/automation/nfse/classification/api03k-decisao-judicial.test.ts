/**
 * API-03K — correção definitiva: decisão adm./judicial (P102 / tb-nota-bypass) → VIGENTE.
 * Fluxo: HTML → parser → classificação → meta SEFIN (sem inventar cancelamento).
 */
import { describe, expect, it } from 'vitest';
import {
  bloqueiaProcessamentoAutomatico,
  criarDocumentoFiscal,
  entraNaExportacaoXmlVigentes,
  entraNaRecuperacaoSefin,
  montarInventario,
  montarPlanoRecuperacao,
} from '../contracts';
import { criarPeriodoConsultaPortal } from '../contracts/periodo';
import { interpretarHtmlTabela } from '../discovery/row-parser';
import {
  CODIGO_DATA_SITUACAO_CANCELADA,
  CODIGO_DATA_SITUACAO_GERADA,
  classificarSituacao,
  ehCodigoDecisaoJudicialPortal,
  evidenciaTemDecisaoAdministrativaJudicial,
} from './situacao';

const CHAVE_CRASA = '35503081221063590000171000000000023826080259038744';
const PERIODO = criarPeriodoConsultaPortal('01/08/2026', '31/08/2026');

/** HTML real do Portal (Consórcio Crasa) — apenas ícone bypass. */
const HTML_BYPASS_CRASA = `
<table><tbody>
  <tr data-chave="${CHAVE_CRASA}">
    <td>1</td>
    <td class="td-situacao">
      <img
        src="/EmissorNacional/img/tb-nota-bypass.svg"
        alt="NFS-e emitida via decisão administrativa/judicial"
        data-original-title="NFS-e emitida via decisão administrativa/judicial"
      >
    </td>
    <td><a href="/EmissorNacional/Notas/Download/NFSe/${CHAVE_CRASA}">XML</a></td>
  </tr>
</tbody></table>`;

/** Situação com img genérico + bypass na linha (bug API-03K: fallback não rodava). */
const HTML_BYPASS_COM_IMG_GENERICO = `
<table><tbody>
  <tr data-chave="${CHAVE_CRASA}">
    <td class="td-situacao">
      <img src="/EmissorNacional/img/spacer.gif" alt="">
      <img
        src="/EmissorNacional/img/tb-nota-bypass.svg"
        alt="NFS-e emitida via decisão administrativa/judicial"
        data-bs-original-title="NFS-e emitida via decisão administrativa/judicial"
      >
    </td>
  </tr>
</tbody></table>`;

function evidencia(parcial: {
  dataSituacao?: string | null;
  textoColuna?: string | null;
  icones?: Array<{
    src?: string | null;
    alt?: string | null;
    title?: string | null;
    dataOriginalTitle?: string | null;
  }>;
}) {
  return {
    dataSituacao: parcial.dataSituacao ?? null,
    textoColuna: parcial.textoColuna ?? null,
    classeColuna: 'td-situacao',
    icones: (parcial.icones ?? []).map((icone) => ({
      src: icone.src ?? null,
      title: icone.title ?? null,
      dataOriginalTitle: icone.dataOriginalTitle ?? null,
      alt: icone.alt ?? null,
      ariaLabel: null,
    })),
  };
}

function documentoVigenteDe(chave: string, situacao: 'VIGENTE' | 'CANCELADA' | 'INDETERMINADA') {
  return criarDocumentoFiscal({
    chaveNacional: chave,
    cnpj: '21063590000171',
    direcao: 'EMITIDA',
    situacao,
    periodoConsulta: PERIODO,
    origemClassificacao: 'PORTAL',
    evidencias: [{ origem: 'PORTAL', descricao: 'teste-03k' }],
  });
}

describe('API-03K — decisão administrativa/judicial definitiva', () => {
  it('HTML real Crasa: captura atributos e classifica VIGENTE', () => {
    const linha = interpretarHtmlTabela(HTML_BYPASS_CRASA)[0];
    const icone = linha.evidenciaSituacao.icones[0];
    expect(icone.src).toContain('tb-nota-bypass.svg');
    expect(icone.alt).toMatch(/decisão administrativa\/judicial/i);
    expect(icone.dataOriginalTitle).toMatch(/decisão administrativa\/judicial/i);

    const r = classificarSituacao(linha.evidenciaSituacao);
    expect(r.situacao).toBe('VIGENTE');
    expect(r.codigoSituacaoDesconhecido).toBeNull();
    expect(bloqueiaProcessamentoAutomatico(documentoVigenteDe(CHAVE_CRASA, r.situacao))).toBe(false);
  });

  it('mescla bypass mesmo com img genérico na TD situacao (data-bs-original-title)', () => {
    const linha = interpretarHtmlTabela(HTML_BYPASS_COM_IMG_GENERICO)[0];
    expect(linha.evidenciaSituacao.icones.some((i) => (i.src ?? '').includes('bypass'))).toBe(true);
    expect(linha.evidenciaSituacao.icones.some((i) => (i.dataOriginalTitle ?? '').includes('decisão'))).toBe(
      true
    );
    expect(classificarSituacao(linha.evidenciaSituacao).situacao).toBe('VIGENTE');
  });

  it('P102 com e sem ícone → VIGENTE', () => {
    expect(
      classificarSituacao(evidencia({ dataSituacao: 'P102_NFSE_DECISAO_JUDICIAL_GERADA' })).situacao
    ).toBe('VIGENTE');
    expect(
      classificarSituacao(
        evidencia({
          dataSituacao: 'P102',
          icones: [
            {
              src: '/EmissorNacional/img/tb-nota-bypass.svg',
              alt: 'NFS-e emitida via decisão administrativa/judicial',
            },
          ],
        })
      ).situacao
    ).toBe('VIGENTE');
  });

  it('reconhece variações P102 / 102 / ZWSP', () => {
    expect(ehCodigoDecisaoJudicialPortal('P102')).toBe(true);
    expect(ehCodigoDecisaoJudicialPortal('p102_nfse_decisao')).toBe(true);
    expect(ehCodigoDecisaoJudicialPortal('P102NFSE_DECISAO')).toBe(true);
    expect(ehCodigoDecisaoJudicialPortal('102')).toBe(true);
    expect(ehCodigoDecisaoJudicialPortal('\u200BP102_NFSE')).toBe(true);
    expect(classificarSituacao(evidencia({ dataSituacao: '102' })).situacao).toBe('VIGENTE');
  });

  it('ícone bypass com data-situacao desconhecido → VIGENTE', () => {
    const r = classificarSituacao(
      evidencia({
        dataSituacao: 'P888_DESCONHECIDO',
        icones: [
          {
            src: '/EmissorNacional/img/tb-nota-bypass.svg',
            alt: 'NFS-e emitida via decisão administrativa/judicial',
            dataOriginalTitle: 'NFS-e emitida via decisão administrativa/judicial',
          },
        ],
      })
    );
    expect(r.situacao).toBe('VIGENTE');
    expect(r.codigoSituacaoDesconhecido).toBeNull();
  });

  it('texto de decisão administrativa/judicial → VIGENTE', () => {
    const ev = evidencia({ textoColuna: 'NFS-e emitida via decisão administrativa/judicial' });
    expect(evidenciaTemDecisaoAdministrativaJudicial(ev).presente).toBe(true);
    expect(classificarSituacao(ev).situacao).toBe('VIGENTE');
  });

  it('nota judicial com cancelamento comprovado → CANCELADA', () => {
    expect(
      classificarSituacao(
        evidencia({
          dataSituacao: 'P102_NFSE_DECISAO_JUDICIAL_GERADA',
          icones: [{ src: '/EmissorNacional/img/tb-cancelada.svg', title: 'NFS-e cancelada' }],
        })
      ).situacao
    ).toBe('CANCELADA');
    expect(
      classificarSituacao(
        evidencia({
          dataSituacao: CODIGO_DATA_SITUACAO_CANCELADA,
          icones: [
            {
              src: '/EmissorNacional/img/tb-nota-bypass.svg',
              alt: 'NFS-e emitida via decisão administrativa/judicial',
            },
          ],
        })
      ).situacao
    ).toBe('CANCELADA');
  });

  it('nota substituta P101 permanece VIGENTE', () => {
    expect(
      classificarSituacao(evidencia({ dataSituacao: 'P101_NFSE_SUBSTITUICAO_GERADA' })).situacao
    ).toBe('VIGENTE');
  });

  it('nota comum P100 permanece VIGENTE', () => {
    expect(classificarSituacao(evidencia({ dataSituacao: CODIGO_DATA_SITUACAO_GERADA })).situacao).toBe(
      'VIGENTE'
    );
  });

  it('código realmente desconhecido sem bypass → INDETERMINADA', () => {
    const r = classificarSituacao(evidencia({ dataSituacao: 'P999_NAO_CATALOGADO' }));
    expect(r.situacao).toBe('INDETERMINADA');
    expect(r.codigoSituacaoDesconhecido).toBe('P999_NAO_CATALOGADO');
  });

  it('sem evidência não promove a VIGENTE', () => {
    expect(classificarSituacao(evidencia({})).situacao).toBe('INDETERMINADA');
    expect(
      classificarSituacao(
        evidencia({
          icones: [{ src: '/EmissorNacional/img/icone-qualquer.svg', alt: 'ícone' }],
        })
      ).situacao
    ).toBe('INDETERMINADA');
  });

  it('DOM → classificação → inventário → meta SEFIN / exportação', () => {
    const linha = interpretarHtmlTabela(HTML_BYPASS_CRASA)[0];
    const classif = classificarSituacao(linha.evidenciaSituacao);
    expect(classif.situacao).toBe('VIGENTE');

    const doc = documentoVigenteDe(CHAVE_CRASA, classif.situacao);
    expect(entraNaRecuperacaoSefin(doc)).toBe(true);
    expect(entraNaExportacaoXmlVigentes(doc)).toBe(true);
    expect(bloqueiaProcessamentoAutomatico(doc)).toBe(false);

    const inv = montarInventario({
      id: 'inv-03k-crasa',
      cnpj: '21063590000171',
      periodoConsulta: PERIODO,
      documentos: [doc],
      completude: 'COMPLETO',
    });
    const plano = montarPlanoRecuperacao(inv);
    expect(plano).toHaveLength(1);
    expect(plano[0].chaveNacional).toBe(CHAVE_CRASA);
    expect(plano[0].resultado).toBe('PENDENTE');
  });
});
