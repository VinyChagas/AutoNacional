/**
 * API-01H — Testes offline de hardening: falha, concorrência, checkpoint atômico.
 * Sem rede, sem Portal, sem SEFIN, sem Playwright, sem Iniciar.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { AdnClient } from './adn-client';
import { processarItemDistribuicao } from './classifier';
import {
  CheckpointStoreArquivo,
  CheckpointStoreMemoria,
  commitCheckpointAposLote,
  validarCheckpointAdn,
} from './checkpoint-store';
import {
  DocumentStoreArquivoAdn,
  DocumentStoreMemoriaAdn,
  chaveDedupeDocumento,
} from './document-store';
import { ErroAdn } from './errors';
import { escreverArquivoAtomico } from './fs-atomic';
import {
  SyncLockArquivoAdn,
  SyncLockMemoriaAdn,
  gravarLockStaleParaTeste,
} from './sync-lock';
import { SyncServiceAdn } from './sync-service';
import type {
  CredencialMtls,
  DistribuicaoNsuItem,
  LimitesAdn,
  LoteDistribuicaoNsuResponse,
  TransporteHttpAdn,
} from './types';

const CNPJ = '12345678000190';
const CNPJ_B = '99888777000166';
const CHAVE_E = '41069022228631747000167000000000003626090719238991';

const LIMITES_TESTE: LimitesAdn = {
  timeoutMs: 5_000,
  maxBytesResposta: 4_000_000,
  maxBytesGzip: 1_500_000,
  maxBytesXml: 4_000_000,
  rateLimitMs: 0,
  maxRequests: 20,
  maxBytesArmazenamentoCnpj: 0,
};

function chave50(seed: number): string {
  return String(Math.abs(seed)).padStart(50, '0');
}

function gzipB64(xml: string): string {
  return gzipSync(Buffer.from(xml, 'utf8')).toString('base64');
}

function xmlEmitida(chave = CHAVE_E): string {
  return `<?xml version="1.0"?><NFSe xmlns="http://www.sped.fazenda.gov.br/nfse"><infNFSe><chNFSe>${chave}</chNFSe><emit><CNPJ>${CNPJ}</CNPJ></emit><toma><CNPJ>${CNPJ_B}</CNPJ></toma><dCompet>2026-01</dCompet></infNFSe></NFSe>`;
}

function item(
  nsu: number,
  tipo: DistribuicaoNsuItem['TipoDocumento'],
  xml: string,
  evento?: string,
  chave?: string
): DistribuicaoNsuItem {
  return {
    NSU: nsu,
    TipoDocumento: tipo,
    TipoEvento: evento ?? null,
    ChaveAcesso: chave,
    ArquivoXml: gzipB64(xml),
  };
}

function credencialDummy(): CredencialMtls {
  return { pfx: Buffer.from('dummy'), senha: 'x' };
}

function mockTransporte(
  sequence: Array<{ status: number; body: LoteDistribuicaoNsuResponse | string }>
): TransporteHttpAdn {
  let i = 0;
  return {
    async get(url) {
      const step = sequence[Math.min(i, sequence.length - 1)];
      i += 1;
      const body =
        typeof step.body === 'string'
          ? Buffer.from(step.body)
          : Buffer.from(JSON.stringify(step.body));
      return { status: step.status, body, durationMs: 1, url: url.toString() };
    },
  };
}

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tmpRaiz(prefix = 'adn-hard-'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

describe('Checkpoint atômico e validação', () => {
  it('grava atomicamente e rejeita JSON corrompido sem resetar cursor', () => {
    const dir = tmpRaiz('adn-cp-');
    const store = new CheckpointStoreArquivo(dir);
    commitCheckpointAposLote(store, {
      cnpj: CNPJ,
      ambiente: 'producao',
      cursorConfirmado: 42,
      lotesProcessados: 1,
      documentosProcessados: 10,
      nsuInicialSessao: 1,
      status: 'PARCIAL',
      fimDistribuicaoConfirmado: false,
    });

    const file = path.join(dir, `${CNPJ}-producao.json`);
    expect(fs.existsSync(file)).toBe(true);
    expect(store.ler(CNPJ, 'producao')?.ultimoNsuConfirmado).toBe(42);

    fs.writeFileSync(file, '{quebrado', 'utf8');
    expect(() => store.ler(CNPJ, 'producao')).toThrow(ErroAdn);
    try {
      store.ler(CNPJ, 'producao');
    } catch (e) {
      expect((e as ErroAdn).codigo).toBe('CHECKPOINT_CORROMPIDO');
    }
  });

  it('validarCheckpointAdn rejeita shape inválido', () => {
    expect(() => validarCheckpointAdn({ cnpj: '1' })).toThrow(ErroAdn);
    try {
      validarCheckpointAdn({ cnpj: '1' });
    } catch (e) {
      expect((e as ErroAdn).codigo).toBe('CHECKPOINT_INVALIDO');
    }
  });

  it('mantém .bak do checkpoint anterior', () => {
    const dir = tmpRaiz('adn-cpbak-');
    const store = new CheckpointStoreArquivo(dir);
    commitCheckpointAposLote(store, {
      cnpj: CNPJ,
      ambiente: 'producao',
      cursorConfirmado: 10,
      lotesProcessados: 1,
      documentosProcessados: 1,
      nsuInicialSessao: 1,
      status: 'PARCIAL',
      fimDistribuicaoConfirmado: false,
    });
    commitCheckpointAposLote(store, {
      cnpj: CNPJ,
      ambiente: 'producao',
      cursorConfirmado: 20,
      lotesProcessados: 2,
      documentosProcessados: 2,
      nsuInicialSessao: 1,
      status: 'PARCIAL',
      fimDistribuicaoConfirmado: false,
    });
    const bak = path.join(dir, `${CNPJ}-producao.json.bak`);
    expect(fs.existsSync(bak)).toBe(true);
    const prev = JSON.parse(fs.readFileSync(bak, 'utf8'));
    expect(prev.ultimoNsuConfirmado).toBe(10);
  });
});

describe('Lock exclusivo CNPJ+ambiente', () => {
  it('bloqueia segunda sync concorrente (memória)', async () => {
    const lock = new SyncLockMemoriaAdn();
    const liberar = await lock.adquirir(CNPJ, 'producao');
    await expect(lock.adquirir(CNPJ, 'producao')).rejects.toMatchObject({
      codigo: 'SYNC_EM_ANDAMENTO',
    });
    liberar();
    const liberar2 = await lock.adquirir(CNPJ, 'producao');
    liberar2();
  });

  it('permite CNPJs distintos em paralelo', async () => {
    const lock = new SyncLockMemoriaAdn();
    const a = await lock.adquirir(CNPJ, 'producao');
    const b = await lock.adquirir(CNPJ_B, 'producao');
    a();
    b();
  });

  it('lock arquivo falha se já existe; remove stale', async () => {
    const dir = tmpRaiz('adn-lock-');
    const lock = new SyncLockArquivoAdn(dir, 1_000);
    gravarLockStaleParaTeste(dir, CNPJ, 'producao', new Date(Date.now() - 60_000).toISOString());
    const liberar = await lock.adquirir(CNPJ, 'producao');
    await expect(lock.adquirir(CNPJ, 'producao')).rejects.toMatchObject({
      codigo: 'SYNC_EM_ANDAMENTO',
    });
    liberar();
  });

  it('SyncService propaga SYNC_EM_ANDAMENTO sem avançar checkpoint', async () => {
    const lock = new SyncLockMemoriaAdn();
    const held = await lock.adquirir(CNPJ, 'producao');
    const cp = new CheckpointStoreMemoria();
    commitCheckpointAposLote(cp, {
      cnpj: CNPJ,
      ambiente: 'producao',
      cursorConfirmado: 7,
      lotesProcessados: 0,
      documentosProcessados: 0,
      nsuInicialSessao: 1,
      status: 'PARCIAL',
      fimDistribuicaoConfirmado: false,
    });

    const transporte = mockTransporte([
      { status: 200, body: { StatusProcessamento: 'NENHUM_DOCUMENTO_LOCALIZADO', LoteDFe: [] } },
    ]);
    const sync = new SyncServiceAdn(
      new AdnClient(transporte, credencialDummy()),
      cp,
      LIMITES_TESTE,
      null,
      lock
    );

    await expect(
      sync.syncDistribuicao({ cnpj: CNPJ, ambiente: 'producao', resume: true, rateLimitMs: 0 })
    ).rejects.toMatchObject({ codigo: 'SYNC_EM_ANDAMENTO' });
    expect(cp.ler(CNPJ, 'producao')?.ultimoNsuConfirmado).toBe(7);
    held();
  });
});

describe('Recuperação XML ↔ índice ↔ checkpoint', () => {
  it('não avança checkpoint quando persistência falha no meio do lote', async () => {
    const chaveOk = chave50(1);
    const chaveFail = chave50(2);
    const lote = [
      item(2, 'NFSE', xmlEmitida(chaveOk), undefined, chaveOk),
      item(3, 'NFSE', xmlEmitida(chaveFail), undefined, chaveFail),
    ];
    const transporte = mockTransporte([
      { status: 200, body: { StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS', LoteDFe: lote } },
    ]);

    const docs = new DocumentStoreMemoriaAdn();
    docs.simularFalha((doc) =>
      doc.chaveAcesso === chaveFail
        ? new ErroAdn('DISCO_CHEIO', 'BLOQUEANTE', 'simulado')
        : null
    );

    const cp = new CheckpointStoreMemoria();
    const sync = new SyncServiceAdn(
      new AdnClient(transporte, credencialDummy()),
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
      rateLimitMs: 0,
    });

    expect(r.status).toBe('ERRO');
    expect(r.motivoParada).toContain('falha_persistencia');
    expect(cp.ler(CNPJ, 'producao')).toBeNull();
    expect(r.persistencia?.persistidos).toBe(1);
    const keys = await docs.carregarChavesDedupe(CNPJ, 'producao');
    expect(keys.size).toBe(1);
  });

  it('reconcilia pendência: XML gravado sem índice → recupera chave', async () => {
    const raiz = tmpRaiz('adn-rec-');
    const store = new DocumentStoreArquivoAdn(raiz, { maxBytesArmazenamentoCnpj: 0 });
    const doc = await processarItemDistribuicao({
      empresaCnpj: CNPJ,
      item: item(2, 'NFSE', xmlEmitida(), undefined, CHAVE_E),
    });

    // Simula crash após XML: grava pendência + XML, sem índice.
    const base = store.raizCnpj(CNPJ, 'producao');
    const rel = path.join('2026', '01', 'Emitidas', `${CHAVE_E}.xml`);
    const abs = path.join(base, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true, mode: 0o700 });
    escreverArquivoAtomico(abs, doc.xml!);
    const pendDir = path.join(base, '.adn-pending');
    fs.mkdirSync(pendDir, { recursive: true, mode: 0o700 });
    escreverArquivoAtomico(
      path.join(pendDir, 'pend.json'),
      JSON.stringify({
        chaveDedupe: chaveDedupeDocumento(doc),
        caminhoRelativo: rel,
        atualizadoEm: new Date().toISOString(),
      })
    );

    const rec = await store.reconciliar(CNPJ, 'producao');
    expect(rec.recuperados).toBe(1);
    const keys = await store.carregarChavesDedupe(CNPJ, 'producao');
    expect(keys.size).toBe(1);

    // Segunda gravação do mesmo doc é duplicada — sem perda/sobrescrita.
    const salvo = await store.salvar(CNPJ, 'producao', doc);
    expect(salvo.duplicado).toBe(true);
  });

  it('abandona pendência sem XML (escrita incompleta) e permite regravar', async () => {
    const raiz = tmpRaiz('adn-abandon-');
    const store = new DocumentStoreArquivoAdn(raiz, { maxBytesArmazenamentoCnpj: 0 });
    const base = store.raizCnpj(CNPJ, 'producao');
    const pendDir = path.join(base, '.adn-pending');
    fs.mkdirSync(pendDir, { recursive: true, mode: 0o700 });
    escreverArquivoAtomico(
      path.join(pendDir, 'pend.json'),
      JSON.stringify({
        chaveDedupe: 'NFSE|x|1|',
        caminhoRelativo: path.join('2026', '01', 'Emitidas', 'nao-existe.xml'),
        atualizadoEm: new Date().toISOString(),
      })
    );

    const rec = await store.reconciliar(CNPJ, 'producao');
    expect(rec.abandonados).toBe(1);
    expect(fs.readdirSync(pendDir)).toHaveLength(0);

    const doc = await processarItemDistribuicao({
      empresaCnpj: CNPJ,
      item: item(2, 'NFSE', xmlEmitida(), undefined, CHAVE_E),
    });
    const salvo = await store.salvar(CNPJ, 'producao', doc);
    expect(salvo.duplicado).toBe(false);
    expect(salvo.caminho).toBeTruthy();
  });

  it('retomada após falha: dedupe preserva docs e avança só o restante', async () => {
    const chave1 = chave50(11);
    const chave2 = chave50(22);
    const docs = new DocumentStoreMemoriaAdn();
    docs.simularFalha((doc) =>
      doc.chaveAcesso === chave2 ? new ErroAdn('IO_ERROR', 'BLOQUEANTE', 'boom') : null
    );

    const lote = [
      item(2, 'NFSE', xmlEmitida(chave1), undefined, chave1),
      item(3, 'NFSE', xmlEmitida(chave2), undefined, chave2),
    ];
    const cp = new CheckpointStoreMemoria();
    const lock = new SyncLockMemoriaAdn();

    const sync1 = new SyncServiceAdn(
      new AdnClient(
        mockTransporte([
          { status: 200, body: { StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS', LoteDFe: lote } },
        ]),
        credencialDummy()
      ),
      cp,
      LIMITES_TESTE,
      docs,
      lock
    );
    const r1 = await sync1.syncDistribuicao({
      cnpj: CNPJ,
      ambiente: 'producao',
      forcarNsu: 1,
      resume: false,
      rateLimitMs: 0,
    });
    expect(r1.status).toBe('ERRO');
    expect(cp.ler(CNPJ, 'producao')).toBeNull();

    docs.simularFalha(() => null);
    const sync2 = new SyncServiceAdn(
      new AdnClient(
        mockTransporte([
          { status: 200, body: { StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS', LoteDFe: lote } },
          { status: 200, body: { StatusProcessamento: 'NENHUM_DOCUMENTO_LOCALIZADO', LoteDFe: [] } },
        ]),
        credencialDummy()
      ),
      cp,
      LIMITES_TESTE,
      docs,
      lock
    );
    const r2 = await sync2.syncDistribuicao({
      cnpj: CNPJ,
      ambiente: 'producao',
      forcarNsu: 1,
      resume: false,
      rateLimitMs: 0,
    });
    expect(r2.status).toBe('COMPLETO');
    expect(r2.duplicidades).toBe(1);
    expect(r2.persistencia?.persistidos).toBe(1);
    expect(cp.ler(CNPJ, 'producao')?.ultimoNsuConfirmado).toBe(3);
    expect((await docs.carregarChavesDedupe(CNPJ, 'producao')).size).toBe(2);
  });
});

describe('Limites e XML inválido', () => {
  it('respeita limite de armazenamento e não avança checkpoint', async () => {
    const docs = new DocumentStoreMemoriaAdn({ maxBytesArmazenamentoCnpj: 50 });
    const chave = chave50(99);
    const lote = [item(2, 'NFSE', xmlEmitida(chave), undefined, chave)];
    const cp = new CheckpointStoreMemoria();
    const sync = new SyncServiceAdn(
      new AdnClient(
        mockTransporte([
          { status: 200, body: { StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS', LoteDFe: lote } },
        ]),
        credencialDummy()
      ),
      cp,
      { ...LIMITES_TESTE, maxBytesArmazenamentoCnpj: 50 },
      docs
    );
    const r = await sync.syncDistribuicao({
      cnpj: CNPJ,
      ambiente: 'producao',
      forcarNsu: 1,
      resume: false,
      rateLimitMs: 0,
    });
    expect(r.status).toBe('ERRO');
    expect(r.motivoParada).toContain('limite_armazenamento');
    expect(cp.ler(CNPJ, 'producao')).toBeNull();
  });

  it('classifica motivoXmlInvalido e persiste em _xml_invalidos quando há payload', async () => {
    const ausente = await processarItemDistribuicao({
      empresaCnpj: CNPJ,
      item: { NSU: 1, TipoDocumento: 'NFSE' },
    });
    expect(ausente.xmlValido).toBe(false);
    expect(ausente.motivoXmlInvalido).toBe('ausente');

    const decode = await processarItemDistribuicao({
      empresaCnpj: CNPJ,
      item: { NSU: 2, TipoDocumento: 'NFSE', ArquivoXml: '!!!' },
    });
    expect(decode.motivoXmlInvalido).toBe('decode_falhou');

    const raiz = tmpRaiz('adn-inv-');
    const store = new DocumentStoreArquivoAdn(raiz, { maxBytesArmazenamentoCnpj: 0 });
    // XML decodificável mas sem identificação fiscal útil.
    const xmlLixo = '<?xml version="1.0"?><root><x>1</x></root>';
    const mal = await processarItemDistribuicao({
      empresaCnpj: CNPJ,
      item: {
        NSU: 3,
        TipoDocumento: 'NFSE',
        ArquivoXml: gzipB64(xmlLixo),
      },
    });
    // bemFormado pode ser true; forçamos inválido para exercitar pasta.
    mal.xmlValido = false;
    mal.motivoXmlInvalido = 'sem_identificacao';
    mal.xml = xmlLixo;

    const r = await store.salvar(CNPJ, 'producao', mal);
    expect(r.xmlInvalidoPersistido).toBe(true);
    expect(r.caminho).toContain(`${path.sep}_xml_invalidos${path.sep}`);
    expect(fs.existsSync(r.caminho!)).toBe(true);
  });

  it('aplica rateLimitMs entre requisições no sync', async () => {
    const timestamps: number[] = [];
    const transporte: TransporteHttpAdn = {
      async get(url) {
        timestamps.push(Date.now());
        const n = timestamps.length;
        const body =
          n === 1
            ? {
                StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS' as const,
                LoteDFe: [item(2, 'NFSE', xmlEmitida(chave50(1)), undefined, chave50(1))],
              }
            : { StatusProcessamento: 'NENHUM_DOCUMENTO_LOCALIZADO' as const, LoteDFe: [] };
        return {
          status: 200,
          body: Buffer.from(JSON.stringify(body)),
          durationMs: 1,
          url: url.toString(),
        };
      },
    };

    const sync = new SyncServiceAdn(
      new AdnClient(transporte, credencialDummy()),
      new CheckpointStoreMemoria(),
      { ...LIMITES_TESTE, rateLimitMs: 40 }
    );
    const started = Date.now();
    await sync.syncDistribuicao({
      cnpj: CNPJ,
      ambiente: 'producao',
      forcarNsu: 1,
      resume: false,
      rateLimitMs: 40,
    });
    expect(timestamps.length).toBe(2);
    expect(timestamps[1]! - timestamps[0]!).toBeGreaterThanOrEqual(35);
    expect(Date.now() - started).toBeGreaterThanOrEqual(35);
  });
});

describe('Proteção contra sobrescrita', () => {
  it('não sobrescreve XML divergente — cria sufixo', async () => {
    const raiz = tmpRaiz('adn-ow-');
    const store = new DocumentStoreArquivoAdn(raiz, { maxBytesArmazenamentoCnpj: 0 });
    const doc = await processarItemDistribuicao({
      empresaCnpj: CNPJ,
      item: item(2, 'NFSE', xmlEmitida(), undefined, CHAVE_E),
    });
    const a = await store.salvar(CNPJ, 'producao', doc);
    expect(a.duplicado).toBe(false);

    // Remove da índice mas mantém arquivo com conteúdo diferente → força caminho alternativo.
    const indexPath = path.join(store.raizCnpj(CNPJ, 'producao'), '.adn-dedupe-index.json');
    escreverArquivoAtomico(indexPath, JSON.stringify({ keys: [], atualizadoEm: new Date().toISOString() }));
    fs.writeFileSync(a.caminho!, 'CONTEUDO-DIVERGENTE', 'utf8');

    const doc2 = { ...doc, nsu: 99, xml: doc.xml };
    const b = await store.salvar(CNPJ, 'producao', doc2);
    expect(b.caminho).not.toBe(a.caminho);
    expect(b.caminho).toContain('divergente');
    expect(fs.readFileSync(a.caminho!, 'utf8')).toBe('CONTEUDO-DIVERGENTE');
    expect(fs.readFileSync(b.caminho!, 'utf8')).toContain('chNFSe');
  });
});
