/**
 * API-03O — vínculo fiscal por intermediário (<interm>).
 * Referência: CRASA nota 736 (chave real; fixture local; sem executar empresa).
 */
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import forge from 'node-forge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AdaptadorCertificadoA1,
  criarResolvedorRaizInjetada,
  RepositorioFiscalNfse,
  type TransporteHttpMtls,
} from '../infrastructure';
import { criarDocumentoFiscal } from '../contracts/documento-fiscal';
import { montarInventario } from '../contracts/inventario';
import { criarPeriodoConsultaPortal } from '../contracts/periodo';
import type { ResultadoDescobertaNfse } from '../discovery/types';
import {
  exportarSefinParaDownloadsOperacionais,
  PASTA_INTERMEDIADAS,
} from '../orchestration/exportar-downloads-operacionais';
import { executarFluxoFiscalNativo } from '../orchestration/native-orchestrator';
import type { DependenciasFluxoFiscalNativo } from '../orchestration/types';
import { ErroRecuperacaoSefin } from './types';
import { validarXmlNfse } from './xml-validator';

const CNPJ_CRASA = '21063590000171';
const CNPJ_PRESTADOR = '27458780000174';
const CNPJ_OUTRO = '11222333000181';
const CHAVE_736 = '35503082227458780000174000000000073626087361792414';
const PERIODO = criarPeriodoConsultaPortal('01/08/2026', '31/08/2026');
const PAGE = {} as import('playwright').Page;
const SENHA = 'teste';

const FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'crasa-736-intermediario.sanitized.xml'
);

const XML_736 = readFileSync(FIXTURE, 'utf8');

function xmlBase(opcoes: {
  chave: string;
  emitente?: string;
  tomadorCnpj?: string | null;
  tomadorCpf?: string | null;
  intermediario?: string | null;
}): string {
  const toma =
    opcoes.tomadorCnpj != null
      ? `<toma><CNPJ>${opcoes.tomadorCnpj}</CNPJ></toma>`
      : opcoes.tomadorCpf != null
        ? `<toma><CPF>${opcoes.tomadorCpf}</CPF></toma>`
        : '';
  const interm =
    opcoes.intermediario != null
      ? `<interm><CNPJ>${opcoes.intermediario}</CNPJ><xNome>INTERM</xNome></interm>`
      : '';
  return `<?xml version="1.0" encoding="utf-8"?>
<NFSe versao="1.01" xmlns="http://www.sped.fazenda.gov.br/nfse">
  <infNFSe Id="NFS${opcoes.chave}">
    <chNFSe>${opcoes.chave}</chNFSe>
    <emit><CNPJ>${opcoes.emitente ?? CNPJ_PRESTADOR}</CNPJ></emit>
    <DPS versao="1.01" xmlns="http://www.sped.fazenda.gov.br/nfse">
      <infDPS>
        <dCompet>2026-08-03</dCompet>
        <prest><CNPJ>${opcoes.emitente ?? CNPJ_PRESTADOR}</CNPJ></prest>
        ${toma}
        ${interm}
      </infDPS>
    </DPS>
  </infNFSe>
</NFSe>`;
}

describe('API-03O — intermediário fiscal', () => {
  it('fixture real 736: CRASA em interm, sem toma → INTERMEDIARIO', () => {
    expect(XML_736).toContain('<interm>');
    expect(XML_736).toContain(`<CNPJ>${CNPJ_CRASA}</CNPJ>`);
    expect(XML_736).not.toMatch(/<toma[\s>]/i);

    const leitura = validarXmlNfse(XML_736, {
      chave: CHAVE_736,
      cnpj: CNPJ_CRASA,
      direcao: 'RECEBIDA',
    });
    expect(leitura.validacao).toBe('CONFIRMADA');
    expect(leitura.papelConfirmado).toBe('INTERMEDIARIO');
    expect(leitura.cnpjIntermediario).toBe(CNPJ_CRASA);
    expect(leitura.cnpjTomador).toBeNull();
    expect(leitura.chaveXml).toBe(CHAVE_736);
  });

  it('empresa prestadora (EMITIDA)', () => {
    const chave = CHAVE_736;
    const leitura = validarXmlNfse(
      xmlBase({ chave, emitente: CNPJ_CRASA, tomadorCnpj: CNPJ_OUTRO }),
      { chave, cnpj: CNPJ_CRASA, direcao: 'EMITIDA' }
    );
    expect(leitura.validacao).toBe('CONFIRMADA');
    expect(leitura.papelConfirmado).toBe('PRESTADOR');
  });

  it('empresa tomadora (RECEBIDA)', () => {
    const chave = CHAVE_736;
    const leitura = validarXmlNfse(
      xmlBase({ chave, emitente: CNPJ_PRESTADOR, tomadorCnpj: CNPJ_CRASA }),
      { chave, cnpj: CNPJ_CRASA, direcao: 'RECEBIDA' }
    );
    expect(leitura.validacao).toBe('CONFIRMADA');
    expect(leitura.papelConfirmado).toBe('TOMADOR');
    expect(leitura.cnpjIntermediario).toBeNull();
  });

  it('tomador ausente + intermediário válido → INTERMEDIARIO (não vira tomador)', () => {
    const chave = CHAVE_736;
    const leitura = validarXmlNfse(
      xmlBase({
        chave,
        emitente: CNPJ_PRESTADOR,
        tomadorCnpj: null,
        intermediario: CNPJ_CRASA,
      }),
      { chave, cnpj: CNPJ_CRASA, direcao: 'RECEBIDA' }
    );
    expect(leitura.validacao).toBe('CONFIRMADA');
    expect(leitura.papelConfirmado).toBe('INTERMEDIARIO');
    expect(leitura.cnpjTomador).toBeNull();
  });

  it('tomador de outro CNPJ + intermediário da empresa → INTERMEDIARIO', () => {
    const chave = CHAVE_736;
    const leitura = validarXmlNfse(
      xmlBase({
        chave,
        tomadorCnpj: CNPJ_OUTRO,
        intermediario: CNPJ_CRASA,
      }),
      { chave, cnpj: CNPJ_CRASA, direcao: 'RECEBIDA' }
    );
    expect(leitura.papelConfirmado).toBe('INTERMEDIARIO');
  });

  it('prioriza TOMADOR quando ambos tomador e intermediário são a empresa', () => {
    const chave = CHAVE_736;
    const leitura = validarXmlNfse(
      xmlBase({
        chave,
        tomadorCnpj: CNPJ_CRASA,
        intermediario: CNPJ_CRASA,
      }),
      { chave, cnpj: CNPJ_CRASA, direcao: 'RECEBIDA' }
    );
    expect(leitura.papelConfirmado).toBe('TOMADOR');
  });

  it('CNPJ intermediário incompatível → CNPJ_DIVERGENTE', () => {
    const chave = CHAVE_736;
    expect(() =>
      validarXmlNfse(
        xmlBase({ chave, tomadorCnpj: null, intermediario: CNPJ_OUTRO }),
        { chave, cnpj: CNPJ_CRASA, direcao: 'RECEBIDA' }
      )
    ).toThrow(ErroRecuperacaoSefin);
    try {
      validarXmlNfse(
        xmlBase({ chave, tomadorCnpj: null, intermediario: CNPJ_OUTRO }),
        { chave, cnpj: CNPJ_CRASA, direcao: 'RECEBIDA' }
      );
    } catch (erro) {
      expect(erro).toMatchObject({ codigo: 'CNPJ_DIVERGENTE' });
    }
  });

  it('XML inválido (chave divergente) permanece permanente', () => {
    expect(() =>
      validarXmlNfse(XML_736, {
        chave: '9'.repeat(50),
        cnpj: CNPJ_CRASA,
        direcao: 'RECEBIDA',
      })
    ).toThrow(ErroRecuperacaoSefin);
    try {
      validarXmlNfse(XML_736, {
        chave: '9'.repeat(50),
        cnpj: CNPJ_CRASA,
        direcao: 'RECEBIDA',
      });
    } catch (erro) {
      expect(erro).toMatchObject({ codigo: 'CHAVE_DIVERGENTE' });
    }
  });

  it('tomador CPF sem intermediário da empresa → TOMADOR_CPF_SEM_CNPJ', () => {
    const chave = CHAVE_736;
    expect(() =>
      validarXmlNfse(
        xmlBase({ chave, tomadorCpf: '12345678901', intermediario: null }),
        { chave, cnpj: CNPJ_CRASA, direcao: 'RECEBIDA' }
      )
    ).toThrow(ErroRecuperacaoSefin);
    try {
      validarXmlNfse(
        xmlBase({ chave, tomadorCpf: '12345678901', intermediario: null }),
        { chave, cnpj: CNPJ_CRASA, direcao: 'RECEBIDA' }
      );
    } catch (erro) {
      expect(erro).toMatchObject({ codigo: 'TOMADOR_CPF_SEM_CNPJ' });
    }
  });
});

describe('API-03O — recuperação/exportação intermediária', () => {
  let raiz: string;

  beforeEach(async () => {
    raiz = await mkdtemp(path.join(tmpdir(), 'api03o-'));
  });

  afterEach(async () => {
    await rm(raiz, { recursive: true, force: true });
  });

  it('fluxo nativo: nota 736 intermediária persiste, reconcilia e exporta em Intermediadas', async () => {
    const inv = montarInventario({
      id: 'inv-736',
      cnpj: CNPJ_CRASA,
      periodoConsulta: PERIODO,
      completude: 'COMPLETO',
      documentos: [
        criarDocumentoFiscal({
          chaveNacional: CHAVE_736,
          cnpj: CNPJ_CRASA,
          direcao: 'RECEBIDA',
          situacao: 'VIGENTE',
          periodoConsulta: PERIODO,
        }),
      ],
    });

    const repositorio = new RepositorioFiscalNfse(criarResolvedorRaizInjetada(raiz));
    const deps: DependenciasFluxoFiscalNativo = {
      descobrir: vi.fn(async (): Promise<ResultadoDescobertaNfse> => ({
        cnpj: CNPJ_CRASA,
        periodoConsulta: PERIODO,
        tipo: 'RECEBIDAS',
        status: 'DISCOVERY_COMPLETE',
        inventario: inv,
        registros: [],
        diagnosticos: [],
        paginasPercorridas: 1,
      })),
      recuperar: vi.fn(async () => {
        const leitura = validarXmlNfse(XML_736, {
          chave: CHAVE_736,
          cnpj: CNPJ_CRASA,
          direcao: 'RECEBIDA',
        });
        return {
          chaveNacional: CHAVE_736,
          cnpj: CNPJ_CRASA,
          direcao: 'RECEBIDA' as const,
          periodoConsulta: PERIODO,
          resultado: 'RECUPERADO' as const,
          validacaoXml: 'CONFIRMADA' as const,
          classeErro: null,
          codigo: null,
          mensagem: 'ok',
          dCompet: leitura.dCompet,
          hashSha256: 'b'.repeat(64),
          xml: XML_736,
          papelFiscal: leitura.papelConfirmado,
        };
      }),
      transporte: {
        async consultar() {
          return { status: 200, body: Buffer.from('{}') };
        },
      } satisfies TransporteHttpMtls,
      provedorA1: new AdaptadorCertificadoA1({
        async carregar() {
          return { pfx: pfxValido(), passphrase: SENHA };
        },
      }),
      repositorio,
    };

    const resultado = await executarFluxoFiscalNativo({
      page: PAGE,
      cnpj: CNPJ_CRASA,
      periodoConsulta: PERIODO,
      execucaoId: 'api03o-736',
      tipo: 'recebidas',
      baixarPdf: false,
      raizFiscal: raiz,
      dependencias: deps,
    });

    expect(resultado.vigentes).toBe(1);
    expect(resultado.persistidos).toBe(1);
    expect(resultado.chavesVigentesFaltantes).toEqual([]);
    expect(resultado.conclusaoReconciliacao).toBe('RECONCILIADA');
    expect(resultado.documentosAptos).toHaveLength(1);
    expect(resultado.documentosAptos[0]?.papelFiscal).toBe('INTERMEDIARIO');

    const downloads = await mkdtemp(path.join(tmpdir(), 'api03o-dl-'));
    try {
      const exportacao = await exportarSefinParaDownloadsOperacionais({
        inventario: inv,
        documentosAptos: resultado.documentosAptos,
        repositorio,
        periodoConsulta: PERIODO,
        downloadsBasePath: downloads,
        nomeContabilidade: 'Contab',
        mesExecucaoExtenso: 'Agosto-2026',
        nomeEmpresa: 'CRASA',
      });
      expect(exportacao.ok).toBe(true);
      expect(exportacao.chavesIntermediadasExportadas).toEqual([CHAVE_736]);
      expect(exportacao.destinoIntermediadas).toContain(PASTA_INTERMEDIADAS);
      expect(
        exportacao.caminhosOperacionais.some(
          (c) => c.includes(PASTA_INTERMEDIADAS) && c.includes(CHAVE_736)
        )
      ).toBe(true);
      expect(exportacao.caminhosOperacionais.some((c) => c.includes('/Recebidas/'))).toBe(false);
    } finally {
      await rm(downloads, { recursive: true, force: true });
    }
  });
});

function pfxValido(): Buffer {
  const chaves = forge.pki.rsa.generateKeyPair(512);
  const certificado = forge.pki.createCertificate();
  certificado.publicKey = chaves.publicKey;
  certificado.serialNumber = '01';
  certificado.validity.notBefore = new Date('2020-01-01T00:00:00Z');
  certificado.validity.notAfter = new Date('2099-01-01T00:00:00Z');
  const attrs = [{ name: 'commonName', value: 'api03o' }];
  certificado.setSubject(attrs);
  certificado.setIssuer(attrs);
  certificado.sign(chaves.privateKey, forge.md.sha256.create());
  const asn1 = forge.pkcs12.toPkcs12Asn1(chaves.privateKey, [certificado], SENHA);
  return Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary');
}
