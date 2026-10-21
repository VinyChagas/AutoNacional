/**
 * API-01I — Testes offline do harness de sync controlada ADN.
 * Sem rede, sem Portal, sem SEFIN, sem Playwright, sem Iniciar.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import * as forge from 'node-forge';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ENV_ADN_HOMOLOG_ROOT,
  executarSyncControladaAdn,
  formatarResumoSyncControladaAdn,
  garantirArvoreHomologacaoAdn,
  resolverRaizHomologacaoAdn,
} from './controlled-sync-service';
import { ErroAdn } from './errors';
import { avaliarGateLiveAdn } from './live-gate';
import type {
  CredencialMtls,
  DistribuicaoNsuItem,
  LoteDistribuicaoNsuResponse,
  TransporteHttpAdn,
} from './types';

const CNPJ = '12345678000190';
const CNPJ_OUTRO = '99888777000166';
const SENHA = 'senha-teste';
const CHAVE_E = '41069022228631747000167000000000003626090719238991';

function pfxComCnpj(cnpj: string, senha = SENHA): Buffer {
  const chaves = forge.pki.rsa.generateKeyPair(512);
  const certificado = forge.pki.createCertificate();
  certificado.publicKey = chaves.publicKey;
  certificado.serialNumber = '01';
  certificado.validity.notBefore = new Date('2020-01-01T00:00:00Z');
  certificado.validity.notAfter = new Date('2099-01-01T00:00:00Z');
  const atributos = [{ name: 'commonName', value: `Empresa Teste:${cnpj}` }];
  certificado.setSubject(atributos);
  certificado.setIssuer(atributos);
  certificado.setExtensions([{ name: 'basicConstraints', cA: false }]);
  certificado.sign(chaves.privateKey, forge.md.sha256.create());
  const asn1 = forge.pkcs12.toPkcs12Asn1(chaves.privateKey, [certificado], senha);
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
  return `<?xml version="1.0"?><NFSe xmlns="http://www.sped.fazenda.gov.br/nfse"><infNFSe><chNFSe>${chave}</chNFSe><emit><CNPJ>${CNPJ}</CNPJ></emit><toma><CNPJ>${CNPJ_OUTRO}</CNPJ></toma><dCompet>2026-01</dCompet></infNFSe></NFSe>`;
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

function mockTransporte(
  sequence: Array<{ status: number; body: LoteDistribuicaoNsuResponse | string }>
): { transporte: TransporteHttpAdn; hits: () => number } {
  let hits = 0;
  return {
    hits: () => hits,
    transporte: {
      async get(url) {
        hits += 1;
        const step = sequence[Math.min(hits - 1, sequence.length - 1)]!;
        const body =
          typeof step.body === 'string'
            ? Buffer.from(step.body)
            : Buffer.from(JSON.stringify(step.body));
        return { status: step.status, body, durationMs: 5, url: url.toString() };
      },
    },
  };
}

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tmpRaiz(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adn-ctrl-'));
  tmpDirs.push(dir);
  return dir;
}

describe('autorização / gate sync controlada', () => {
  it('gate fechado sem env nem confirm', () => {
    const g = avaliarGateLiveAdn({ confirmLive: false, env: {} });
    expect(g.ok).toBe(false);
  });

  it('bloqueia sync sem gate e não chama transporte', async () => {
    let hits = 0;
    const r = await executarSyncControladaAdn(
      {
        cnpj: CNPJ,
        ambiente: 'producao',
        confirmLive: false,
        nsu: 1,
        env: {},
        raizHomologacao: tmpRaiz(),
      },
      {
        obterCredencial: async () => credencialOk(),
        criarTransporte: () => ({
          async get() {
            hits += 1;
            throw new Error('não deveria chamar');
          },
        }),
      }
    );
    expect(r.ok).toBe(false);
    expect(r.codigoErro).toBe('GATE_FECHADO');
    expect(hits).toBe(0);
  });

  it('bloqueia sem --confirm-live mesmo com NFSE_ALLOW_LIVE', async () => {
    const r = await executarSyncControladaAdn(
      {
        cnpj: CNPJ,
        ambiente: 'producao',
        confirmLive: false,
        nsu: 1,
        env: { NFSE_ALLOW_LIVE: 'true' },
        raizHomologacao: tmpRaiz(),
      },
      {
        obterCredencial: async () => credencialOk(),
        criarTransporte: () => ({
          async get() {
            throw new Error('não deveria chamar');
          },
        }),
      }
    );
    expect(r.ok).toBe(false);
    expect(r.codigoErro).toBe('CONFIRMACAO_AUSENTE');
  });

  it('bloqueia CNPJ incompatível com certificado', async () => {
    const r = await executarSyncControladaAdn(
      {
        cnpj: CNPJ_OUTRO,
        ambiente: 'producao',
        confirmLive: true,
        nsu: 1,
        env: { NFSE_ALLOW_LIVE: 'true' },
        raizHomologacao: tmpRaiz(),
      },
      {
        obterCredencial: async () => credencialOk(CNPJ),
        criarTransporte: () => ({
          async get() {
            throw new Error('não deveria chamar');
          },
        }),
      }
    );
    expect(r.ok).toBe(false);
    expect(r.codigoErro).toBe('CNPJ_INCOMPATIVEL');
  });
});

const depsEspaco = {
  obterEspacoLivreBytes: () => 10 * 1024 * 1024 * 1024,
};

describe('limites e persistência sync controlada', () => {
  const base = {
    cnpj: CNPJ,
    ambiente: 'producao' as const,
    confirmLive: true,
    env: { NFSE_ALLOW_LIVE: 'true' },
  };

  it('executa 1 request, persiste docs e grava checkpoint sob raiz isolada', async () => {
    const raiz = tmpRaiz();
    const lote = Array.from({ length: 3 }, (_, i) => item(i + 2, chave50(100 + i)));
    const { transporte, hits } = mockTransporte([
      { status: 200, body: { StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS', LoteDFe: lote } },
    ]);

    const r = await executarSyncControladaAdn(
      { ...base, nsu: 1, raizHomologacao: raiz },
      {
        obterCredencial: async () => credencialOk(),
        criarTransporte: () => transporte,
        ...depsEspaco,
      }
    );

    expect(r.ok).toBe(true);
    expect(hits()).toBe(1);
    expect(r.requests).toBe(1);
    expect(r.persistencia?.persistidos).toBe(3);
    expect(r.checkpointGravado).toBe(true);
    expect(r.ultimoNsuConfirmado).toBe(4);
    expect(r.inventarioMensalCompletoDeclarado).toBe(false);
    expect(r.raizHomologacao).toBe(path.resolve(raiz));

    const arvore = garantirArvoreHomologacaoAdn(raiz);
    expect(fs.existsSync(path.join(arvore.checkpoints, `${CNPJ}-producao.json`))).toBe(true);
    expect(fs.existsSync(path.join(arvore.documentos, CNPJ, 'producao'))).toBe(true);
    expect(fs.existsSync(arvore.relatorios)).toBe(true);
    // Lock liberado ao final.
    expect(fs.existsSync(path.join(arvore.locks, `${CNPJ}-producao.lock`))).toBe(false);
  });

  it('bloqueia segunda requisição HTTP (limite hard do harness)', async () => {
    const raiz = tmpRaiz();
    let hits = 0;
    const transporte: TransporteHttpAdn = {
      async get(url) {
        hits += 1;
        // Resposta que faria o SyncService pedir outra página — harness impede.
        const lote = Array.from({ length: 50 }, (_, i) => item(i + 2, chave50(200 + i)));
        return {
          status: 200,
          body: Buffer.from(
            JSON.stringify({
              StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS',
              LoteDFe: lote,
            })
          ),
          durationMs: 1,
          url: url.toString(),
        };
      },
    };

    const r = await executarSyncControladaAdn(
      { ...base, nsu: 1, raizHomologacao: raiz },
      {
        obterCredencial: async () => credencialOk(),
        criarTransporte: () => transporte,
        ...depsEspaco,
      }
    );

    // maxRequests=1: processa o lote e para sem segunda GET.
    expect(hits).toBe(1);
    expect(r.requests).toBe(1);
    expect(r.ok).toBe(true);
    expect(r.persistencia?.persistidos).toBe(50);
    expect(r.statusSync).toBe('PARCIAL');
  });

  it('não avança checkpoint se transporte falhar antes do lote', async () => {
    const raiz = tmpRaiz();
    const r = await executarSyncControladaAdn(
      { ...base, nsu: 1, raizHomologacao: raiz },
      {
        obterCredencial: async () => credencialOk(),
        criarTransporte: () => ({
          async get() {
            throw new ErroAdn('HANDSHAKE_TLS', 'BLOQUEANTE', 'TLS falhou');
          },
        }),
        ...depsEspaco,
      }
    );
    expect(r.ok).toBe(false);
    expect(r.codigoErro).toBe('HANDSHAKE_TLS');
    expect(r.checkpointGravado).toBe(false);
    const cp = path.join(raiz, 'checkpoints', `${CNPJ}-producao.json`);
    expect(fs.existsSync(cp)).toBe(false);
  });

  it('retoma a partir do checkpoint na segunda execução', async () => {
    const raiz = tmpRaiz();
    const lote1 = [item(2, chave50(1))];
    const { transporte: t1 } = mockTransporte([
      { status: 200, body: { StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS', LoteDFe: lote1 } },
    ]);
    const r1 = await executarSyncControladaAdn(
      { ...base, nsu: 1, raizHomologacao: raiz },
      { obterCredencial: async () => credencialOk(), criarTransporte: () => t1, ...depsEspaco }
    );
    expect(r1.ultimoNsuConfirmado).toBe(2);

    const lote2 = [item(3, chave50(2))];
    const { transporte: t2, hits } = mockTransporte([
      { status: 200, body: { StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS', LoteDFe: lote2 } },
    ]);
    const r2 = await executarSyncControladaAdn(
      { ...base, resume: true, raizHomologacao: raiz },
      { obterCredencial: async () => credencialOk(), criarTransporte: () => t2, ...depsEspaco }
    );
    expect(hits()).toBe(1);
    expect(r2.nsuInicial).toBe(2);
    expect(r2.persistencia?.persistidos).toBe(1);
    expect(r2.ultimoNsuConfirmado).toBe(3);
  });

  it('resumo sanitizado não vaza XML/PFX', async () => {
    const raiz = tmpRaiz();
    const { transporte } = mockTransporte([
      {
        status: 200,
        body: {
          StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS',
          LoteDFe: [item(2, CHAVE_E)],
        },
      },
    ]);
    const r = await executarSyncControladaAdn(
      { ...base, nsu: 1, raizHomologacao: raiz },
      { obterCredencial: async () => credencialOk(), criarTransporte: () => transporte, ...depsEspaco }
    );
    const texto = formatarResumoSyncControladaAdn(r);
    expect(texto).toContain('persistidos=1');
    expect(texto).not.toMatch(/ArquivoXml|BEGIN |pfx|senha|chNFSe/i);
    expect(JSON.stringify(r)).not.toMatch(/ArquivoXml|<NFSe/);
  });
});

describe('raiz homologação', () => {
  it('prioriza --raiz, depois env, depois cwd', () => {
    const a = resolverRaizHomologacaoAdn({
      raizHomologacao: '/tmp/explicit-adn',
      env: { [ENV_ADN_HOMOLOG_ROOT]: '/tmp/env-adn' },
    });
    expect(a).toBe(path.resolve('/tmp/explicit-adn'));

    const b = resolverRaizHomologacaoAdn({
      env: { [ENV_ADN_HOMOLOG_ROOT]: '/tmp/env-adn' },
    });
    expect(b).toBe(path.resolve('/tmp/env-adn'));

    const cwd = tmpRaiz();
    const c = resolverRaizHomologacaoAdn({ env: {}, cwd });
    expect(c).toBe(path.join(cwd, '.adn-homologacao'));
  });
});
