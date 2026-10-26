/**
 * API-01M — Testes offline: multi-lote, limites, SIGINT, relatório consolidado.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import * as forge from 'node-forge';
import { afterEach, describe, expect, it } from 'vitest';
import { CheckpointStoreMemoria } from './checkpoint-store';
import {
  MAX_BYTES_CNPJ_HARNESS_ADN,
  consolidarRelatorioSyncAdn,
  executarSyncControladaAdn,
  garantirArvoreHomologacaoAdn,
  lerRelatorioConsolidadoAdn,
  normalizarLimitesHarnessAdn,
  verificarEspacoHomologacaoAdn,
} from './controlled-sync-service';
import { DocumentStoreMemoriaAdn } from './document-store';
import { ErroAdn } from './errors';
import { AdnClient } from './adn-client';
import { SyncServiceAdn } from './sync-service';
import { SyncLockMemoriaAdn } from './sync-lock';
import type {
  CredencialMtls,
  DistribuicaoNsuItem,
  LimitesAdn,
  LoteDistribuicaoNsuResponse,
  TransporteHttpAdn,
} from './types';

const CNPJ = '12345678000190';
const CNPJ_B = '99888777000166';
const SENHA = 'senha-teste';

const LIMITES_TESTE: LimitesAdn = {
  timeoutMs: 5_000,
  maxBytesResposta: 4_000_000,
  maxBytesGzip: 1_500_000,
  maxBytesXml: 4_000_000,
  rateLimitMs: 0,
  maxRequests: 20,
  maxBytesArmazenamentoCnpj: 0,
};

function pfxComCnpj(cnpj: string): Buffer {
  const chaves = forge.pki.rsa.generateKeyPair(512);
  const certificado = forge.pki.createCertificate();
  certificado.publicKey = chaves.publicKey;
  certificado.serialNumber = '01';
  certificado.validity.notBefore = new Date('2020-01-01T00:00:00Z');
  certificado.validity.notAfter = new Date('2099-01-01T00:00:00Z');
  const atributos = [{ name: 'commonName', value: `Empresa:${cnpj}` }];
  certificado.setSubject(atributos);
  certificado.setIssuer(atributos);
  certificado.setExtensions([{ name: 'basicConstraints', cA: false }]);
  certificado.sign(chaves.privateKey, forge.md.sha256.create());
  const asn1 = forge.pkcs12.toPkcs12Asn1(chaves.privateKey, [certificado], SENHA);
  return Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary');
}

function credencialOk(cnpj = CNPJ): CredencialMtls {
  return { pfx: pfxComCnpj(cnpj), senha: SENHA };
}

function chave50(seed: number): string {
  return String(Math.abs(seed)).padStart(50, '0');
}

function gzipB64(xml: string): string {
  return gzipSync(Buffer.from(xml, 'utf8')).toString('base64');
}

function xmlEmitida(chave: string): string {
  return `<?xml version="1.0"?><NFSe xmlns="http://www.sped.fazenda.gov.br/nfse"><infNFSe><chNFSe>${chave}</chNFSe><emit><CNPJ>${CNPJ}</CNPJ></emit><toma><CNPJ>${CNPJ_B}</CNPJ></toma><dCompet>2026-01</dCompet></infNFSe></NFSe>`;
}

function item(nsu: number, chave: string): DistribuicaoNsuItem {
  return {
    NSU: nsu,
    TipoDocumento: 'NFSE',
    TipoEvento: null,
    ChaveAcesso: chave,
    ArquivoXml: gzipB64(xmlEmitida(chave)),
  };
}

function loteDe(startNsu: number, qtd: number, seedBase: number) {
  return Array.from({ length: qtd }, (_, i) => item(startNsu + i, chave50(seedBase + i)));
}

function mockPaginas(
  paginas: LoteDistribuicaoNsuResponse[]
): { transporte: TransporteHttpAdn; hits: () => number } {
  let hits = 0;
  return {
    hits: () => hits,
    transporte: {
      async get(url) {
        const step = paginas[Math.min(hits, paginas.length - 1)]!;
        hits += 1;
        return {
          status: 200,
          body: Buffer.from(JSON.stringify(step)),
          durationMs: 1,
          url: url.toString(),
        };
      },
    },
  };
}

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
function tmpRaiz(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'adn-ml-'));
  tmpDirs.push(d);
  return d;
}

const depsBase = (transporte: TransporteHttpAdn) => ({
  obterCredencial: async () => credencialOk(),
  criarTransporte: () => transporte,
  obterEspacoLivreBytes: () => 10 * 1024 * 1024 * 1024,
});

describe('normalizarLimitesHarnessAdn', () => {
  it('aceita faixa válida e aplica defaults', () => {
    expect(normalizarLimitesHarnessAdn({})).toEqual({
      maxRequests: 1,
      rateLimitMs: 250,
      maxBytesCnpj: MAX_BYTES_CNPJ_HARNESS_ADN,
    });
    expect(normalizarLimitesHarnessAdn({ maxRequests: 20, rateLimitMs: 300, maxBytesCnpj: 1024 }))
      .toEqual({ maxRequests: 20, rateLimitMs: 300, maxBytesCnpj: 1024 });
  });

  it('rejeita fora da faixa', () => {
    expect(() => normalizarLimitesHarnessAdn({ maxRequests: 0 })).toThrow(ErroAdn);
    expect(() => normalizarLimitesHarnessAdn({ maxRequests: 21 })).toThrow(ErroAdn);
    expect(() => normalizarLimitesHarnessAdn({ rateLimitMs: 100 })).toThrow(ErroAdn);
    expect(() => normalizarLimitesHarnessAdn({ maxBytesCnpj: MAX_BYTES_CNPJ_HARNESS_ADN + 1 })).toThrow(
      ErroAdn
    );
  });
});

describe('verificarEspacoHomologacaoAdn', () => {
  it('bloqueia quando livre < margem ou cota esgotada', () => {
    const raiz = tmpRaiz();
    const docs = path.join(raiz, 'documentos', CNPJ, 'producao');
    fs.mkdirSync(docs, { recursive: true });
    fs.writeFileSync(path.join(docs, 'a.xml'), 'x'.repeat(100));

    const poucoLivre = verificarEspacoHomologacaoAdn({
      raiz,
      documentosCnpjDir: docs,
      maxBytesCnpj: 10_000,
      obterEspacoLivreBytes: () => 1024,
      margemMinimaLivreBytes: 64 * 1024 * 1024,
    });
    expect(poucoLivre.ok).toBe(false);
    if (!poucoLivre.ok) expect(poucoLivre.codigo).toBe('ESPACO_INSUFICIENTE');

    const cota = verificarEspacoHomologacaoAdn({
      raiz,
      documentosCnpjDir: docs,
      maxBytesCnpj: 50,
      obterEspacoLivreBytes: () => 10e9,
    });
    expect(cota.ok).toBe(false);
    if (!cota.ok) expect(cota.codigo).toBe('LIMITE_ARMAZENAMENTO');
  });
});

describe('SyncServiceAdn — interrupção entre lotes', () => {
  it('conclui lote atual e não inicia nova GET após deveInterromper', async () => {
    let hits = 0;
    let liberarInterrupcao = false;
    const transporte: TransporteHttpAdn = {
      async get(url) {
        hits += 1;
        const body =
          hits === 1
            ? {
                StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS' as const,
                LoteDFe: loteDe(2, 2, 10),
              }
            : {
                StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS' as const,
                LoteDFe: loteDe(4, 2, 20),
              };
        // Após 1ª resposta, sinaliza interrupção (simula SIGINT durante persistência).
        liberarInterrupcao = true;
        return {
          status: 200,
          body: Buffer.from(JSON.stringify(body)),
          durationMs: 1,
          url: url.toString(),
        };
      },
    };

    const cp = new CheckpointStoreMemoria();
    const docs = new DocumentStoreMemoriaAdn();
    const sync = new SyncServiceAdn(
      new AdnClient(transporte, credencialOk()),
      cp,
      LIMITES_TESTE,
      docs,
      new SyncLockMemoriaAdn()
    );

    const r = await sync.syncDistribuicao({
      cnpj: CNPJ,
      ambiente: 'producao',
      forcarNsu: 1,
      resume: false,
      maxRequests: 5,
      rateLimitMs: 0,
      deveInterromper: () => liberarInterrupcao && hits >= 1,
    });

    // 1ª GET ocorre; após lote, deveInterromper impede a 2ª.
    expect(hits).toBe(1);
    expect(r.lotesProcessados).toBe(1);
    expect(r.persistencia?.persistidos).toBe(2);
    expect(r.motivoParada).toBe('interrupcao_solicitada');
    expect(r.status).toBe('PARCIAL');
    expect(cp.ler(CNPJ, 'producao')?.ultimoNsuConfirmado).toBe(3);
  });
});

describe('executarSyncControladaAdn — multi-lote e consolidação', () => {
  const base = {
    cnpj: CNPJ,
    ambiente: 'producao' as const,
    confirmLive: true,
    env: { NFSE_ALLOW_LIVE: 'true' },
  };

  it('processa até max-requests e retoma pelo checkpoint', async () => {
    const raiz = tmpRaiz();
    const pagina1 = {
      StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS' as const,
      LoteDFe: loteDe(2, 2, 100),
    };
    const pagina2 = {
      StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS' as const,
      LoteDFe: loteDe(4, 2, 200),
    };
    const fim = {
      StatusProcessamento: 'NENHUM_DOCUMENTO_LOCALIZADO' as const,
      LoteDFe: [],
    };

    const { transporte: t1, hits: h1 } = mockPaginas([pagina1, pagina2]);
    const r1 = await executarSyncControladaAdn(
      { ...base, nsu: 1, raizHomologacao: raiz, maxRequests: 1, rateLimitMs: 250 },
      depsBase(t1)
    );
    expect(r1.ok).toBe(true);
    expect(h1()).toBe(1);
    expect(r1.ultimoNsuConfirmado).toBe(3);
    expect(r1.inventarioMensalCompletoDeclarado).toBe(false);
    expect(r1.caminhoRelatorio).toBeTruthy();

    const { transporte: t2, hits: h2 } = mockPaginas([pagina2, fim]);
    const r2 = await executarSyncControladaAdn(
      { ...base, resume: true, raizHomologacao: raiz, maxRequests: 2, rateLimitMs: 250 },
      depsBase(t2)
    );
    expect(r2.ok).toBe(true);
    expect(r2.nsuInicial).toBe(3);
    expect(h2()).toBe(2);
    expect(r2.ultimoNsuConfirmado).toBe(5);
    expect(r2.fimDistribuicaoConfirmado).toBe(true);
    expect(r2.statusSync).toBe('COMPLETO');

    const relPath = r2.caminhoRelatorio!;
    const rel = lerRelatorioConsolidadoAdn(relPath)!;
    expect(rel.totais.execucoes).toBe(2);
    expect(rel.totais.requests).toBe(1 + 2);
    expect(rel.inventarioMensalCompletoDeclarado).toBe(false);
    expect(JSON.stringify(rel)).not.toMatch(/ArquivoXml|<NFSe/);
  });

  it('multi-lote em uma execução (maxRequests=2)', async () => {
    const raiz = tmpRaiz();
    const { transporte, hits } = mockPaginas([
      { StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS', LoteDFe: loteDe(2, 2, 1) },
      { StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS', LoteDFe: loteDe(4, 2, 50) },
      { StatusProcessamento: 'NENHUM_DOCUMENTO_LOCALIZADO', LoteDFe: [] },
    ]);
    const r = await executarSyncControladaAdn(
      { ...base, nsu: 1, raizHomologacao: raiz, maxRequests: 2, rateLimitMs: 250 },
      depsBase(transporte)
    );
    expect(hits()).toBe(2);
    expect(r.requests).toBe(2);
    expect(r.persistencia?.persistidos).toBe(4);
    expect(r.motivoParada).toBe('limite_max_requests');
    expect(r.statusSync).toBe('PARCIAL');
    expect(r.ultimoNsuConfirmado).toBe(5);
  });

  it('propaga interrupção do harness sem nova GET', async () => {
    const raiz = tmpRaiz();
    let hits = 0;
    let stop = false;
    const transporte: TransporteHttpAdn = {
      async get(url) {
        hits += 1;
        stop = true;
        return {
          status: 200,
          body: Buffer.from(
            JSON.stringify({
              StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS',
              LoteDFe: loteDe(2, 1, 9),
            })
          ),
          durationMs: 1,
          url: url.toString(),
        };
      },
    };
    const r = await executarSyncControladaAdn(
      {
        ...base,
        nsu: 1,
        raizHomologacao: raiz,
        maxRequests: 5,
        rateLimitMs: 250,
        deveInterromper: () => stop,
      },
      depsBase(transporte)
    );
    expect(hits).toBe(1);
    expect(r.interrompido).toBe(true);
    expect(r.motivoParada).toBe('interrupcao_solicitada');
    expect(r.persistencia?.persistidos).toBe(1);
  });

  it('bloqueia por espaço insuficiente antes de chamar ADN', async () => {
    const raiz = tmpRaiz();
    let hits = 0;
    const r = await executarSyncControladaAdn(
      { ...base, nsu: 1, raizHomologacao: raiz, maxRequests: 1 },
      {
        obterCredencial: async () => credencialOk(),
        criarTransporte: () => ({
          async get() {
            hits += 1;
            throw new Error('não deveria');
          },
        }),
        obterEspacoLivreBytes: () => 100,
      }
    );
    expect(r.ok).toBe(false);
    expect(r.codigoErro).toBe('ESPACO_INSUFICIENTE');
    expect(hits).toBe(0);
  });

  it('rejeita max-requests > 20 no harness', async () => {
    const r = await executarSyncControladaAdn(
      {
        ...base,
        nsu: 1,
        raizHomologacao: tmpRaiz(),
        maxRequests: 99,
      },
      depsBase({
        async get() {
          throw new Error('no');
        },
      })
    );
    expect(r.ok).toBe(false);
    expect(r.codigoErro).toBe('LIMITE_INVALIDO');
  });
});

describe('consolidarRelatorioSyncAdn', () => {
  it('acumula execuções sem dados sensíveis', () => {
    const raiz = tmpRaiz();
    const arvore = garantirArvoreHomologacaoAdn(raiz);
    const baseResumo = {
      ok: true,
      codigoErro: null,
      motivo: null,
      cnpj: CNPJ,
      ambiente: 'producao' as const,
      nsuInicial: 1,
      ultimoNsuProcessado: 5,
      requests: 1,
      lotesProcessados: 1,
      statusSync: 'PARCIAL',
      fimDistribuicaoConfirmado: false,
      inventarioMensalCompletoDeclarado: false as const,
      contagens: {
        emitidas: 1,
        recebidas: 0,
        intermediadas: 0,
        eventos: 0,
        naoClassificados: 0,
      },
      persistencia: {
        persistidos: 1,
        duplicadosPersistencia: 0,
        semXml: 0,
        xmlsInvalidosPersistidos: 0,
        bytesEstimados: 10,
      },
      xmlsInvalidos: 0,
      duplicidades: 0,
      checkpointGravado: true,
      ultimoNsuConfirmado: 5,
      raizHomologacao: raiz,
      motivoParada: 'limite_max_requests',
      maxRequests: 1,
      rateLimitMs: 250,
      maxBytesCnpj: MAX_BYTES_CNPJ_HARNESS_ADN,
      caminhoRelatorio: null,
      interrompido: false,
    };
    consolidarRelatorioSyncAdn({ relatoriosDir: arvore.relatorios, resumo: baseResumo });
    consolidarRelatorioSyncAdn({
      relatoriosDir: arvore.relatorios,
      resumo: { ...baseResumo, nsuInicial: 5, ultimoNsuProcessado: 10, ultimoNsuConfirmado: 10 },
    });
    const rel = lerRelatorioConsolidadoAdn(
      path.join(arvore.relatorios, `${CNPJ}-producao.json`)
    )!;
    expect(rel.totais.execucoes).toBe(2);
    expect(rel.totais.persistidos).toBe(2);
    expect(rel.inventarioMensalCompletoDeclarado).toBe(false);
  });
});
