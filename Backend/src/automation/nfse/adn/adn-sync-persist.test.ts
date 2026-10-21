/**
 * API-01F — Testes offline de sincronização + persistência ADN.
 * Sem rede, sem Portal, sem SEFIN, sem Playwright, sem botão Iniciar.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { AdnClient } from './adn-client';
import { processarItemDistribuicao } from './classifier';
import { CheckpointStoreMemoria, commitCheckpointAposLote } from './checkpoint-store';
import {
  DocumentStoreArquivoAdn,
  DocumentStoreMemoriaAdn,
} from './document-store';
import { adaptarSyncAdnParaInventarioParcial, criarPeriodoReferenciaAdn } from './inventory-adapter';
import { SyncServiceAdn } from './sync-service';
import type {
  CredencialMtls,
  DistribuicaoNsuItem,
  LoteDistribuicaoNsuResponse,
  TransporteHttpAdn,
} from './types';

const CNPJ = '12345678000190';
const CNPJ_B = '99888777000166';
const CHAVE_E = '41069022228631747000167000000000003626090719238991';
const CHAVE_R = '41069022252448489000162000000000005526095260389667';

function chave50(seed: number): string {
  return String(Math.abs(seed)).padStart(50, '0');
}

function gzipB64(xml: string): string {
  return gzipSync(Buffer.from(xml, 'utf8')).toString('base64');
}

function xmlEmitida(chave = CHAVE_E): string {
  return `<?xml version="1.0"?><NFSe xmlns="http://www.sped.fazenda.gov.br/nfse"><infNFSe><chNFSe>${chave}</chNFSe><emit><CNPJ>${CNPJ}</CNPJ></emit><toma><CNPJ>${CNPJ_B}</CNPJ></toma><dCompet>2026-01</dCompet></infNFSe></NFSe>`;
}

function xmlRecebida(chave = CHAVE_R): string {
  return `<?xml version="1.0"?><NFSe xmlns="http://www.sped.fazenda.gov.br/nfse"><infNFSe><chNFSe>${chave}</chNFSe><emit><CNPJ>${CNPJ_B}</CNPJ></emit><toma><CNPJ>${CNPJ}</CNPJ></toma><dCompet>2026-02</dCompet></infNFSe></NFSe>`;
}

function xmlEvento(chave = CHAVE_E): string {
  return `<?xml version="1.0"?><evento><infEvento><chNFSe>${chave}</chNFSe><tpEvento>CANCELAMENTO</tpEvento></infEvento></evento>`;
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

function tmpRaiz(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adn-persist-'));
  tmpDirs.push(dir);
  return dir;
}

describe('DocumentStoreArquivoAdn — isolamento e segurança', () => {
  it('persiste por CNPJ/ambiente/competência/classificação com escrita atômica', async () => {
    const raiz = tmpRaiz();
    const store = new DocumentStoreArquivoAdn(raiz);

    const doc = await processarItemDistribuicao({
      empresaCnpj: CNPJ,
      item: item(2, 'NFSE', xmlEmitida(), undefined, CHAVE_E),
    });

    const r = await store.salvar(CNPJ, 'producao', doc);
    expect(r.duplicado).toBe(false);
    expect(r.caminho).toBeTruthy();
    expect(r.caminho!).toContain(path.join(CNPJ, 'producao', '2026', '01', 'Emitidas'));
    expect(fs.existsSync(r.caminho!)).toBe(true);
    expect(fs.readFileSync(r.caminho!, 'utf8')).toContain(CHAVE_E);

    const keys = await store.carregarChavesDedupe(CNPJ, 'producao');
    expect(keys.has(r.chaveDedupe)).toBe(true);
  });

  it('isola CNPJ A de CNPJ B e ambientes distintos', async () => {
    const raiz = tmpRaiz();
    const store = new DocumentStoreArquivoAdn(raiz);

    const docA = await processarItemDistribuicao({
      empresaCnpj: CNPJ,
      item: item(1, 'NFSE', xmlEmitida(chave50(1)), undefined, chave50(1)),
    });
    const docB = await processarItemDistribuicao({
      empresaCnpj: CNPJ_B,
      item: item(1, 'NFSE', xmlRecebida(chave50(2)), undefined, chave50(2)),
    });

    await store.salvar(CNPJ, 'producao', docA);
    await store.salvar(CNPJ_B, 'producao', docB);
    await store.salvar(CNPJ, 'producao-restrita', docA);

    expect(fs.existsSync(path.join(raiz, CNPJ, 'producao'))).toBe(true);
    expect(fs.existsSync(path.join(raiz, CNPJ_B, 'producao'))).toBe(true);
    expect(fs.existsSync(path.join(raiz, CNPJ, 'producao-restrita'))).toBe(true);

    const keysA = await store.carregarChavesDedupe(CNPJ, 'producao');
    const keysB = await store.carregarChavesDedupe(CNPJ_B, 'producao');
    expect(keysA.size).toBe(1);
    expect(keysB.size).toBe(1);
    expect([...keysA][0]).not.toBe([...keysB][0]);
  });

  it('não sobrescreve XML idêntico e marca duplicado', async () => {
    const raiz = tmpRaiz();
    const store = new DocumentStoreArquivoAdn(raiz);
    const doc = await processarItemDistribuicao({
      empresaCnpj: CNPJ,
      item: item(3, 'NFSE', xmlEmitida(), undefined, CHAVE_E),
    });

    const a = await store.salvar(CNPJ, 'producao', doc);
    const b = await store.salvar(CNPJ, 'producao', doc);
    expect(a.duplicado).toBe(false);
    expect(b.duplicado).toBe(true);
    expect(b.caminho).toBeNull();
  });

  it('preserva evento/cancelamento em pasta Eventos sem colidir com NFSe', async () => {
    const raiz = tmpRaiz();
    const store = new DocumentStoreArquivoAdn(raiz);

    const nfse = await processarItemDistribuicao({
      empresaCnpj: CNPJ,
      item: item(10, 'NFSE', xmlEmitida(), undefined, CHAVE_E),
    });
    const evento = await processarItemDistribuicao({
      empresaCnpj: CNPJ,
      item: item(11, 'EVENTO', xmlEvento(), 'CANCELAMENTO', CHAVE_E),
    });

    const rNfse = await store.salvar(CNPJ, 'producao', nfse);
    const rEvt = await store.salvar(CNPJ, 'producao', evento);

    expect(rNfse.caminho).toContain(`${path.sep}Emitidas${path.sep}`);
    expect(rEvt.caminho).toContain(`${path.sep}Eventos${path.sep}`);
    expect(rEvt.caminho).toContain('CANCELAMENTO');
    expect(rNfse.chaveDedupe).not.toBe(rEvt.chaveDedupe);
    expect(fs.existsSync(rNfse.caminho!)).toBe(true);
    expect(fs.existsSync(rEvt.caminho!)).toBe(true);
  });

  it('rejeita CNPJ inválido', async () => {
    const store = new DocumentStoreArquivoAdn(tmpRaiz());
    await expect(store.carregarChavesDedupe('123', 'producao')).rejects.toMatchObject({
      codigo: 'CNPJ_INVALIDO',
    });
  });
});

describe('SyncServiceAdn + persistência — lote ≤50, dedupe, retomada NSU', () => {
  it('persiste lote de até 50 docs e avança checkpoint só após lote', async () => {
    const lote = Array.from({ length: 50 }, (_, i) => {
      const c = chave50(3000 + i);
      return item(i + 2, 'NFSE', xmlEmitida(c), undefined, c);
    });
    const transporte = mockTransporte([
      { status: 200, body: { StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS', LoteDFe: lote } },
      { status: 200, body: { StatusProcessamento: 'NENHUM_DOCUMENTO_LOCALIZADO', LoteDFe: [] } },
    ]);

    const cp = new CheckpointStoreMemoria();
    const docs = new DocumentStoreMemoriaAdn();
    const sync = new SyncServiceAdn(new AdnClient(transporte, credencialDummy()), cp, undefined, docs);

    const r = await sync.syncDistribuicao({
      cnpj: CNPJ,
      ambiente: 'producao',
      forcarNsu: 1,
      resume: false,
    });

    expect(r.documentos).toHaveLength(50);
    expect(r.persistencia?.persistidos).toBe(50);
    expect(r.inventarioMensalCompletoDeclarado).toBe(false);
    expect(r.status).toBe('COMPLETO');
    expect(r.fimDistribuicaoConfirmado).toBe(true);
    expect(cp.ler(CNPJ, 'producao')?.ultimoNsuConfirmado).toBe(51);

    for (const d of r.documentos) {
      expect(d.caminhoArquivo).toBeTruthy();
      expect(d.xml).toBeUndefined();
      expect(docs.obterXml(d.caminhoArquivo!)).toContain('chNFSe');
    }
  });

  it('deduplica na retomada via índice de persistência (mesmo NSU/chave)', async () => {
    const chave = chave50(4242);
    const lote = [item(5, 'NFSE', xmlEmitida(chave), undefined, chave)];

    const cp = new CheckpointStoreMemoria();
    const docs = new DocumentStoreMemoriaAdn();

    const t1 = mockTransporte([
      { status: 200, body: { StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS', LoteDFe: lote } },
      { status: 200, body: { StatusProcessamento: 'NENHUM_DOCUMENTO_LOCALIZADO', LoteDFe: [] } },
    ]);
    const sync1 = new SyncServiceAdn(new AdnClient(t1, credencialDummy()), cp, undefined, docs);
    const r1 = await sync1.syncDistribuicao({
      cnpj: CNPJ,
      ambiente: 'producao',
      forcarNsu: 1,
      resume: false,
    });
    expect(r1.persistencia?.persistidos).toBe(1);
    expect(cp.ler(CNPJ, 'producao')?.ultimoNsuConfirmado).toBe(5);

    // Simula retomada forçada no mesmo cursor com o mesmo item no lote.
    commitCheckpointAposLote(cp, {
      cnpj: CNPJ,
      ambiente: 'producao',
      cursorConfirmado: 1,
      lotesProcessados: 0,
      documentosProcessados: 0,
      nsuInicialSessao: 1,
      status: 'PARCIAL',
      fimDistribuicaoConfirmado: false,
    });

    const t2 = mockTransporte([
      { status: 200, body: { StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS', LoteDFe: lote } },
      { status: 200, body: { StatusProcessamento: 'NENHUM_DOCUMENTO_LOCALIZADO', LoteDFe: [] } },
    ]);
    const sync2 = new SyncServiceAdn(new AdnClient(t2, credencialDummy()), cp, undefined, docs);
    const r2 = await sync2.syncDistribuicao({
      cnpj: CNPJ,
      ambiente: 'producao',
      forcarNsu: 1,
      resume: false,
    });

    expect(r2.documentos).toHaveLength(0);
    expect(r2.duplicidades).toBe(1);
    expect(r2.persistencia?.persistidos).toBe(0);
  });

  it('preserva eventos/cancelamentos na sync com store em arquivo', async () => {
    const raiz = tmpRaiz();
    const docs = new DocumentStoreArquivoAdn(raiz);
    const cp = new CheckpointStoreMemoria();

    const lote = [
      item(2, 'NFSE', xmlEmitida(), undefined, CHAVE_E),
      item(3, 'EVENTO', xmlEvento(), 'CANCELAMENTO', CHAVE_E),
      item(4, 'NFSE', xmlRecebida(), undefined, CHAVE_R),
    ];
    const transporte = mockTransporte([
      { status: 200, body: { StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS', LoteDFe: lote } },
      { status: 200, body: { StatusProcessamento: 'NENHUM_DOCUMENTO_LOCALIZADO', LoteDFe: [] } },
    ]);

    const sync = new SyncServiceAdn(new AdnClient(transporte, credencialDummy()), cp, undefined, docs);
    const r = await sync.syncDistribuicao({
      cnpj: CNPJ,
      ambiente: 'producao',
      forcarNsu: 1,
      resume: false,
    });

    expect(r.contagens.emitidas).toBe(1);
    expect(r.contagens.recebidas).toBe(1);
    expect(r.contagens.eventos).toBe(1);
    expect(r.persistencia?.persistidos).toBe(3);

    const emitidas = r.documentos.find((d) => d.classificacao === 'emitida')!;
    const evento = r.documentos.find((d) => d.classificacao === 'evento')!;
    expect(emitidas.caminhoArquivo).toContain(`${path.sep}Emitidas${path.sep}`);
    expect(evento.caminhoArquivo).toContain(`${path.sep}Eventos${path.sep}`);
    expect(fs.readFileSync(evento.caminhoArquivo!, 'utf8')).toContain('CANCELAMENTO');
  });

  it('nunca declara inventário mensal completo só pelo fim da fila NSU', async () => {
    const chave = chave50(777);
    const transporte = mockTransporte([
      {
        status: 200,
        body: {
          StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS',
          LoteDFe: [item(2, 'NFSE', xmlEmitida(chave), undefined, chave)],
        },
      },
      { status: 200, body: { StatusProcessamento: 'NENHUM_DOCUMENTO_LOCALIZADO', LoteDFe: [] } },
    ]);

    const sync = new SyncServiceAdn(
      new AdnClient(transporte, credencialDummy()),
      new CheckpointStoreMemoria(),
      undefined,
      new DocumentStoreMemoriaAdn()
    );
    const r = await sync.syncDistribuicao({
      cnpj: CNPJ,
      ambiente: 'producao',
      forcarNsu: 1,
      resume: false,
    });

    expect(r.status).toBe('COMPLETO');
    expect(r.fimDistribuicaoConfirmado).toBe(true);
    expect(r.inventarioMensalCompletoDeclarado).toBe(false);

    const adaptado = adaptarSyncAdnParaInventarioParcial({
      sync: r,
      periodoConsulta: criarPeriodoReferenciaAdn('01/01/2026', '31/01/2026'),
    });
    expect(adaptado.inventario.completude).toBe('PARCIAL');
    expect(adaptado.inventarioMensalCompletoDeclarado).toBe(false);
  });

  it('retoma NSU a partir do checkpoint sem reprocessar docs já persistidos', async () => {
    const raiz = tmpRaiz();
    const docs = new DocumentStoreArquivoAdn(raiz);
    const cp = new CheckpointStoreMemoria();

    const lote1 = Array.from({ length: 2 }, (_, i) => {
      const c = chave50(5000 + i);
      return item(i + 2, 'NFSE', xmlEmitida(c), undefined, c);
    });
    const lote2 = [
      item(4, 'NFSE', xmlRecebida(chave50(6000)), undefined, chave50(6000)),
    ];

    const t1 = mockTransporte([
      { status: 200, body: { StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS', LoteDFe: lote1 } },
    ]);
    const sync1 = new SyncServiceAdn(new AdnClient(t1, credencialDummy()), cp, undefined, docs);
    const r1 = await sync1.syncDistribuicao({
      cnpj: CNPJ,
      ambiente: 'producao',
      forcarNsu: 1,
      maxRequests: 1,
      resume: false,
    });
    expect(r1.status).toBe('PARCIAL');
    expect(r1.persistencia?.persistidos).toBe(2);
    expect(cp.ler(CNPJ, 'producao')?.ultimoNsuConfirmado).toBe(3);

    const t2 = mockTransporte([
      { status: 200, body: { StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS', LoteDFe: lote2 } },
      { status: 200, body: { StatusProcessamento: 'NENHUM_DOCUMENTO_LOCALIZADO', LoteDFe: [] } },
    ]);
    const sync2 = new SyncServiceAdn(new AdnClient(t2, credencialDummy()), cp, undefined, docs);
    const r2 = await sync2.syncDistribuicao({
      cnpj: CNPJ,
      ambiente: 'producao',
      resume: true,
    });

    expect(r2.nsuInicial).toBe(3);
    expect(r2.documentos).toHaveLength(1);
    expect(r2.persistencia?.persistidos).toBe(1);
    expect(r2.status).toBe('COMPLETO');
    expect(r2.inventarioMensalCompletoDeclarado).toBe(false);

    const keys = await docs.carregarChavesDedupe(CNPJ, 'producao');
    expect(keys.size).toBe(3);
  });
});
