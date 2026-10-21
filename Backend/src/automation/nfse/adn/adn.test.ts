/**
 * Testes offline do módulo ADN/NSU.
 * Sem rede, sem Portal, sem SEFIN real, sem Playwright.
 */
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { AdnClient } from './adn-client';
import { classificarDocumentoDistribuido, processarItemDistribuicao } from './classifier';
import {
  CheckpointStoreMemoria,
  commitCheckpointAposLote,
} from './checkpoint-store';
import { interpretarRespostaDistribuicao } from './distribuicao-result';
import { ErroAdn } from './errors';
import { montarUrlDistribuicaoDfe } from './endpoints';
import { adaptarSyncAdnParaInventarioParcial, criarPeriodoReferenciaAdn } from './inventory-adapter';
import { analisarLote, dedupeKeyDistribuicao } from './lote-analyzer';
import { SyncServiceAdn } from './sync-service';
import type {
  CredencialMtls,
  DistribuicaoNsuItem,
  LoteDistribuicaoNsuResponse,
  ResultadoSyncAdn,
  TransporteHttpAdn,
} from './types';
import { decodificarArquivoXmlAdn } from './xml-decode';

const CNPJ = '12345678000190';
const CNPJ_B = '99888777000166';
/** Chaves nacionais de 50 dígitos (contrato AutoNacional). */
const CHAVE_E = '41069022228631747000167000000000003626090719238991';
const CHAVE_R = '41069022252448489000162000000000005526095260389667';
const CHAVE_I = '35503081225012398000107000001930115926097767318278';

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

function xmlIntermediada(chave = CHAVE_I): string {
  return `<?xml version="1.0"?><NFSe xmlns="http://www.sped.fazenda.gov.br/nfse"><infNFSe><chNFSe>${chave}</chNFSe><emit><CNPJ>${CNPJ_B}</CNPJ></emit><interm><CNPJ>${CNPJ}</CNPJ></interm><dCompet>2026-03</dCompet></infNFSe></NFSe>`;
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
): { transporte: TransporteHttpAdn; urls: string[] } {
  const urls: string[] = [];
  let i = 0;
  const transporte: TransporteHttpAdn = {
    async get(url) {
      urls.push(url.toString());
      const step = sequence[Math.min(i, sequence.length - 1)];
      i += 1;
      const body =
        typeof step.body === 'string'
          ? Buffer.from(step.body)
          : Buffer.from(JSON.stringify(step.body));
      return { status: step.status, body, durationMs: 1, url: url.toString() };
    },
  };
  return { transporte, urls };
}

describe('ADN endpoints', () => {
  it('monta GET /DFe/{NSU} com cnpjConsulta e lote=true', () => {
    const url = montarUrlDistribuicaoDfe({
      ambiente: 'producao',
      nsu: 51,
      cnpjConsulta: CNPJ,
      lote: true,
    });
    expect(url.hostname).toBe('adn.nfse.gov.br');
    expect(url.pathname).toBe('/contribuintes/DFe/51');
    expect(url.searchParams.get('cnpjConsulta')).toBe(CNPJ);
    expect(url.searchParams.get('lote')).toBe('true');
  });
});

describe('interpretarRespostaDistribuicao', () => {
  it('documentos localizados', () => {
    const r = interpretarRespostaDistribuicao({
      statusHttp: 200,
      data: { StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS', LoteDFe: [{ NSU: 2 }] },
    });
    expect(r.classificacao).toBe('documentos_localizados');
  });

  it('nenhum documento / fim de fila', () => {
    const r = interpretarRespostaDistribuicao({
      statusHttp: 200,
      data: { StatusProcessamento: 'NENHUM_DOCUMENTO_LOCALIZADO', LoteDFe: [] },
    });
    expect(r.classificacao).toBe('nenhum_documento_neste_nsu');
  });

  it('429 rate limit', () => {
    expect(interpretarRespostaDistribuicao({ statusHttp: 429 }).classificacao).toBe('rate_limit');
  });

  it('401 não autorizado', () => {
    expect(interpretarRespostaDistribuicao({ statusHttp: 401 }).classificacao).toBe('nao_autorizado');
  });
});

describe('analisarLote / continuidade', () => {
  it('lote cheio: próximo cursor = max NSU', () => {
    const lote = Array.from({ length: 50 }, (_, i) => ({ NSU: i + 2 }));
    const a = analisarLote(
      { StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS', LoteDFe: lote },
      1,
      200
    );
    expect(a.loteCheio).toBe(true);
    expect(a.proximoCursor).toBe(51);
    expect(a.fimDistribuicao).toBe(false);
  });

  it('NENHUM_DOCUMENTO = fim distribuição', () => {
    const a = analisarLote(
      { StatusProcessamento: 'NENHUM_DOCUMENTO_LOCALIZADO', LoteDFe: [] },
      151,
      200
    );
    expect(a.fimDistribuicao).toBe(true);
  });

  it('dedupeKey distingue documento e evento da mesma chave', () => {
    const a = dedupeKeyDistribuicao({
      NSU: 1,
      TipoDocumento: 'NFSE',
      ChaveAcesso: CHAVE_E,
    });
    const b = dedupeKeyDistribuicao({
      NSU: 2,
      TipoDocumento: 'EVENTO',
      ChaveAcesso: CHAVE_E,
      TipoEvento: 'CANCELAMENTO',
    });
    expect(a).not.toBe(b);
  });
});

describe('XML decode / classificação', () => {
  it('decodifica GZip+Base64', async () => {
    const xml = await decodificarArquivoXmlAdn(gzipB64(xmlEmitida()));
    expect(xml).toContain('chNFSe');
  });

  it('XML inválido (não gzip/base64 útil) marca falha tratável', async () => {
    const doc = await processarItemDistribuicao({
      empresaCnpj: CNPJ,
      item: { NSU: 9, TipoDocumento: 'NFSE', ArquivoXml: '!!!invalido!!!' },
    });
    expect(doc.xmlValido).toBe(false);
    expect(doc.classificacao).toBe('nao_classificado');
  });

  it('classifica emitida, recebida, intermediada e evento', async () => {
    const em = await processarItemDistribuicao({
      empresaCnpj: CNPJ,
      item: item(1, 'NFSE', xmlEmitida()),
    });
    const re = await processarItemDistribuicao({
      empresaCnpj: CNPJ,
      item: item(2, 'NFSE', xmlRecebida()),
    });
    const inter = await processarItemDistribuicao({
      empresaCnpj: CNPJ,
      item: item(3, 'NFSE', xmlIntermediada()),
    });
    const ev = await processarItemDistribuicao({
      empresaCnpj: CNPJ,
      item: item(4, 'EVENTO', xmlEvento(), 'CANCELAMENTO', CHAVE_E),
    });
    expect(em.classificacao).toBe('emitida');
    expect(re.classificacao).toBe('recebida');
    expect(inter.classificacao).toBe('intermediada');
    expect(ev.classificacao).toBe('evento');
    expect(ev.tipoEvento).toBe('CANCELAMENTO');
  });

  it('classificarDocumentoDistribuido prioriza EVENTO', () => {
    expect(
      classificarDocumentoDistribuido({
        empresaCnpj: CNPJ,
        item: { TipoDocumento: 'EVENTO', TipoEvento: 'CANCELAMENTO' },
        papeis: ['emitente'],
        pareceEvento: false,
      })
    ).toBe('evento');
  });
});

describe('checkpoint isolamento CNPJ/ambiente', () => {
  it('isola por CNPJ e ambiente', () => {
    const store = new CheckpointStoreMemoria();
    commitCheckpointAposLote(store, {
      cnpj: CNPJ,
      ambiente: 'producao',
      cursorConfirmado: 50,
      lotesProcessados: 1,
      documentosProcessados: 50,
      nsuInicialSessao: 1,
      status: 'PARCIAL',
      fimDistribuicaoConfirmado: false,
    });
    commitCheckpointAposLote(store, {
      cnpj: CNPJ_B,
      ambiente: 'producao',
      cursorConfirmado: 10,
      lotesProcessados: 1,
      documentosProcessados: 10,
      nsuInicialSessao: 1,
      status: 'PARCIAL',
      fimDistribuicaoConfirmado: false,
    });
    commitCheckpointAposLote(store, {
      cnpj: CNPJ,
      ambiente: 'producao-restrita',
      cursorConfirmado: 7,
      lotesProcessados: 1,
      documentosProcessados: 7,
      nsuInicialSessao: 1,
      status: 'PARCIAL',
      fimDistribuicaoConfirmado: false,
    });

    expect(store.ler(CNPJ, 'producao')?.ultimoNsuConfirmado).toBe(50);
    expect(store.ler(CNPJ_B, 'producao')?.ultimoNsuConfirmado).toBe(10);
    expect(store.ler(CNPJ, 'producao-restrita')?.ultimoNsuConfirmado).toBe(7);
  });
});

describe('SyncServiceAdn — distribuição, paginação, retomada', () => {
  it('pagina dois lotes e avança cursor pelo max NSU', async () => {
    const lote1 = Array.from({ length: 50 }, (_, i) => {
      const chave = chave50(1000 + i);
      return item(i + 2, 'NFSE', xmlEmitida(chave), undefined, chave);
    });
    const lote2 = Array.from({ length: 10 }, (_, i) => {
      const chave = chave50(2000 + i);
      return item(i + 52, 'NFSE', xmlRecebida(chave), undefined, chave);
    });

    const { transporte } = mockTransporte([
      {
        status: 200,
        body: { StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS', LoteDFe: lote1 },
      },
      {
        status: 200,
        body: { StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS', LoteDFe: lote2 },
      },
      {
        status: 200,
        body: { StatusProcessamento: 'NENHUM_DOCUMENTO_LOCALIZADO', LoteDFe: [] },
      },
    ]);

    const store = new CheckpointStoreMemoria();
    const client = new AdnClient(transporte, credencialDummy(), {
      timeoutMs: 1000,
      maxBytesResposta: 4_000_000,
      maxBytesGzip: 1_500_000,
      maxBytesXml: 4_000_000,
      rateLimitMs: 0,
      maxRequests: 10,
    });
    const sync = new SyncServiceAdn(client, store);
    const r = await sync.syncDistribuicao({
      cnpj: CNPJ,
      ambiente: 'producao',
      forcarNsu: 1,
      maxRequests: 10,
      resume: false,
    });

    expect(r.lotesProcessados).toBe(2);
    expect(r.ultimoNsuProcessado).toBe(61);
    expect(r.status).toBe('COMPLETO');
    expect(r.fimDistribuicaoConfirmado).toBe(true);
    expect(r.inventarioMensalCompletoDeclarado).toBe(false);
    expect(r.contagens.emitidas).toBe(50);
    expect(r.contagens.recebidas).toBe(10);
    expect(store.ler(CNPJ, 'producao')?.ultimoNsuConfirmado).toBe(61);
  });

  it('retoma a partir do checkpoint após falha parcial', async () => {
    const store = new CheckpointStoreMemoria();
    commitCheckpointAposLote(store, {
      cnpj: CNPJ,
      ambiente: 'producao',
      cursorConfirmado: 51,
      lotesProcessados: 1,
      documentosProcessados: 50,
      nsuInicialSessao: 1,
      status: 'PARCIAL',
      motivoParada: 'limite_max_requests',
      fimDistribuicaoConfirmado: false,
    });

    const chave = chave50(99999);
    const { transporte, urls } = mockTransporte([
      {
        status: 200,
        body: {
          StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS',
          LoteDFe: [item(52, 'NFSE', xmlEmitida(chave), undefined, chave)],
        },
      },
      {
        status: 200,
        body: { StatusProcessamento: 'NENHUM_DOCUMENTO_LOCALIZADO', LoteDFe: [] },
      },
    ]);

    const client = new AdnClient(transporte, credencialDummy());
    const sync = new SyncServiceAdn(client, store);
    const cursor = sync.resolveCursorInicial({ cnpj: CNPJ, ambiente: 'producao', resume: true });
    expect(cursor).toBe(51);

    const r = await sync.syncDistribuicao({ cnpj: CNPJ, ambiente: 'producao', resume: true });
    expect(urls[0]).toContain('/DFe/51');
    expect(r.nsuInicial).toBe(51);
    expect(r.documentos).toHaveLength(1);
    expect(r.status).toBe('COMPLETO');
  });

  it('deduplica itens repetidos no mesmo lote', async () => {
    const chave = chave50(88888);
    const dup = item(5, 'NFSE', xmlEmitida(chave), undefined, chave);
    const { transporte } = mockTransporte([
      {
        status: 200,
        body: {
          StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS',
          LoteDFe: [dup, { ...dup }],
        },
      },
      {
        status: 200,
        body: { StatusProcessamento: 'NENHUM_DOCUMENTO_LOCALIZADO', LoteDFe: [] },
      },
    ]);
    const store = new CheckpointStoreMemoria();
    const sync = new SyncServiceAdn(new AdnClient(transporte, credencialDummy()), store);
    const r = await sync.syncDistribuicao({
      cnpj: CNPJ,
      ambiente: 'producao',
      forcarNsu: 1,
      resume: false,
    });
    expect(r.documentos).toHaveLength(1);
    expect(r.duplicidades).toBe(1);
  });

  it('inventário parcial ao atingir maxRequests sem fim oficial', async () => {
    const lote = Array.from({ length: 50 }, (_, i) => {
      const c = chave50(7000 + i);
      return item(i + 2, 'NFSE', xmlEmitida(c), undefined, c);
    });
    const { transporte } = mockTransporte([
      { status: 200, body: { StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS', LoteDFe: lote } },
      { status: 200, body: { StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS', LoteDFe: lote } },
    ]);
    const store = new CheckpointStoreMemoria();
    const sync = new SyncServiceAdn(new AdnClient(transporte, credencialDummy()), store);
    const r = await sync.syncDistribuicao({
      cnpj: CNPJ,
      ambiente: 'producao',
      forcarNsu: 1,
      maxRequests: 1,
      resume: false,
    });
    expect(r.status).toBe('PARCIAL');
    expect(r.fimDistribuicaoConfirmado).toBe(false);
    expect(r.motivoParada).toBe('limite_max_requests');
  });

  it('trata HTTP 429 como PARCIAL (retomável)', async () => {
    const { transporte } = mockTransporte([{ status: 429, body: '' }]);
    const store = new CheckpointStoreMemoria();
    const sync = new SyncServiceAdn(new AdnClient(transporte, credencialDummy()), store);
    const r = await sync.syncDistribuicao({
      cnpj: CNPJ,
      ambiente: 'producao',
      forcarNsu: 1,
      resume: false,
    });
    expect(r.status).toBe('PARCIAL');
    expect(r.motivoParada).toBe('rate_limit');
  });

  it('propaga falha TLS/auth como ERRO', async () => {
    const transporte: TransporteHttpAdn = {
      async get() {
        throw new ErroAdn('HANDSHAKE_TLS', 'BLOQUEANTE', 'TLS falhou');
      },
    };
    const sync = new SyncServiceAdn(
      new AdnClient(transporte, credencialDummy()),
      new CheckpointStoreMemoria()
    );
    await expect(
      sync.syncDistribuicao({ cnpj: CNPJ, ambiente: 'producao', forcarNsu: 1, resume: false })
    ).rejects.toMatchObject({ codigo: 'HANDSHAKE_TLS' });
  });
});

describe('adaptador inventário — nunca COMPLETO só por NSU', () => {
  it('mapeia emitidas/recebidas e mantém completude PARCIAL mesmo com fim NSU', () => {
    const sync: ResultadoSyncAdn = {
      cnpj: CNPJ,
      ambiente: 'producao',
      documentos: [
        {
          nsu: 2,
          chaveAcesso: CHAVE_E,
          classificacao: 'emitida',
          papeis: ['emitente'],
          sha256: 'a',
          xmlValido: true,
          competencia: '2026-01',
        },
        {
          nsu: 3,
          chaveAcesso: CHAVE_R,
          classificacao: 'recebida',
          papeis: ['tomador'],
          sha256: 'b',
          xmlValido: true,
          competencia: '2026-02',
        },
        {
          nsu: 4,
          chaveAcesso: CHAVE_E,
          classificacao: 'evento',
          papeis: [],
          tipoEvento: 'CANCELAMENTO',
          sha256: 'c',
          xmlValido: true,
        },
        {
          nsu: 5,
          chaveAcesso: CHAVE_I,
          classificacao: 'intermediada',
          papeis: ['intermediario'],
          sha256: 'd',
          xmlValido: true,
        },
      ],
      nsuInicial: 1,
      ultimoNsuProcessado: 5,
      lotesProcessados: 1,
      requests: 2,
      status: 'COMPLETO',
      fimDistribuicaoConfirmado: true,
      inventarioMensalCompletoDeclarado: false,
      motivoParada: 'nenhum_documento_localizado',
      duplicidades: 0,
      xmlsInvalidos: 0,
      contagens: {
        emitidas: 1,
        recebidas: 1,
        intermediadas: 1,
        eventos: 1,
        naoClassificados: 0,
      },
    };

    const adaptado = adaptarSyncAdnParaInventarioParcial({
      sync,
      periodoConsulta: criarPeriodoReferenciaAdn('01/01/2026', '31/01/2026'),
    });

    expect(adaptado.inventario.completude).toBe('PARCIAL');
    expect(adaptado.inventarioMensalCompletoDeclarado).toBe(false);
    expect(adaptado.inventario.totais.emitidas).toBe(1);
    expect(adaptado.inventario.totais.recebidas).toBe(1);
    expect(adaptado.omitidos).toHaveLength(2);
    expect(adaptado.observacoes.some((o) => o.includes('NÃO é declarado completo'))).toBe(true);
  });
});
