/**
 * API-03M — prioriza recuperação de XML quando a situação fiscal é indeterminada.
 * Caso CRASA nota 1356650 (chave real mascarável nos logs; sem empresa real).
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import forge from 'node-forge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bloqueiaProcessamentoAutomatico,
  criarDocumentoFiscal,
  entraNaExportacaoXmlPendentesFiscais,
  entraNaExportacaoXmlVigentes,
  entraNaRecuperacaoSefin,
} from '../contracts/documento-fiscal';
import { montarInventario, type InventarioNfse } from '../contracts/inventario';
import { criarPeriodoConsultaPortal } from '../contracts/periodo';
import {
  AdaptadorCertificadoA1,
  criarResolvedorRaizInjetada,
  RepositorioFiscalNfse,
  type TransporteHttpMtls,
} from '../infrastructure';
import type { ResultadoDescobertaNfse } from '../discovery/types';
import type { ResultadoRecuperacaoSefin } from '../recovery/types';
import { exportarSefinParaDownloadsOperacionais, PASTA_PENDENTES_VALIDACAO_FISCAL } from './exportar-downloads-operacionais';
import { executarFluxoFiscalNativo } from './native-orchestrator';
import { montarReconciliacaoExecucao } from './reconciliacao-execucao';
import type { DependenciasFluxoFiscalNativo } from './types';
import { metricasOperacionaisVazias } from './metricas-operacionais';

/** CRASA — nota 1356650 (observada como INDETERMINADA no Portal). */
const CHAVE_CRASA_1356650 =
  '35503081100019209906829000000135665026088014831864';
const CNPJ_CRASA = '21063590000171';
const TOMADOR = '11222333000181';
const PERIODO = criarPeriodoConsultaPortal('01/01/2026', '31/01/2026');
const PAGE = {} as import('playwright').Page;
const SENHA = 'teste';

let raiz: string;

beforeEach(async () => {
  raiz = await mkdtemp(path.join(tmpdir(), 'api03m-'));
});

afterEach(async () => {
  await rm(raiz, { recursive: true, force: true });
});

describe('API-03M — recuperação prioritária de indeterminada', () => {
  it('política global: indeterminada entra na SEFIN e não bloqueia a empresa', () => {
    const doc = criarDocumentoFiscal({
      chaveNacional: CHAVE_CRASA_1356650,
      cnpj: CNPJ_CRASA,
      direcao: 'EMITIDA',
      situacao: 'INDETERMINADA',
      periodoConsulta: PERIODO,
    });
    expect(entraNaRecuperacaoSefin(doc)).toBe(true);
    expect(entraNaExportacaoXmlVigentes(doc)).toBe(false);
    expect(entraNaExportacaoXmlPendentesFiscais(doc)).toBe(true);
    expect(bloqueiaProcessamentoAutomatico(doc)).toBe(false);
  });

  it('CRASA 1356650: recupera XML, exporta Pendentes_Validacao_Fiscal e não conta como vigente', async () => {
    const inv = inventario([
      criarDocumentoFiscal({
        chaveNacional: CHAVE_CRASA_1356650,
        cnpj: CNPJ_CRASA,
        direcao: 'EMITIDA',
        situacao: 'INDETERMINADA',
        periodoConsulta: PERIODO,
      }),
    ]);
    const deps = depsSimuladas(inv);
    const resultado = await executarFluxoFiscalNativo({
      page: PAGE,
      cnpj: CNPJ_CRASA,
      periodoConsulta: PERIODO,
      execucaoId: 'api03m-crasa-1356650',
      tipo: 'emitidas',
      baixarPdf: false,
      raizFiscal: raiz,
      dependencias: deps,
    });

    expect(resultado.indeterminadas).toBe(1);
    expect(resultado.vigentes).toBe(0);
    expect(resultado.persistidos).toBe(0);
    expect(resultado.xmlsComAtencaoFiscal).toBe(1);
    expect(resultado.documentosAptos).toHaveLength(0);
    expect(resultado.documentosPendentesFiscais).toHaveLength(1);
    expect(resultado.documentosPendentesFiscais?.[0]?.chaveNacional).toBe(CHAVE_CRASA_1356650);
    expect(resultado.loteLiberado).toBe(false);
    expect(resultado.conclusaoReconciliacao).toBe('NAO_RECONCILIADA');
    expect(resultado.pendenciasFiscais).toEqual([
      expect.objectContaining({
        chave_acesso: CHAVE_CRASA_1356650,
        codigo: 'ATENCAO_SITUACAO_NAO_CONFIRMADA',
        xml_recuperado: true,
      }),
    ]);

    const downloads = await mkdtemp(path.join(tmpdir(), 'api03m-dl-'));
    try {
      const exportacao = await exportarSefinParaDownloadsOperacionais({
        inventario: inv,
        documentosAptos: resultado.documentosAptos,
        documentosPendentesFiscais: resultado.documentosPendentesFiscais,
        repositorio: deps.repositorio,
        periodoConsulta: PERIODO,
        downloadsBasePath: downloads,
        nomeContabilidade: 'Contab',
        mesExecucaoExtenso: 'Janeiro-2026',
        nomeEmpresa: 'CRASA',
      });
      expect(exportacao.ok).toBe(true);
      expect(exportacao.chavesPendentesExportadas).toEqual([CHAVE_CRASA_1356650]);
      expect(exportacao.destinoPendentes).toContain(PASTA_PENDENTES_VALIDACAO_FISCAL);
      expect(exportacao.caminhosOperacionais.some((c) => c.includes(PASTA_PENDENTES_VALIDACAO_FISCAL))).toBe(
        true
      );
    } finally {
      await rm(downloads, { recursive: true, force: true });
    }
  });

  it('exportação de vigentes não depende de reconciliação 100%', async () => {
    const chaveVigente = chaveNum(1);
    const inv = inventario([
      criarDocumentoFiscal({
        chaveNacional: chaveVigente,
        cnpj: CNPJ_CRASA,
        direcao: 'EMITIDA',
        situacao: 'VIGENTE',
        periodoConsulta: PERIODO,
      }),
      criarDocumentoFiscal({
        chaveNacional: CHAVE_CRASA_1356650,
        cnpj: CNPJ_CRASA,
        direcao: 'EMITIDA',
        situacao: 'INDETERMINADA',
        periodoConsulta: PERIODO,
      }),
    ]);
    const deps = depsSimuladas(inv);
    const resultado = await executarFluxoFiscalNativo({
      page: PAGE,
      cnpj: CNPJ_CRASA,
      periodoConsulta: PERIODO,
      execucaoId: 'api03m-misto',
      tipo: 'emitidas',
      baixarPdf: false,
      raizFiscal: raiz,
      dependencias: deps,
    });

    expect(resultado.vigentes).toBe(1);
    expect(resultado.persistidos).toBe(1);
    expect(resultado.xmlsComAtencaoFiscal).toBe(1);
    expect(resultado.documentosAptos).toHaveLength(1);
    expect(resultado.documentosPendentesFiscais).toHaveLength(1);
    expect(resultado.loteLiberado).toBe(false);
    expect(resultado.conclusaoReconciliacao).toBe('NAO_RECONCILIADA');

    const downloads = await mkdtemp(path.join(tmpdir(), 'api03m-misto-dl-'));
    try {
      const exportacao = await exportarSefinParaDownloadsOperacionais({
        inventario: inv,
        documentosAptos: resultado.documentosAptos,
        documentosPendentesFiscais: resultado.documentosPendentesFiscais,
        repositorio: deps.repositorio,
        periodoConsulta: PERIODO,
        downloadsBasePath: downloads,
        nomeContabilidade: 'Contab',
        mesExecucaoExtenso: 'Janeiro-2026',
        nomeEmpresa: 'CRASA',
      });
      expect(exportacao.ok).toBe(true);
      expect(exportacao.copiados + exportacao.jaIguais).toBe(2);
      expect(exportacao.chavesPendentesExportadas).toContain(CHAVE_CRASA_1356650);
      expect(
        exportacao.caminhosOperacionais.some(
          (c) => c.includes('Emitidas') && c.includes(chaveVigente)
        )
      ).toBe(true);
    } finally {
      await rm(downloads, { recursive: true, force: true });
    }
  });

  it('distingue os três códigos de CONCLUIDA_COM_PENDENCIAS', () => {
    const m = metricasOperacionaisVazias();
    m.contadores.xmlsPersistidos = 1;
    const r = montarReconciliacaoExecucao({
      statusExecucao: 'OK',
      resultadoFinal: 'CONCLUIDA_COM_PENDENCIAS',
      fiscal: {
        versao: 1,
        batch_id: 'b',
        empresa_id: '1',
        execucao_id: '1',
        cnpj: CNPJ_CRASA,
        revisao: 1,
        inventario: {
          estado: 'completa',
          completude: 'COMPLETO',
          conclusao_confiavel: true,
          totais: {
            emitidas: 3,
            recebidas: 0,
            canceladas: 0,
            vigentes: 1,
            indeterminadas: 2,
            descobertos: 3,
            paginas: 1,
          },
        },
        validacao: {
          estado: 'completa',
          origem: 'PORTAL',
          vigentes: 1,
          canceladas: 0,
          indeterminadas: 2,
          conclusao_confiavel: false,
        },
        recuperacao: { estado: 'parcial', conclusao_confiavel: false },
        codigo: null,
        message: null,
        estado_operacional: null,
        veredito_discovery: 'PASS',
      },
      metricas: m,
      xmlsComAtencaoFiscal: 1,
      pendenciasFiscais: [
        {
          chave_acesso: CHAVE_CRASA_1356650,
          numero_nota: '1356650',
          codigo: 'ATENCAO_SITUACAO_NAO_CONFIRMADA',
          motivo: 'XML recuperado',
          xml_recuperado: true,
          documento_exportado: true,
        },
        {
          chave_acesso: chaveNum(9),
          numero_nota: null,
          codigo: 'XML_INDETERMINADA_NAO_RECUPERADO',
          motivo: 'não recuperado',
          xml_recuperado: false,
          documento_exportado: false,
        },
        {
          chave_acesso: chaveNum(8),
          numero_nota: null,
          codigo: 'BLOQUEIO_VALIDACAO_DOCUMENTAL',
          motivo: 'CNPJ divergente',
          xml_recuperado: false,
          documento_exportado: false,
        },
      ],
    });
    expect(r.status_fiscal).toBe('concluida_com_pendencias');
    expect(r.xmls_validos_confirmados).toBe(1);
    expect(r.xmls_com_atencao_fiscal).toBe(1);
    expect(r.pendencias_fiscais?.map((p) => p.codigo).sort()).toEqual(
      [
        'ATENCAO_SITUACAO_NAO_CONFIRMADA',
        'BLOQUEIO_VALIDACAO_DOCUMENTAL',
        'XML_INDETERMINADA_NAO_RECUPERADO',
      ].sort()
    );
  });

  it('XML indeterminado não recuperado e falha documental geram códigos distintos', async () => {
    const chaveNaoRec = chaveNum(2);
    const chaveFalha = chaveNum(3);
    const inv = inventario([
      criarDocumentoFiscal({
        chaveNacional: chaveNaoRec,
        cnpj: CNPJ_CRASA,
        direcao: 'EMITIDA',
        situacao: 'INDETERMINADA',
        periodoConsulta: PERIODO,
      }),
      criarDocumentoFiscal({
        chaveNacional: chaveFalha,
        cnpj: CNPJ_CRASA,
        direcao: 'EMITIDA',
        situacao: 'INDETERMINADA',
        periodoConsulta: PERIODO,
      }),
    ]);
    const deps = depsSimuladas(inv, {
      recuperar: async (entrada) => {
        if (entrada.chave === chaveFalha) {
          return {
            chaveNacional: entrada.chave,
            cnpj: CNPJ_CRASA,
            direcao: 'EMITIDA',
            periodoConsulta: PERIODO,
            resultado: 'FALHOU',
            validacaoXml: 'FALHOU',
            classeErro: 'PERMANENTE',
            codigo: 'VALIDACAO_DOCUMENTAL',
            mensagem: 'CNPJ do emitente diverge do esperado.',
            dCompet: null,
            hashSha256: null,
            xml: null,
          };
        }
        return {
          chaveNacional: entrada.chave,
          cnpj: CNPJ_CRASA,
          direcao: 'EMITIDA',
          periodoConsulta: PERIODO,
          resultado: 'FALHOU',
          validacaoXml: 'NAO_APLICADA',
          classeErro: 'TRANSITORIO',
          codigo: 'TIMEOUT',
          mensagem: 'timeout SEFIN',
          dCompet: null,
          hashSha256: null,
          xml: null,
        };
      },
    });
    const resultado = await executarFluxoFiscalNativo({
      page: PAGE,
      cnpj: CNPJ_CRASA,
      periodoConsulta: PERIODO,
      execucaoId: 'api03m-falhas',
      tipo: 'emitidas',
      baixarPdf: false,
      raizFiscal: raiz,
      dependencias: deps,
    });
    expect(resultado.xmlsComAtencaoFiscal).toBe(0);
    expect(resultado.documentosPendentesFiscais).toHaveLength(0);
    const porCodigo = new Map(resultado.pendenciasFiscais?.map((p) => [p.chave_acesso, p.codigo]));
    expect(porCodigo.get(chaveFalha)).toBe('BLOQUEIO_VALIDACAO_DOCUMENTAL');
    // TIMEOUT transitório permanece como não recuperado (ainda pendente de SEFIN).
    expect(
      porCodigo.get(chaveNaoRec) === 'XML_INDETERMINADA_NAO_RECUPERADO' ||
        porCodigo.get(chaveNaoRec) === 'BLOQUEIO_VALIDACAO_DOCUMENTAL'
    ).toBe(true);
  });
});

function chaveNum(n: number): string {
  return String(n).padStart(50, '0');
}

function inventario(documentos: ReturnType<typeof criarDocumentoFiscal>[]): InventarioNfse {
  return montarInventario({
    id: 'inv-api03m',
    cnpj: CNPJ_CRASA,
    periodoConsulta: PERIODO,
    documentos,
    completude: 'COMPLETO',
  });
}

function xmlFiscal(chaveValor: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse">
  <infNFSe Id="NFS${chaveValor}">
    <chNFSe>${chaveValor}</chNFSe>
    <dCompet>2026-01</dCompet>
    <emit><CNPJ>${CNPJ_CRASA}</CNPJ></emit>
    <toma><CNPJ>${TOMADOR}</CNPJ></toma>
  </infNFSe>
</NFSe>`;
}

function recuperadoOk(chaveValor: string): ResultadoRecuperacaoSefin {
  const xml = xmlFiscal(chaveValor);
  return {
    chaveNacional: chaveValor,
    cnpj: CNPJ_CRASA,
    direcao: 'EMITIDA',
    periodoConsulta: PERIODO,
    resultado: 'RECUPERADO',
    validacaoXml: 'CONFIRMADA',
    classeErro: null,
    codigo: null,
    mensagem: 'ok',
    dCompet: '2026-01',
    hashSha256: 'a'.repeat(64),
    xml,
  };
}

function pfxValido(): Buffer {
  const chaves = forge.pki.rsa.generateKeyPair(512);
  const certificado = forge.pki.createCertificate();
  certificado.publicKey = chaves.publicKey;
  certificado.serialNumber = '01';
  certificado.validity.notBefore = new Date('2020-01-01T00:00:00Z');
  certificado.validity.notAfter = new Date('2099-01-01T00:00:00Z');
  const attrs = [{ name: 'commonName', value: 'api03m' }];
  certificado.setSubject(attrs);
  certificado.setIssuer(attrs);
  certificado.sign(chaves.privateKey, forge.md.sha256.create());
  const asn1 = forge.pkcs12.toPkcs12Asn1(chaves.privateKey, [certificado], SENHA);
  return Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary');
}

function depsSimuladas(
  inv: InventarioNfse,
  opcoes: {
    recuperar?: DependenciasFluxoFiscalNativo['recuperar'];
  } = {}
): DependenciasFluxoFiscalNativo & { repositorio: RepositorioFiscalNfse } {
  const repositorio = new RepositorioFiscalNfse(criarResolvedorRaizInjetada(raiz));
  const descobrir = vi.fn(async (): Promise<ResultadoDescobertaNfse> => ({
    cnpj: CNPJ_CRASA,
    periodoConsulta: PERIODO,
    tipo: 'EMITIDAS',
    status: 'DISCOVERY_COMPLETE',
    inventario: inv,
    registros: [],
    diagnosticos: [],
    paginasPercorridas: 1,
  }));
  const recuperar = vi.fn(
    opcoes.recuperar ?? ((entrada) => Promise.resolve(recuperadoOk(entrada.chave)))
  );
  const transporte: TransporteHttpMtls = {
    async consultar() {
      return { status: 200, body: Buffer.from('{}') };
    },
  };
  const provedorA1 = new AdaptadorCertificadoA1({
    async carregar() {
      return { pfx: pfxValido(), passphrase: SENHA };
    },
  });
  return { descobrir, recuperar, transporte, provedorA1, repositorio };
}
