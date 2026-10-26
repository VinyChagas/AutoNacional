/**
 * API-03J — ícone Portal tb-nota-bypass.svg (decisão adm./judicial) → VIGENTE.
 * HTML real observado no Consórcio Crasa.
 */
import { describe, expect, it } from 'vitest';
import { interpretarHtmlTabela } from '../discovery/row-parser';
import { iconesDoFragmento } from '../discovery/row-parser';
import {
  CODIGO_DATA_SITUACAO_CANCELADA,
  classificarSituacao,
  ehEvidenciaBypassDecisaoJudicial,
} from './situacao';

/** Trecho HTML real do Portal (atributos src/alt/data-original-title). */
const HTML_BYPASS_CRASA = `
<table><tbody>
  <tr data-chave="35503081221063590000171000000000023826080259038744">
    <td>1</td>
    <td class="td-situacao">
      <img
        src="/EmissorNacional/img/tb-nota-bypass.svg"
        alt="NFS-e emitida via decisão administrativa/judicial"
        data-original-title="NFS-e emitida via decisão administrativa/judicial"
      >
    </td>
    <td><a href="/EmissorNacional/Notas/Download/NFSe/35503081221063590000171000000000023826080259038744">XML</a></td>
  </tr>
</tbody></table>`;

describe('API-03J — tb-nota-bypass.svg / decisão adm.-judicial', () => {
  it('extrai src, alt e data-original-title do HTML real', () => {
    const linha = interpretarHtmlTabela(HTML_BYPASS_CRASA)[0];
    expect(linha.evidenciaSituacao.icones).toHaveLength(1);
    const icone = linha.evidenciaSituacao.icones[0];
    expect(icone.src).toBe('/EmissorNacional/img/tb-nota-bypass.svg');
    expect(icone.alt).toBe('NFS-e emitida via decisão administrativa/judicial');
    expect(icone.dataOriginalTitle).toBe('NFS-e emitida via decisão administrativa/judicial');
    expect(icone.title).toBeNull();
  });

  it('HTML real tb-nota-bypass.svg classifica como VIGENTE', () => {
    const linha = interpretarHtmlTabela(HTML_BYPASS_CRASA)[0];
    const r = classificarSituacao(linha.evidenciaSituacao);
    expect(r.situacao).toBe('VIGENTE');
    expect(r.codigoSituacaoDesconhecido).toBeNull();
    expect(r.evidenciaDeterminante).toMatch(/bypass|decis/i);
  });

  it('reconhece evidência bypass pelo src e pela descrição', () => {
    expect(ehEvidenciaBypassDecisaoJudicial('/EmissorNacional/img/tb-nota-bypass.svg')).toBe(true);
    expect(
      ehEvidenciaBypassDecisaoJudicial('NFS-e emitida via decisão administrativa/judicial')
    ).toBe(true);
    expect(ehEvidenciaBypassDecisaoJudicial('/EmissorNacional/img/tb-gerada.svg')).toBe(false);
  });

  it('ícone bypass com cancelamento comprovado → CANCELADA', () => {
    const r = classificarSituacao({
      dataSituacao: null,
      textoColuna: null,
      classeColuna: 'td-situacao',
      icones: [
        {
          src: '/EmissorNacional/img/tb-nota-bypass.svg',
          alt: 'NFS-e emitida via decisão administrativa/judicial',
          dataOriginalTitle: 'NFS-e emitida via decisão administrativa/judicial',
          title: null,
          ariaLabel: null,
        },
        {
          src: '/EmissorNacional/img/tb-cancelada.svg',
          title: 'NFS-e cancelada',
          dataOriginalTitle: null,
          alt: null,
          ariaLabel: null,
        },
      ],
    });
    expect(r.situacao).toBe('CANCELADA');
  });

  it('P104 prevalece sobre bypass', () => {
    const r = classificarSituacao({
      dataSituacao: CODIGO_DATA_SITUACAO_CANCELADA,
      textoColuna: null,
      classeColuna: 'td-situacao',
      icones: [
        {
          src: '/EmissorNacional/img/tb-nota-bypass.svg',
          alt: 'NFS-e emitida via decisão administrativa/judicial',
          dataOriginalTitle: 'NFS-e emitida via decisão administrativa/judicial',
          title: null,
          ariaLabel: null,
        },
      ],
    });
    expect(r.situacao).toBe('CANCELADA');
  });

  it('código data-situacao desconhecido + bypass → VIGENTE', () => {
    const r = classificarSituacao({
      dataSituacao: 'P999_NAO_CATALOGADO',
      textoColuna: null,
      classeColuna: 'td-situacao',
      icones: [
        {
          src: '/EmissorNacional/img/tb-nota-bypass.svg',
          alt: 'NFS-e emitida via decisão administrativa/judicial',
          dataOriginalTitle: 'NFS-e emitida via decisão administrativa/judicial',
          title: null,
          ariaLabel: null,
        },
      ],
    });
    expect(r.situacao).toBe('VIGENTE');
    expect(r.codigoSituacaoDesconhecido).toBeNull();
  });

  it('código desconhecido sem bypass permanece indeterminado', () => {
    const r = classificarSituacao({
      dataSituacao: 'P999_NAO_CATALOGADO',
      textoColuna: null,
      classeColuna: 'td-situacao',
      icones: [],
    });
    expect(r.situacao).toBe('INDETERMINADA');
    expect(r.codigoSituacaoDesconhecido).toBe('P999_NAO_CATALOGADO');
  });

  it('ícone genérico sem bypass/decisão não vira vigente', () => {
    const r = classificarSituacao({
      dataSituacao: null,
      textoColuna: null,
      classeColuna: 'td-situacao',
      icones: [
        {
          src: '/EmissorNacional/img/icone-qualquer.svg',
          alt: 'ícone',
          title: null,
          dataOriginalTitle: null,
          ariaLabel: null,
        },
      ],
    });
    expect(r.situacao).toBe('INDETERMINADA');
  });

  it('fallback: img bypass fora de td-situacao ainda é capturado', () => {
    const html = `
      <table><tbody>
        <tr>
          <td>nota</td>
          <td>
            <img
              src="/EmissorNacional/img/tb-nota-bypass.svg"
              alt="NFS-e emitida via decisão administrativa/judicial"
              data-original-title="NFS-e emitida via decisão administrativa/judicial"
            >
          </td>
        </tr>
      </tbody></table>`;
    const linha = interpretarHtmlTabela(html)[0];
    expect(linha.evidenciaSituacao.icones.some((i) => (i.src ?? '').includes('bypass'))).toBe(true);
    expect(classificarSituacao(linha.evidenciaSituacao).situacao).toBe('VIGENTE');
  });

  it('iconesDoFragmento preserva data-original-title', () => {
    const icones = iconesDoFragmento(
      `<img src="/EmissorNacional/img/tb-nota-bypass.svg" alt="NFS-e emitida via decisão administrativa/judicial" data-original-title="NFS-e emitida via decisão administrativa/judicial">`
    );
    expect(icones[0]?.dataOriginalTitle).toContain('decisão administrativa');
  });
});
