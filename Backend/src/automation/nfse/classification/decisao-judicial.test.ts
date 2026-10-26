/**
 * API-03H — TStat 102 / P102_NFSE_DECISAO_JUDICIAL_GERADA → VIGENTE.
 * Leiaute nacional: 102 = NFS-e de Decisão Judicial ou Administrativa (gerada válida).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { criarDocumentoFiscal, entraNaRecuperacaoSefin } from '../contracts/documento-fiscal';
import { criarPeriodoConsultaPortal } from '../contracts/periodo';
import {
  CODIGO_DATA_SITUACAO_CANCELADA,
  PREFIXO_DATA_SITUACAO_DECISAO_JUDICIAL,
  classificarSituacao,
  ehCodigoDecisaoJudicialPortal,
} from './situacao';
import { lerSubstituicaoDoXmlNfse } from './substituicao';

const FIXTURES = join(__dirname, 'fixtures');
const CHAVE_102 = '35503081221000000000171000000000023826080259038744';
const PERIODO = criarPeriodoConsultaPortal('01/08/2026', '31/08/2026');

function evidencia(parcial: {
  dataSituacao?: string | null;
  textoColuna?: string | null;
  icones?: Array<{ src?: string | null; title?: string | null }>;
}) {
  return {
    dataSituacao: parcial.dataSituacao ?? null,
    textoColuna: parcial.textoColuna ?? null,
    classeColuna: 'td-situacao',
    icones: (parcial.icones ?? []).map((icone) => ({
      src: icone.src ?? null,
      title: icone.title ?? null,
      dataOriginalTitle: null,
      alt: null,
      ariaLabel: null,
    })),
  };
}

describe('API-03H — P102 / TStat 102 decisão judicial', () => {
  it('reconhece prefixo P102*', () => {
    expect(ehCodigoDecisaoJudicialPortal('P102')).toBe(true);
    expect(ehCodigoDecisaoJudicialPortal('P102_NFSE_DECISAO_JUDICIAL_GERADA')).toBe(true);
    expect(ehCodigoDecisaoJudicialPortal('p102-nfse-decisao-judicial-gerada')).toBe(true);
    expect(ehCodigoDecisaoJudicialPortal('P102 NFSE_DECISAO_JUDICIAL_GERADA')).toBe(true);
    expect(ehCodigoDecisaoJudicialPortal('P100_GERADA')).toBe(false);
    expect(ehCodigoDecisaoJudicialPortal('P101_SUBSTITUICAO_GERADA')).toBe(false);
  });

  it('P102_NFSE_DECISAO_JUDICIAL_GERADA é VIGENTE (regra genérica)', () => {
    const r = classificarSituacao(
      evidencia({ dataSituacao: `${PREFIXO_DATA_SITUACAO_DECISAO_JUDICIAL}_NFSE_DECISAO_JUDICIAL_GERADA` })
    );
    expect(r.situacao).toBe('VIGENTE');
    expect(r.codigoSituacaoDesconhecido).toBeNull();
    expect(r.evidenciaDeterminante).toContain('P102');
  });

  it('texto Portal "decisão administrativa/judicial" é vigente', () => {
    const r = classificarSituacao(
      evidencia({
        textoColuna: 'NFS-e emitida via decisão administrativa/judicial',
      })
    );
    expect(r.situacao).toBe('VIGENTE');
  });

  it('P102 com cancelamento comprovado na coluna → CANCELADA', () => {
    const r = classificarSituacao(
      evidencia({
        dataSituacao: 'P102_NFSE_DECISAO_JUDICIAL_GERADA',
        icones: [{ src: '/EmissorNacional/img/tb-cancelada.svg', title: 'NFS-e cancelada' }],
      })
    );
    expect(r.situacao).toBe('CANCELADA');
  });

  it('P104 após geração prevalece (cancelamento posterior)', () => {
    const r = classificarSituacao(
      evidencia({ dataSituacao: CODIGO_DATA_SITUACAO_CANCELADA })
    );
    expect(r.situacao).toBe('CANCELADA');
  });

  it('código desconhecido permanece indeterminado', () => {
    const r = classificarSituacao(evidencia({ dataSituacao: 'P999_NAO_OBSERVADO' }));
    expect(r.situacao).toBe('INDETERMINADA');
    expect(r.codigoSituacaoDesconhecido).toBe('P999_NAO_OBSERVADO');
  });

  it('fixture sanitizada: cStat 102 e dCompet alinhados; elegível SEFIN se Portal VIGENTE', () => {
    const xml = readFileSync(join(FIXTURES, 'nfse-102-decisao-judicial.sanitized.xml'), 'utf8');
    const lido = lerSubstituicaoDoXmlNfse(xml);
    expect(lido.cStat).toBe('102');
    expect(lido.dCompet).toBe('2026-08-28');
    expect(lido.chaveNacional).toBe(CHAVE_102);
    expect(lido.vinculo).toBeNull();

    const portal = classificarSituacao(
      evidencia({ dataSituacao: 'P102_NFSE_DECISAO_JUDICIAL_GERADA' })
    );
    expect(portal.situacao).toBe('VIGENTE');
    const doc = criarDocumentoFiscal({
      chaveNacional: CHAVE_102,
      cnpj: '21000000000171',
      direcao: 'EMITIDA',
      situacao: portal.situacao,
      periodoConsulta: PERIODO,
      origemClassificacao: 'PORTAL',
      evidencias: [{ origem: 'PORTAL', descricao: 'P102' }],
    });
    expect(entraNaRecuperacaoSefin(doc)).toBe(true);
  });
});
