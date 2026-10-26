/**
 * API-03J — CTS: VALIDACAO_INSUFICIENTE por CNPJ tomador ausente.
 * Evidência de checkpoint: RECEBIDA + "CNPJ tomador ausente".
 * Se o XML traz só CPF no tomador, o vínculo com empresa CNPJ é permanente.
 */
import { describe, expect, it } from 'vitest';
import { ErroRecuperacaoSefin } from './types';
import { validarXmlNfse } from './xml-validator';

const CNPJ_CTS = '02617375000120';
const CHAVE_029 = '41069022254312984000175000000000002926083755758130';
const CHAVE_030 = '41069022254312984000175000000000003026089157071210';

function xmlRecebida(opcoes: {
  chave: string;
  tomadorCnpj?: string | null;
  tomadorCpf?: string | null;
  emitente?: string;
}): string {
  const toma =
    opcoes.tomadorCnpj != null
      ? `<toma><CNPJ>${opcoes.tomadorCnpj}</CNPJ><xNome>TOMADOR</xNome></toma>`
      : opcoes.tomadorCpf != null
        ? `<toma><CPF>${opcoes.tomadorCpf}</CPF><xNome>TOMADOR PF</xNome></toma>`
        : `<toma><xNome>SEM DOCUMENTO</xNome></toma>`;
  return `<?xml version="1.0" encoding="utf-8"?>
<NFSe versao="1.01" xmlns="http://www.sped.fazenda.gov.br/nfse">
  <infNFSe Id="NFS${opcoes.chave}">
    <cStat>100</cStat>
    <emit><CNPJ>${opcoes.emitente ?? '54312984000175'}</CNPJ></emit>
    <DPS versao="1.01" xmlns="http://www.sped.fazenda.gov.br/nfse">
      <infDPS>
        <dCompet>2026-08-15</dCompet>
        <prest><CNPJ>${opcoes.emitente ?? '54312984000175'}</CNPJ></prest>
        ${toma}
      </infDPS>
    </DPS>
  </infNFSe>
</NFSe>`;
}

describe('API-03J — CTS tomador CPF / CNPJ ausente', () => {
  it('XML RECEBIDA com CNPJ tomador = CTS → CONFIRMADA', () => {
    const leitura = validarXmlNfse(xmlRecebida({ chave: CHAVE_029, tomadorCnpj: CNPJ_CTS }), {
      chave: CHAVE_029,
      cnpj: CNPJ_CTS,
      direcao: 'RECEBIDA',
    });
    expect(leitura.validacao).toBe('CONFIRMADA');
    expect(leitura.cnpjTomador).toBe(CNPJ_CTS);
    expect(leitura.papelConfirmado).toBe('TOMADOR');
  });

  it('XML RECEBIDA só com CPF no tomador → TOMADOR_CPF_SEM_CNPJ permanente', () => {
    expect(() =>
      validarXmlNfse(xmlRecebida({ chave: CHAVE_030, tomadorCpf: '12345678901' }), {
        chave: CHAVE_030,
        cnpj: CNPJ_CTS,
        direcao: 'RECEBIDA',
      })
    ).toThrow(ErroRecuperacaoSefin);
    try {
      validarXmlNfse(xmlRecebida({ chave: CHAVE_030, tomadorCpf: '12345678901' }), {
        chave: CHAVE_030,
        cnpj: CNPJ_CTS,
        direcao: 'RECEBIDA',
      });
    } catch (erro) {
      expect(erro).toMatchObject({
        codigo: 'TOMADOR_CPF_SEM_CNPJ',
        classe: 'PERMANENTE',
      });
    }
  });

  it('XML RECEBIDA sem CNPJ/CPF no tomador → VALIDACAO PENDENTE (insuficiente)', () => {
    const leitura = validarXmlNfse(xmlRecebida({ chave: CHAVE_029, tomadorCnpj: null, tomadorCpf: null }), {
      chave: CHAVE_029,
      cnpj: CNPJ_CTS,
      direcao: 'RECEBIDA',
    });
    expect(leitura.validacao).toBe('PENDENTE');
    expect(leitura.cnpjTomador).toBeNull();
    expect(leitura.cpfTomador).toBeNull();
  });

  it('não confirma RECEBIDA quando tomador CNPJ é de outra empresa', () => {
    expect(() =>
      validarXmlNfse(xmlRecebida({ chave: CHAVE_029, tomadorCnpj: '11222333000181' }), {
        chave: CHAVE_029,
        cnpj: CNPJ_CTS,
        direcao: 'RECEBIDA',
      })
    ).toThrow(/tomador/i);
  });
});
