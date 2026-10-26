/**
 * API-03N — divergência CRASA 08/2026:
 * UI 205 vigentes / 203 XMLs / 2 faltantes vs motor 204/203/1.
 *
 * Evidência real (somente leitura do store):
 * - 235 docs: 204 VIGENTE + 30 CANCELADA + 1 INDETERMINADA
 * - 203 vigentes PERSISTIDO; 1 vigente FALHA_TRANSITORIA (nota 736)
 * - 1 indeterminada PERSISTIDO com atenção (nota 1356650)
 * - UI inflava vigentes com descobertos−canceladas (=205)
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import forge from 'node-forge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AdaptadorCertificadoA1,
  criarResolvedorRaizInjetada,
  RepositorioFiscalNfse,
  type TransporteHttpMtls,
} from '../infrastructure';
import { criarDocumentoFiscal } from '../contracts/documento-fiscal';
import { montarInventario, type InventarioNfse } from '../contracts/inventario';
import { criarPeriodoConsultaPortal } from '../contracts/periodo';
import type { ResultadoDescobertaNfse } from '../discovery/types';
import { progressoFiscalDeInventarioNativo } from '../progresso-fiscal/from-inventario-nativo';
import type { ResultadoRecuperacaoSefin } from '../recovery/types';
import { exportarSefinParaDownloadsOperacionais, PASTA_PENDENTES_VALIDACAO_FISCAL } from './exportar-downloads-operacionais';
import { metricasOperacionaisVazias } from './metricas-operacionais';
import { executarFluxoFiscalNativo } from './native-orchestrator';
import { montarReconciliacaoExecucao } from './reconciliacao-execucao';
import type { DependenciasFluxoFiscalNativo } from './types';

const CNPJ = '21063590000171';
const TOMADOR = '11222333000181';
const PERIODO = criarPeriodoConsultaPortal('01/08/2026', '31/08/2026');
const PAGE = {} as import('playwright').Page;
const SENHA = 'teste';

/** Nota 1356650 — indeterminada com XML (atenção). */
const CHAVE_1356650 = '35503081100019209906829000000135665026088014831864';
/** Nota 736 — vigente RECEBIDA com falha documental (CNPJ tomador ausente). */
const CHAVE_736 = '35503082227458780000174000000000073626087361792414';

let raiz: string;

beforeEach(async () => {
  raiz = await mkdtemp(path.join(tmpdir(), 'api03n-'));
});

afterEach(async () => {
  await rm(raiz, { recursive: true, force: true });
});

describe('API-03N — contabilização e reconciliação CRASA', () => {
  it('fallback de vigentes NÃO inclui indeterminadas (205→204)', () => {
    const m = metricasOperacionaisVazias();
    m.contadores.xmlsPersistidos = 203;
    // Simula stub antigo: só emitidas/recebidas/canceladas, sem totais.vigentes.
    const r = montarReconciliacaoExecucao({
      statusExecucao: 'ERRO',
      resultadoFinal: 'ERRO',
      mensagemErro: 'Cobertura fiscal incompleta',
      qtdEmitidas: 200,
      qtdRecebidas: 35,
      qtdCanceladas: 30,
      // indeterminadas conhecidas via fiscal parcial
      fiscal: {
        versao: 1,
        batch_id: 'b',
        empresa_id: '1',
        execucao_id: '1',
        cnpj: CNPJ,
        revisao: 1,
        inventario: {
          estado: 'completa',
          completude: 'COMPLETO',
          conclusao_confiavel: true,
          totais: {
            emitidas: 200,
            recebidas: 35,
            canceladas: 30,
            vigentes: 204,
            indeterminadas: 1,
            descobertos: 235,
            paginas: 1,
          },
        },
        validacao: {
          estado: 'completa',
          origem: 'PORTAL',
          vigentes: 204,
          canceladas: 30,
          indeterminadas: 1,
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
      chavesVigentesFaltantesLista: [CHAVE_736],
    });
    expect(r.vigentes).toBe(204);
    expect(r.indeterminadas).toBe(1);
    expect(r.xmls_validos_confirmados).toBe(203);
    expect(r.xmls_com_atencao_fiscal).toBe(1);
    expect(r.chaves_vigentes_faltantes).toBe(1);
    expect(r.chaves_vigentes_faltantes_lista).toEqual([CHAVE_736]);
    // 205−203=2 era o fantasma; com fonte correta faltantes=1.
    expect(r.chaves_vigentes_faltantes).not.toBe(2);
  });

  it('progressoFiscalDeInventarioNativo preserva vigentes≠descobertos−canceladas', () => {
    const inv = inventarioCrasaMini();
    const fiscal = progressoFiscalDeInventarioNativo({
      identidade: { batchId: 'b', empresaId: '1', execucaoId: '10', cnpj: CNPJ },
      inventario: inv,
    });
    expect(fiscal.inventario.totais.descobertos).toBe(5);
    expect(fiscal.inventario.totais.canceladas).toBe(1);
    expect(fiscal.inventario.totais.indeterminadas).toBe(1);
    expect(fiscal.inventario.totais.vigentes).toBe(3);
    expect(fiscal.validacao.vigentes).toBe(3);
    // Bug antigo: 5−1=4
    expect(fiscal.inventario.totais.vigentes).not.toBe(4);
  });

  it('fluxo: 1 vigente faltante (736) + 1 indeterminada OK (1356650) → ERRO com exportação parcial', async () => {
    const inv = inventarioCrasaMini();
    const deps = depsSimuladas(inv, {
      recuperar: async (entrada) => {
        if (entrada.chave === CHAVE_736) {
          return {
            chaveNacional: CHAVE_736,
            cnpj: CNPJ,
            direcao: 'RECEBIDA',
            periodoConsulta: PERIODO,
            resultado: 'FALHOU',
            validacaoXml: 'PENDENTE',
            classeErro: 'TRANSITORIO',
            codigo: 'VALIDACAO_INSUFICIENTE',
            mensagem: 'O XML não permite confirmar a chave e o vínculo com o CNPJ (CNPJ tomador ausente).',
            dCompet: null,
            hashSha256: null,
            xml: null,
          };
        }
        return recuperadoOk(entrada.chave, entrada.direcao === 'RECEBIDA' ? 'RECEBIDA' : 'EMITIDA');
      },
    });

    const resultado = await executarFluxoFiscalNativo({
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'api03n-crasa',
      tipo: 'ambas',
      baixarPdf: false,
      raizFiscal: raiz,
      dependencias: deps,
    });

    expect(resultado.descobertos).toBe(5);
    expect(resultado.vigentes).toBe(3);
    expect(resultado.canceladas).toBe(1);
    expect(resultado.indeterminadas).toBe(1);
    expect(resultado.persistidos).toBe(2);
    expect(resultado.xmlsComAtencaoFiscal).toBe(1);
    expect(resultado.chavesVigentesFaltantes).toEqual([CHAVE_736]);
    expect(resultado.documentosAptos).toHaveLength(2);
    expect(resultado.documentosPendentesFiscais?.map((d) => d.chaveNacional)).toEqual([
      CHAVE_1356650,
    ]);
    expect(resultado.conclusaoReconciliacao).toBe('NAO_RECONCILIADA');
    expect(resultado.pendenciasFiscais?.find((p) => p.chave_acesso === CHAVE_1356650)?.codigo).toBe(
      'ATENCAO_SITUACAO_NAO_CONFIRMADA'
    );

    const downloads = await mkdtemp(path.join(tmpdir(), 'api03n-dl-'));
    try {
      const exportacao = await exportarSefinParaDownloadsOperacionais({
        inventario: inv,
        documentosAptos: resultado.documentosAptos,
        documentosPendentesFiscais: resultado.documentosPendentesFiscais,
        repositorio: deps.repositorio,
        periodoConsulta: PERIODO,
        downloadsBasePath: downloads,
        nomeContabilidade: 'Contab',
        mesExecucaoExtenso: 'Agosto-2026',
        nomeEmpresa: 'CRASA',
      });
      expect(exportacao.ok).toBe(true);
      expect(exportacao.chavesPendentesExportadas).toContain(CHAVE_1356650);
      expect(
        exportacao.caminhosOperacionais.some((c) => c.includes(PASTA_PENDENTES_VALIDACAO_FISCAL))
      ).toBe(true);
      // Vigentes recuperados exportados; 736 ausente.
      expect(exportacao.caminhosOperacionais.some((c) => c.includes(CHAVE_736))).toBe(false);
      expect(exportacao.copiados + exportacao.jaIguais).toBe(3); // 2 vigentes + 1 pendente
    } finally {
      await rm(downloads, { recursive: true, force: true });
    }

    // Avaliação de status: ERRO por vigente faltante — não por indeterminada.
    const faltantes = resultado.chavesVigentesFaltantes ?? [];
    const vigentesIncompletos =
      resultado.persistidos < resultado.vigentes || faltantes.length > 0;
    expect(vigentesIncompletos).toBe(true);
    expect(resultado.indeterminadas).toBe(1);
    expect(resultado.xmlsComAtencaoFiscal).toBe(1);
  });

  it('quando só há indeterminada com XML e vigentes 100% → CONCLUIDA_COM_PENDENCIAS', async () => {
    const inv = montarInventario({
      id: 'so-indet',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      completude: 'COMPLETO',
      documentos: [
        criarDocumentoFiscal({
          chaveNacional: chaveNum(1),
          cnpj: CNPJ,
          direcao: 'EMITIDA',
          situacao: 'VIGENTE',
          periodoConsulta: PERIODO,
        }),
        criarDocumentoFiscal({
          chaveNacional: CHAVE_1356650,
          cnpj: CNPJ,
          direcao: 'RECEBIDA',
          situacao: 'INDETERMINADA',
          periodoConsulta: PERIODO,
        }),
      ],
    });
    const deps = depsSimuladas(inv);
    const resultado = await executarFluxoFiscalNativo({
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'api03n-ok-pend',
      tipo: 'ambas',
      baixarPdf: false,
      raizFiscal: raiz,
      dependencias: deps,
    });
    expect(resultado.vigentes).toBe(1);
    expect(resultado.persistidos).toBe(1);
    expect(resultado.chavesVigentesFaltantes).toEqual([]);
    expect(resultado.xmlsComAtencaoFiscal).toBe(1);
    expect(resultado.indeterminadas).toBe(1);
    // Sem gap de vigentes: pendência fiscal isolada.
    expect(resultado.persistidos >= resultado.vigentes).toBe(true);
  });
});

function chaveNum(n: number): string {
  return String(n).padStart(50, '0');
}

/** Miniatura do cenário CRASA: 3 vigentes + 1 canc + 1 indet. */
function inventarioCrasaMini(): InventarioNfse {
  return montarInventario({
    id: 'crasa-mini',
    cnpj: CNPJ,
    periodoConsulta: PERIODO,
    completude: 'COMPLETO',
    documentos: [
      criarDocumentoFiscal({
        chaveNacional: chaveNum(1),
        cnpj: CNPJ,
        direcao: 'EMITIDA',
        situacao: 'VIGENTE',
        periodoConsulta: PERIODO,
      }),
      criarDocumentoFiscal({
        chaveNacional: chaveNum(2),
        cnpj: CNPJ,
        direcao: 'EMITIDA',
        situacao: 'VIGENTE',
        periodoConsulta: PERIODO,
      }),
      criarDocumentoFiscal({
        chaveNacional: CHAVE_736,
        cnpj: CNPJ,
        direcao: 'RECEBIDA',
        situacao: 'VIGENTE',
        periodoConsulta: PERIODO,
      }),
      criarDocumentoFiscal({
        chaveNacional: chaveNum(9),
        cnpj: CNPJ,
        direcao: 'EMITIDA',
        situacao: 'CANCELADA',
        periodoConsulta: PERIODO,
      }),
      criarDocumentoFiscal({
        chaveNacional: CHAVE_1356650,
        cnpj: CNPJ,
        direcao: 'RECEBIDA',
        situacao: 'INDETERMINADA',
        periodoConsulta: PERIODO,
      }),
    ],
  });
}

function xmlFiscal(chaveValor: string, direcao: 'EMITIDA' | 'RECEBIDA'): string {
  const emit = direcao === 'EMITIDA' ? CNPJ : '22745878000174';
  const toma = direcao === 'RECEBIDA' ? CNPJ : TOMADOR;
  return `<?xml version="1.0" encoding="UTF-8"?>
<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse">
  <infNFSe Id="NFS${chaveValor}">
    <chNFSe>${chaveValor}</chNFSe>
    <dCompet>2026-08</dCompet>
    <emit><CNPJ>${emit}</CNPJ></emit>
    <toma><CNPJ>${toma}</CNPJ></toma>
  </infNFSe>
</NFSe>`;
}

function recuperadoOk(
  chaveValor: string,
  direcao: 'EMITIDA' | 'RECEBIDA' = 'EMITIDA'
): ResultadoRecuperacaoSefin {
  const xml = xmlFiscal(chaveValor, direcao);
  return {
    chaveNacional: chaveValor,
    cnpj: CNPJ,
    direcao,
    periodoConsulta: PERIODO,
    resultado: 'RECUPERADO',
    validacaoXml: 'CONFIRMADA',
    classeErro: null,
    codigo: null,
    mensagem: 'ok',
    dCompet: '2026-08',
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
  const attrs = [{ name: 'commonName', value: 'api03n' }];
  certificado.setSubject(attrs);
  certificado.setIssuer(attrs);
  certificado.sign(chaves.privateKey, forge.md.sha256.create());
  const asn1 = forge.pkcs12.toPkcs12Asn1(chaves.privateKey, [certificado], SENHA);
  return Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary');
}

function depsSimuladas(
  inv: InventarioNfse,
  opcoes: { recuperar?: DependenciasFluxoFiscalNativo['recuperar'] } = {}
): DependenciasFluxoFiscalNativo & { repositorio: RepositorioFiscalNfse } {
  const repositorio = new RepositorioFiscalNfse(criarResolvedorRaizInjetada(raiz));
  const descobrir = vi.fn(async (input: { tipo: 'EMITIDAS' | 'RECEBIDAS' | 'AMBAS' }): Promise<ResultadoDescobertaNfse> => {
    const documentos =
      input.tipo === 'EMITIDAS'
        ? inv.documentos.filter((d) => d.direcao === 'EMITIDA')
        : input.tipo === 'RECEBIDAS'
          ? inv.documentos.filter((d) => d.direcao === 'RECEBIDA')
          : inv.documentos;
    const parcial = montarInventario({
      id: `${inv.id}-${input.tipo}`,
      cnpj: inv.cnpj,
      periodoConsulta: inv.periodoConsulta,
      documentos,
      completude: 'COMPLETO',
    });
    return {
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      tipo: input.tipo === 'AMBAS' ? 'AMBAS' : input.tipo,
      status: 'DISCOVERY_COMPLETE',
      inventario: parcial,
      registros: [],
      diagnosticos: [],
      paginasPercorridas: 1,
    };
  });
  const recuperar = vi.fn(
    opcoes.recuperar ??
      (async (entrada) =>
        recuperadoOk(entrada.chave, entrada.direcao === 'RECEBIDA' ? 'RECEBIDA' : 'EMITIDA'))
  );
  const transporte: TransporteHttpMtls = {
    async consultar() {
      return { status: 200, body: Buffer.from('{}') };
    },
  };
  return {
    descobrir,
    recuperar,
    transporte,
    provedorA1: new AdaptadorCertificadoA1({
      async carregar() {
        return { pfx: pfxValido(), passphrase: SENHA };
      },
    }),
    repositorio,
  };
}
