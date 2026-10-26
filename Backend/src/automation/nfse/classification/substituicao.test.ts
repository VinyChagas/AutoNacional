import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { criarDocumentoFiscal } from '../contracts/documento-fiscal';
import { montarInventario } from '../contracts/inventario';
import { criarPeriodoConsultaPortal } from '../contracts/periodo';
import { entraNaRecuperacaoSefin, entraNaExportacaoXmlVigentes } from '../contracts/documento-fiscal';
import {
  CODIGO_DATA_SITUACAO_SUBSTITUIDA,
  PREFIXO_DATA_SITUACAO_SUBSTITUICAO_GERADA,
  classificarSituacao,
  ehCodigoSubstituicaoGeradaPortal,
} from './situacao';
import {
  ajustarInventarioPorSubstituicoes,
  chavesOriginaisSubstituidas,
  coletarVinculosSubstituicao,
  lerSubstituicaoDoXmlNfse,
} from './substituicao';

const FIXTURES = join(__dirname, 'fixtures');
const CNPJ = '09639636000152';
const PERIODO = criarPeriodoConsultaPortal('01/07/2026', '31/07/2026');
const CHAVE_29 = '41069022209639636000152000000000002926087421434928';
const CHAVE_30 = '41069022209639636000152000000000003026087880022344';

function xmlFixture(nome: string): string {
  return readFileSync(join(FIXTURES, nome), 'utf8');
}

function doc(
  chave: string,
  situacao: 'VIGENTE' | 'CANCELADA' | 'INDETERMINADA',
  extras: { origem?: 'PORTAL' | 'XML' } = {}
) {
  return criarDocumentoFiscal({
    chaveNacional: chave,
    cnpj: CNPJ,
    direcao: 'EMITIDA',
    situacao,
    periodoConsulta: PERIODO,
    origemClassificacao: extras.origem ?? 'PORTAL',
    evidencias: [{ origem: extras.origem ?? 'PORTAL', descricao: `sit=${situacao}` }],
  });
}

describe('API-03D classificação Portal — substituição', () => {
  it('P101* (Substituição Gerada) é vigente, não indeterminada', () => {
    expect(ehCodigoSubstituicaoGeradaPortal('P101')).toBe(true);
    expect(ehCodigoSubstituicaoGeradaPortal('P101_SUBSTITUICAO_GERADA')).toBe(true);
    expect(ehCodigoSubstituicaoGeradaPortal('P100_GERADA')).toBe(false);

    const r = classificarSituacao({
      dataSituacao: `${PREFIXO_DATA_SITUACAO_SUBSTITUICAO_GERADA}_SUBSTITUICAO_GERADA`,
      textoColuna: null,
      classeColuna: 'td-situacao',
      icones: [],
    });
    expect(r.situacao).toBe('VIGENTE');
    expect(r.codigoSituacaoDesconhecido).toBeNull();
  });

  it('ícone/texto NFS-e Substituída classifica original como cancelada', () => {
    const r = classificarSituacao({
      dataSituacao: null,
      textoColuna: null,
      classeColuna: 'td-situacao',
      icones: [
        {
          src: '/EmissorNacional/img/tb-substituida.svg',
          title: 'NFS-e Substituída',
          dataOriginalTitle: null,
          alt: null,
          ariaLabel: null,
        },
      ],
    });
    expect(r.situacao).toBe('CANCELADA');
  });

  it('texto Substituição Gerada classifica substituta como vigente', () => {
    const r = classificarSituacao({
      dataSituacao: null,
      textoColuna: 'NFS-e de Substituição Gerada',
      classeColuna: 'td-situacao',
      icones: [],
    });
    expect(r.situacao).toBe('VIGENTE');
  });

  it('código desconhecido continua indeterminado', () => {
    const r = classificarSituacao({
      dataSituacao: 'P999_DESCONHECIDO',
      textoColuna: null,
      classeColuna: 'td-situacao',
      icones: [],
    });
    expect(r.situacao).toBe('INDETERMINADA');
  });

  it('P105_NFSE_SUBSTITUIDA (observado AMIL) = original cancelada, não indeterminada', () => {
    const r = classificarSituacao({
      dataSituacao: CODIGO_DATA_SITUACAO_SUBSTITUIDA,
      textoColuna: null,
      classeColuna: 'td-situacao',
      icones: [],
    });
    expect(r.situacao).toBe('CANCELADA');
    expect(r.codigoSituacaoDesconhecido).toBeNull();
    expect(r.evidenciaDeterminante).toBe(`data-situacao=${CODIGO_DATA_SITUACAO_SUBSTITUIDA}`);
  });
});

describe('API-03D XML — fixtures AMIL sanitizadas', () => {
  const xml29 = xmlFixture('nfse-29-original-substituida.sanitized.xml');
  const xml30 = xmlFixture('nfse-30-substituta-vigente.sanitized.xml');

  it('original substituída: cStat 100, sem subst, competência ≠ emissão', () => {
    const l = lerSubstituicaoDoXmlNfse(xml29);
    expect(l.chaveNacional).toBe(CHAVE_29);
    expect(l.cStat).toBe('100');
    expect(l.nNFSe).toBe('29');
    expect(l.dCompet).toBe('2026-07-15');
    expect(l.vinculo).toBeNull();
    // Emissão no XML (dhEmi/dhProc) é agosto; competência julho — não confundir.
    expect(xml29).toMatch(/dhProc>2026-08-05/);
    expect(l.dCompet?.startsWith('2026-07')).toBe(true);
  });

  it('substituta vigente: cStat 101 + chSubstda = chave 29', () => {
    const l = lerSubstituicaoDoXmlNfse(xml30);
    expect(l.chaveNacional).toBe(CHAVE_30);
    expect(l.cStat).toBe('101');
    expect(l.nNFSe).toBe('30');
    expect(l.vinculo?.chaveOriginalSubstituida).toBe(CHAVE_29);
    expect(l.vinculo?.chaveSubstituta).toBe(CHAVE_30);
    expect(l.vinculo?.cMotivo).toBe('99');
  });

  it('cStat sozinho não prova cancelamento da original', () => {
    // Original continua cStat 100 no snapshot; o vínculo vem da substituta.
    expect(lerSubstituicaoDoXmlNfse(xml29).cStat).toBe('100');
    expect(lerSubstituicaoDoXmlNfse(xml30).vinculo?.chaveOriginalSubstituida).toBe(CHAVE_29);
  });
});

describe('API-03D reconciliação por vínculo', () => {
  const xml29 = xmlFixture('nfse-29-original-substituida.sanitized.xml');
  const xml30 = xmlFixture('nfse-30-substituta-vigente.sanitized.xml');

  it('original sai da meta vigente; substituta permanece', () => {
    const inv = montarInventario({
      id: 't-sub',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      completude: 'COMPLETO',
      documentos: [doc(CHAVE_29, 'VIGENTE'), doc(CHAVE_30, 'VIGENTE')],
    });
    expect(inv.totais.vigentes).toBe(2);

    const ajustado = ajustarInventarioPorSubstituicoes(
      inv,
      coletarVinculosSubstituicao([xml29, xml30])
    );
    expect(ajustado.totais.vigentes).toBe(1);
    expect(ajustado.totais.canceladas).toBe(1);
    expect(ajustado.totais.indeterminadas).toBe(0);

    const original = ajustado.documentos.find((d) => d.chaveNacional === CHAVE_29)!;
    const substituta = ajustado.documentos.find((d) => d.chaveNacional === CHAVE_30)!;
    expect(original.situacao).toBe('CANCELADA');
    expect(substituta.situacao).toBe('VIGENTE');
    expect(entraNaRecuperacaoSefin(original)).toBe(false);
    expect(entraNaExportacaoXmlVigentes(original)).toBe(false);
    expect(entraNaRecuperacaoSefin(substituta)).toBe(true);
    expect(entraNaExportacaoXmlVigentes(substituta)).toBe(true);
    expect(original.evidencias.some((e) => e.descricao.includes(CHAVE_30))).toBe(true);
  });

  it('cadeia de múltiplas substituições: só a ponta vigente', () => {
    const a = '1'.repeat(50);
    const b = '2'.repeat(50);
    const c = '3'.repeat(50);
    const vinculos = [
      {
        chaveSubstituta: b,
        chaveOriginalSubstituida: a,
        cStatSubstituta: '101',
        cMotivo: '99',
        xMotivo: 'ajuste',
      },
      {
        chaveSubstituta: c,
        chaveOriginalSubstituida: b,
        cStatSubstituta: '101',
        cMotivo: '99',
        xMotivo: 'novo ajuste',
      },
    ];
    expect([...chavesOriginaisSubstituidas(vinculos)].sort()).toEqual([a, b].sort());

    const inv = montarInventario({
      id: 'cadeia',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      completude: 'COMPLETO',
      documentos: [doc(a, 'VIGENTE'), doc(b, 'VIGENTE'), doc(c, 'VIGENTE')],
    });
    const ajustado = ajustarInventarioPorSubstituicoes(inv, vinculos);
    expect(ajustado.totais.vigentes).toBe(1);
    expect(ajustado.totais.canceladas).toBe(2);
    expect(ajustado.documentos.find((d) => d.chaveNacional === c)?.situacao).toBe('VIGENTE');
  });

  it('cancelada sem substituição permanece cancelada', () => {
    const inv = montarInventario({
      id: 'canc',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      completude: 'COMPLETO',
      documentos: [doc(CHAVE_29, 'CANCELADA')],
    });
    const ajustado = ajustarInventarioPorSubstituicoes(inv, []);
    expect(ajustado.totais.canceladas).toBe(1);
    expect(ajustado.totais.vigentes).toBe(0);
  });

  it('situação desconhecida / sem eventos fiscais no XML não inventa vínculo', () => {
    const xmlSemSubst = `<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse"><infNFSe Id="NFS${CHAVE_29}"><cStat>100</cStat><nNFSe>29</nNFSe></infNFSe></NFSe>`;
    expect(lerSubstituicaoDoXmlNfse(xmlSemSubst).vinculo).toBeNull();
    expect(coletarVinculosSubstituicao([xmlSemSubst])).toHaveLength(0);
  });

  it('ausência de eventos no inventário: indeterminada não vira vigente por cStat', () => {
    const inv = montarInventario({
      id: 'ind',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      completude: 'COMPLETO',
      documentos: [doc(CHAVE_30, 'INDETERMINADA')],
    });
    // Sem XML de vínculo apontando OUTRA chave como original, a 30 indeterminada permanece.
    const ajustado = ajustarInventarioPorSubstituicoes(inv, coletarVinculosSubstituicao([xml30]));
    expect(ajustado.documentos[0].situacao).toBe('INDETERMINADA');
  });
});
