/**
 * API-02T — chave nacional via infNFSe/@Id (NFS + 50 dígitos) quando <chNFSe> ausente.
 * Usa os 7 XMLs ADN já armazenados da empresa 274 / 09/2026 (somente leitura).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ErroRecuperacaoSefin } from './types';
import { extrairChaveDoIdInfNfse, validarXmlNfse } from './xml-validator';

const CNPJ_274 = '19903461000100';
const ADN_EMITIDAS_09_2026 = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'AutoNacional',
  'adn-homologacao',
  'documentos',
  CNPJ_274,
  'producao',
  '2026',
  '09',
  'Emitidas'
);

const CHAVES_DESCOBERTAS_02R = [
  '41069022219903461000100000000000036826093082238252',
  '41069022219903461000100000000000036926099106236079',
  '41069022219903461000100000000000037026091887176176',
  '41069022219903461000100000000000037126094616474560',
  '41069022219903461000100000000000037226096748535949',
  '41069022219903461000100000000000037326094533875190',
  '41069022219903461000100000000000037426091847913522',
] as const;

function carregarXmlsAdn(): { chave: string; xml: string }[] {
  if (!fs.existsSync(ADN_EMITIDAS_09_2026)) {
    throw new Error(`Diretório ADN ausente (somente leitura): ${ADN_EMITIDAS_09_2026}`);
  }
  return CHAVES_DESCOBERTAS_02R.map((chave) => {
    const arquivo = path.join(ADN_EMITIDAS_09_2026, `${chave}.xml`);
    if (!fs.existsSync(arquivo)) {
      throw new Error(`XML ADN ausente: ${arquivo}`);
    }
    return { chave, xml: fs.readFileSync(arquivo, 'utf8') };
  });
}

function envelopeMinimo(corpoInf: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse">
  <infNFSe${corpoInf}
</NFSe>`;
}

describe('API-02T xml-validator — Id NFS + 50 dígitos', () => {
  const notas = carregarXmlsAdn();

  it('extrai a chave dos 7 XMLs ADN via Id (sem <chNFSe>)', () => {
    for (const { chave, xml } of notas) {
      expect(xml).not.toMatch(/<chNFSe>/);
      expect(xml).toContain(`Id="NFS${chave}"`);
      const lido = extrairChaveDoIdInfNfse(`infNFSe Id="NFS${chave}"`);
      expect(lido).toEqual({ ok: true, chave });
    }
  });

  it('as 7 chaves ADN correspondem às descobertas no Portal (02R)', () => {
    const doDisco = notas.map((n) => n.chave).sort();
    expect(doDisco).toEqual([...CHAVES_DESCOBERTAS_02R].sort());
  });

  it('os 7 XMLs passam na validação completa (CONFIRMADA) e ficam elegíveis à persistência', () => {
    for (const { chave, xml } of notas) {
      const leitura = validarXmlNfse(xml, { chave, cnpj: CNPJ_274, direcao: 'EMITIDA' });
      expect(leitura.validacao).toBe('CONFIRMADA');
      expect(leitura.chaveXml).toBe(chave);
      expect(leitura.cnpjEmitente).toBe(CNPJ_274);
      expect(leitura.dCompet).toMatch(/^\d{4}-\d{2}/);
      expect(leitura.namespace).toBe('http://www.sped.fazenda.gov.br/nfse');
    }
  });

  it('rejeita chave divergente (Id válido ≠ chave consultada)', () => {
    const { xml } = notas[0]!;
    const outra = CHAVES_DESCOBERTAS_02R[1]!;
    expect(() => validarXmlNfse(xml, { chave: outra, cnpj: CNPJ_274, direcao: 'EMITIDA' })).toThrow(
      ErroRecuperacaoSefin
    );
    try {
      validarXmlNfse(xml, { chave: outra, cnpj: CNPJ_274, direcao: 'EMITIDA' });
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroRecuperacaoSefin);
      expect((erro as ErroRecuperacaoSefin).codigo).toBe('CHAVE_DIVERGENTE');
    }
  });

  it('rejeita Id inválido (prefixo ou comprimento incorreto)', () => {
    const chave = CHAVES_DESCOBERTAS_02R[0]!;
    const casos = [
      ` Id="NFS${chave.slice(0, 49)}">`,
      ` Id="XYZ${chave}">`,
      ` Id="NFS">`,
      ` Id="">`,
      ` Id="NFS${chave}X">`,
    ];
    for (const attrs of casos) {
      const xml = envelopeMinimo(`${attrs}
    <dCompet>2026-09-01</dCompet>
    <emit><CNPJ>${CNPJ_274}</CNPJ></emit>
    <toma><CNPJ>24012407000105</CNPJ></toma>
  </infNFSe>`);
      expect(() => validarXmlNfse(xml, { chave, cnpj: CNPJ_274, direcao: 'EMITIDA' })).toThrow(
        ErroRecuperacaoSefin
      );
      try {
        validarXmlNfse(xml, { chave, cnpj: CNPJ_274, direcao: 'EMITIDA' });
      } catch (erro) {
        expect((erro as ErroRecuperacaoSefin).codigo).toBe('ID_INFNFSE_INVALIDO');
      }
    }
  });

  it('sem identificação de chave (sem Id e sem chNFSe) permanece PENDENTE', () => {
    const chave = CHAVES_DESCOBERTAS_02R[0]!;
    const xml = envelopeMinimo(`>
    <dCompet>2026-09-01</dCompet>
    <emit><CNPJ>${CNPJ_274}</CNPJ></emit>
    <toma><CNPJ>24012407000105</CNPJ></toma>
  </infNFSe>`);
    const leitura = validarXmlNfse(xml, { chave, cnpj: CNPJ_274, direcao: 'EMITIDA' });
    expect(leitura.validacao).toBe('PENDENTE');
    expect(leitura.chaveXml).toBeNull();
  });

  it('compatibilidade: <chNFSe> continua preferencial sobre Id', () => {
    const chaveCh = CHAVES_DESCOBERTAS_02R[0]!;
    const chaveId = CHAVES_DESCOBERTAS_02R[1]!;
    const xml = envelopeMinimo(` Id="NFS${chaveId}">
    <chNFSe>${chaveCh}</chNFSe>
    <dCompet>2026-09-01</dCompet>
    <emit><CNPJ>${CNPJ_274}</CNPJ></emit>
    <toma><CNPJ>24012407000105</CNPJ></toma>
  </infNFSe>`);
    const ok = validarXmlNfse(xml, { chave: chaveCh, cnpj: CNPJ_274, direcao: 'EMITIDA' });
    expect(ok.validacao).toBe('CONFIRMADA');
    expect(ok.chaveXml).toBe(chaveCh);

    expect(() => validarXmlNfse(xml, { chave: chaveId, cnpj: CNPJ_274, direcao: 'EMITIDA' })).toThrow(
      ErroRecuperacaoSefin
    );
  });

  it('compatibilidade: só <chNFSe> (sem Id) permanece válida', () => {
    const chave = CHAVES_DESCOBERTAS_02R[0]!;
    const xml = envelopeMinimo(`>
    <chNFSe>${chave}</chNFSe>
    <dCompet>2026-09-01</dCompet>
    <emit><CNPJ>${CNPJ_274}</CNPJ></emit>
    <toma><CNPJ>24012407000105</CNPJ></toma>
  </infNFSe>`);
    const leitura = validarXmlNfse(xml, { chave, cnpj: CNPJ_274, direcao: 'EMITIDA' });
    expect(leitura.validacao).toBe('CONFIRMADA');
    expect(leitura.chaveXml).toBe(chave);
  });
});
