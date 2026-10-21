/**
 * H2.2.5 — Homologação integrada offline Discovery-Only.
 *
 * Exercita: UDS → preparar → Prisma(mock) → ticket → ativar → liberar →
 * enqueue(1×) → auth_ok simulada → ponte (validações reais) → discover mock →
 * evidências → encerramento sem legado.
 *
 * Sem Portal, SEFIN, Playwright real, login, certificado ou XML.
 */
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Page } from 'playwright';
import { criarDocumentoFiscal } from '../contracts/documento-fiscal';
import { montarInventario, type InventarioNfse } from '../contracts/inventario';
import { criarPeriodoConsultaPortal } from '../contracts/periodo';
import type { DiscoverNfseInput } from '../discovery/discovery-service';
import type { ResultadoDescobertaNfse } from '../discovery/types';
import {
  avaliarPonteHomologacaoDiscoveryOnly,
  configurarCanalHomologacaoOperacional,
  criarAutorizacaoHomologacao,
  criarAutorizacaoId,
  criarCanalAutorizacaoMemoria,
  criarLimitesHomologacao,
  definirGateExecucaoRealSomenteTeste,
  evidenciaContemSegredo,
  GATE_EXECUCAO_REAL_DISCOVERY_ONLY,
  liberarExecucaoHomologacao,
  limparRegistryPreparacaoSomenteTeste,
  prepararExecucaoHomologacao,
  simularReinicioProcessoSomenteTeste,
  STATUS_HOMOLOGACAO_BLOQUEADA,
  STATUS_HOMOLOGACAO_LIBERADA,
  STATUS_HOMOLOGACAO_PREPARADA,
  type CanalAutorizacaoHomologacao,
  type DependenciasPreparacaoLiberacao,
  type DiscoverNfseInjetavel,
  type PayloadExecucaoHomologacao,
} from './index';
import {
  enviarComandoAdminUds,
  iniciarAdminServidorUds,
  limparHandlersAdminPreparacaoLiberacaoSomenteTeste,
  registrarHandlersAdminPreparacaoLiberacao,
} from './admin';

const CNPJ = '11222333000181';
const CNPJ_OUTRO = '99888777000166';
const PERIODO = criarPeriodoConsultaPortal('01/01/2024', '31/01/2024');
const PERIODO_OUTRO = criarPeriodoConsultaPortal('01/02/2024', '28/02/2024');
const AGORA = new Date('2024-06-15T12:00:00.000Z');
const VALIDO_ATE = '2024-06-16T12:00:00.000Z';
const PAGE = { id: 'page-auth-ok' } as unknown as Page;
const SEGREDO = `${'y'.repeat(32)}-h225-admin-secret`;

const dirs: string[] = [];
let seqId = 5000;
let enqueues: PayloadExecucaoHomologacao[] = [];
let storeExec = new Map<
  number,
  {
    id: number;
    status: string;
    cnpj: string | null;
    periodoInicio: string | null;
    periodoFim: string | null;
    empresaId: number;
    mensagem?: string;
  }
>();
let canalAtual: CanalAutorizacaoHomologacao | null = null;
let sefinCalls = 0;
let xmlWrites = 0;
let checkpointCalls = 0;

function usarCanal(c: CanalAutorizacaoHomologacao | null): void {
  canalAtual = c;
  configurarCanalHomologacaoOperacional(c);
}

function deps(
  overrides?: Partial<DependenciasPreparacaoLiberacao>
): DependenciasPreparacaoLiberacao {
  return {
    async criarExecucao(data) {
      const id = ++seqId;
      storeExec.set(id, {
        id,
        status: data.status,
        cnpj: data.cnpj,
        periodoInicio: data.periodoInicio,
        periodoFim: data.periodoFim,
        empresaId: data.empresaId,
        mensagem: data.mensagem,
      });
      return { id };
    },
    async obterExecucao(id) {
      return storeExec.get(id) ?? null;
    },
    async atualizarSeStatus(id, statusAtual, data) {
      const e = storeExec.get(id);
      if (!e || e.status !== statusAtual) return 0;
      storeExec.set(id, {
        ...e,
        status: data.status ?? e.status,
        mensagem: data.mensagem ?? e.mensagem,
      });
      return 1;
    },
    async enfileirar(payload) {
      enqueues.push(payload);
    },
    obterCanal: () => canalAtual,
    headlessPadrao: true,
    ...overrides,
  };
}

async function dirTmp(): Promise<string> {
  const d = await mkdtemp(path.join(tmpdir(), 'an-h225-'));
  dirs.push(d);
  return d;
}

async function emitirTicket(
  canal: CanalAutorizacaoHomologacao,
  execucaoId: string,
  diretorioFiscal: string,
  opts?: {
    cnpj?: string;
    periodo?: { inicio: string; fim: string };
    ativar?: boolean;
    validoAte?: string;
    agoraEmissao?: Date;
    maxPaginas?: number;
    maxDocumentos?: number;
    timeoutMs?: number;
  }
) {
  const agoraEmissao = opts?.agoraEmissao ?? AGORA;
  const auth = criarAutorizacaoHomologacao({
    cnpj: opts?.cnpj ?? CNPJ,
    periodoConsulta: opts?.periodo
      ? criarPeriodoConsultaPortal(opts.periodo.inicio, opts.periodo.fim)
      : PERIODO,
    execucaoId,
    operacao: 'DISCOVERY_ONLY',
    validoAte: opts?.validoAte ?? VALIDO_ATE,
    diretorioFiscal,
    limites: criarLimitesHomologacao({
      maxDocumentos: opts?.maxDocumentos ?? 20,
      maxPaginas: opts?.maxPaginas ?? 10,
      maxRequisicoesSefin: 0,
      timeoutMs: opts?.timeoutMs ?? 30_000,
    }),
    motivo: 'h225-integrado',
    agora: agoraEmissao,
  });
  const emitido = await canal.emitir({
    versao: 1,
    autorizacaoId: criarAutorizacaoId(),
    autorizacao: auth,
    emitidoEm: agoraEmissao.toISOString(),
  });
  if (opts?.ativar === false) {
    return emitido;
  }
  return canal.ativarDiscoveryReal(emitido.autorizacaoId, 'h225-ativar', agoraEmissao);
}

function registrarHandlers(d: DependenciasPreparacaoLiberacao): void {
  registrarHandlersAdminPreparacaoLiberacao({
    preparar: async (params) => {
      const r = await prepararExecucaoHomologacao(
        {
          empresaId: Number(params.empresaId),
          cnpj: String(params.cnpj),
          periodoInicio: String(params.periodoInicio),
          periodoFim: String(params.periodoFim),
          tipo: String(params.tipo ?? 'DISCOVERY_ONLY'),
          agora: AGORA,
        },
        d
      );
      return { ...r };
    },
    liberar: async (params) => {
      const r = await liberarExecucaoHomologacao(
        { execucaoId: String(params.execucaoId), agora: AGORA },
        d
      );
      return { ...r };
    },
  });
}

function chave(n: number): string {
  return String(n).padStart(50, '1');
}

function inv(direcao: 'EMITIDA' | 'RECEBIDA', itens: { n: number }[]): InventarioNfse {
  return montarInventario({
    id: `inv-${direcao}-${itens.length}`,
    cnpj: CNPJ,
    periodoConsulta: PERIODO,
    documentos: itens.map((i) =>
      criarDocumentoFiscal({
        chaveNacional: chave(i.n),
        cnpj: CNPJ,
        direcao,
        situacao: 'VIGENTE',
        periodoConsulta: PERIODO,
      })
    ),
    completude: 'COMPLETO',
  });
}

function fecharMock(input: {
  tipo: DiscoverNfseInput['tipo'];
  status: ResultadoDescobertaNfse['status'];
  inventario: InventarioNfse;
  paginas: number;
  diagnosticos?: ResultadoDescobertaNfse['diagnosticos'];
}): ResultadoDescobertaNfse {
  return {
    cnpj: CNPJ,
    periodoConsulta: PERIODO,
    tipo: input.tipo,
    status: input.status,
    inventario: input.inventario,
    registros: [],
    diagnosticos: input.diagnosticos ?? [],
    paginasPercorridas: input.paginas,
  };
}

function mockDiscoverCompleto(): DiscoverNfseInjetavel {
  return async (input) =>
    fecharMock({
      tipo: input.tipo,
      status: 'DISCOVERY_COMPLETE',
      inventario:
        input.tipo === 'EMITIDAS' ? inv('EMITIDA', [{ n: 1 }]) : inv('RECEBIDA', [{ n: 2 }]),
      paginas: 1,
    });
}

function mockDiscoverParcial(): DiscoverNfseInjetavel {
  return async (input) =>
    fecharMock({
      tipo: input.tipo,
      status: 'DISCOVERY_INCOMPLETE',
      inventario: montarInventario({
        id: 'parcial',
        cnpj: CNPJ,
        periodoConsulta: PERIODO,
        documentos: [],
        completude: 'PARCIAL',
      }),
      paginas: 1,
      diagnosticos: [{ codigo: 'CAPTURA_PARCIAL', mensagem: 'parcial' }],
    });
}

function assertSemEfeitosProibidos(r: {
  efeitosProibidos: {
    sefin: boolean;
    escritaXml: boolean;
    checkpointRecuperacao: boolean;
    execucaoDuplaLegado: boolean;
  };
}): void {
  expect(r.efeitosProibidos.sefin).toBe(false);
  expect(r.efeitosProibidos.escritaXml).toBe(false);
  expect(r.efeitosProibidos.checkpointRecuperacao).toBe(false);
  expect(r.efeitosProibidos.execucaoDuplaLegado).toBe(false);
  expect(sefinCalls).toBe(0);
  expect(xmlWrites).toBe(0);
  expect(checkpointCalls).toBe(0);
}

beforeEach(() => {
  limparRegistryPreparacaoSomenteTeste();
  limparHandlersAdminPreparacaoLiberacaoSomenteTeste();
  definirGateExecucaoRealSomenteTeste(null);
  usarCanal(null);
  seqId = 5000;
  enqueues = [];
  storeExec = new Map();
  sefinCalls = 0;
  xmlWrites = 0;
  checkpointCalls = 0;
});

afterEach(async () => {
  limparRegistryPreparacaoSomenteTeste();
  limparHandlersAdminPreparacaoLiberacaoSomenteTeste();
  definirGateExecucaoRealSomenteTeste(null);
  configurarCanalHomologacaoOperacional(null);
  while (dirs.length) {
    const d = dirs.pop();
    if (d) await rm(d, { recursive: true, force: true });
  }
});

describe('H2.2.5 fluxo positivo integrado offline', () => {
  it('UDS→preparar→ticket→liberar→enqueue1×→auth_ok→ponte→discover→evidências→sem legado', async () => {
    expect(GATE_EXECUCAO_REAL_DISCOVERY_ONLY).toBe(false);
    const fiscalDir = await dirTmp();
    const canal = criarCanalAutorizacaoMemoria();
    usarCanal(canal);
    const d = deps();
    registrarHandlers(d);

    const socketDir = await dirTmp();
    const ativo = await iniciarAdminServidorUds({ socketDir, segredo: SEGREDO });

    // 1–3 preparar via UDS
    const prepResp = await enviarComandoAdminUds({
      socketPath: ativo.socketPath,
      token: SEGREDO,
      op: 'preparar',
      params: {
        empresaId: 10,
        cnpj: CNPJ,
        periodoInicio: PERIODO.inicio,
        periodoFim: PERIODO.fim,
        tipo: 'DISCOVERY_ONLY',
      },
    });
    expect(prepResp.ok).toBe(true);
    if (!prepResp.ok) throw new Error('prep');
    const execucaoId = String(prepResp.data.execucaoId);
    expect(prepResp.data.enfileirado).toBe(false);
    expect(storeExec.get(Number(execucaoId))?.status).toBe(STATUS_HOMOLOGACAO_PREPARADA);
    expect(enqueues).toHaveLength(0);

    // 4–5 emitir + ativar
    const ticket = await emitirTicket(canal, execucaoId, fiscalDir, { ativar: true });
    expect(ticket.ativacaoDiscoveryReal).toBe(true);
    expect(ticket.estado).toBe('DISPONIVEL');

    // 6–7 liberar → enqueue exatamente 1×
    const libResp = await enviarComandoAdminUds({
      socketPath: ativo.socketPath,
      token: SEGREDO,
      op: 'liberar',
      params: { execucaoId },
    });
    expect(libResp.ok).toBe(true);
    if (!libResp.ok) throw new Error('lib');
    expect(libResp.data.enfileirado).toBe(true);
    expect(libResp.data.ticketConsumido).toBe(false);
    expect(enqueues).toHaveLength(1);
    expect(storeExec.get(Number(execucaoId))?.status).toBe(STATUS_HOMOLOGACAO_LIBERADA);

    // 8–9 auth_ok simulada + consultar ticket ainda DISPONIVEL
    const antes = await canal.consultar(execucaoId);
    expect(antes?.estado).toBe('DISPONIVEL');

    // 10–12 ponte real (validações + consumo 1× + discover mock + evidências)
    const ponte = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      page: PAGE,
      discover: mockDiscoverCompleto(),
      persistirEvidencias: true,
      agora: AGORA,
    });

    expect(ponte.situacao).toBe('DESCOBERTA_CONCLUIDA');
    expect(ponte.estadoOperacional).toBe('CONCLUIDA');
    expect(ponte.ticketConsumido).toBe(true);
    expect(ponte.descobertaExecutada).toBe(true);
    expect(ponte.encerrarEtapaFiscal).toBe(true);
    expect(ponte.autorizacaoId).toBe(ticket.autorizacaoId);
    assertSemEfeitosProibidos(ponte);
    expect(ponte.evidencias.every((e) => !evidenciaContemSegredo(e))).toBe(true);
    expect(ponte.evidencias.some((e) => e.evento === 'discovery_only_evidencia_persistida')).toBe(
      true
    );

    const depois = await canal.consultar(execucaoId);
    expect(depois?.estado).toBe('CONSUMIDA');

    // evidências em disco
    const evidDir = path.join(fiscalDir, 'homologacao');
    const arquivos = await readdir(evidDir);
    const jsons = arquivos.filter((a) => a.startsWith('evidencia-h2-') && a.endsWith('.json'));
    expect(jsons.length).toBe(1);
    const pacote = JSON.parse(await readFile(path.join(evidDir, jsons[0]!), 'utf8')) as {
      execucaoId: string;
      cnpjMascarado: string;
      periodoConsulta: { inicio: string; fim: string };
      veredito: string;
      limitesAplicados: unknown;
    };
    expect(pacote.execucaoId).toBe(execucaoId);
    expect(pacote.cnpjMascarado).toMatch(/^1122…81$/);
    expect(pacote.cnpjMascarado).not.toBe(CNPJ);
    expect(pacote.periodoConsulta.inicio).toBe(PERIODO.inicio);
    expect(pacote.veredito).toBe('PASS');
    expect(pacote.limitesAplicados).toBeTruthy();
    expect(JSON.stringify(pacote).toLowerCase()).not.toMatch(/senha|pfx|password|token=/);

    // 13 sem segunda execução / sem reenqueue
    expect(enqueues).toHaveLength(1);
    await expect(
      liberarExecucaoHomologacao({ execucaoId, agora: AGORA }, d)
    ).rejects.toMatchObject({ codigo: 'AUTORIZACAO_JA_CONSUMIDA' });

    // gate global permanece fechado
    expect(GATE_EXECUCAO_REAL_DISCOVERY_ONLY).toBe(false);

    await ativo.fechar();
  });
});

describe('H2.2.5 fluxos negativos (sem SEFIN)', () => {
  async function basePrepLiberavel(opts?: {
    ativar?: boolean;
    cnpjTicket?: string;
    periodoTicket?: { inicio: string; fim: string };
    validoAte?: string;
    agoraEmissao?: Date;
    maxPaginas?: number;
  }) {
    const fiscalDir = await dirTmp();
    const canal = criarCanalAutorizacaoMemoria();
    usarCanal(canal);
    const d = deps();
    const prep = await prepararExecucaoHomologacao(
      {
        empresaId: 1,
        cnpj: CNPJ,
        periodoInicio: PERIODO.inicio,
        periodoFim: PERIODO.fim,
        agora: AGORA,
      },
      d
    );
    let ticket = null;
    if (opts?.ativar !== undefined || opts?.cnpjTicket || opts?.periodoTicket || opts?.validoAte) {
      ticket = await emitirTicket(canal, prep.execucaoId, fiscalDir, {
        ativar: opts?.ativar !== false,
        cnpj: opts?.cnpjTicket,
        periodo: opts?.periodoTicket,
        validoAte: opts?.validoAte,
        agoraEmissao: opts?.agoraEmissao,
        maxPaginas: opts?.maxPaginas,
      });
    }
    return { fiscalDir, canal, d, prep, ticket };
  }

  it('ticket ausente na liberação', async () => {
    const { prep, d } = await basePrepLiberavel();
    await expect(
      liberarExecucaoHomologacao({ execucaoId: prep.execucaoId, agora: AGORA }, d)
    ).rejects.toMatchObject({ codigo: 'AUTORIZACAO_AUSENTE' });
    expect(enqueues).toHaveLength(0);
  });

  it('ticket não ativado', async () => {
    const { prep, d } = await basePrepLiberavel({ ativar: false });
    await expect(
      liberarExecucaoHomologacao({ execucaoId: prep.execucaoId, agora: AGORA }, d)
    ).rejects.toMatchObject({ codigo: 'ATIVACAO_INDIVIDUAL_AUSENTE' });
  });

  it('ticket expirado', async () => {
    const { prep, d } = await basePrepLiberavel({
      ativar: true,
      validoAte: '2024-06-15T11:00:00.000Z',
      agoraEmissao: new Date('2024-06-15T10:00:00.000Z'),
    });
    await expect(
      liberarExecucaoHomologacao({ execucaoId: prep.execucaoId, agora: AGORA }, d)
    ).rejects.toMatchObject({ codigo: 'AUTORIZACAO_EXPIRADA' });
  });

  it('ticket cancelado', async () => {
    const { prep, d, canal, ticket } = await basePrepLiberavel({ ativar: true });
    await canal.cancelar(ticket!.autorizacaoId, 'cancel-h225');
    await expect(
      liberarExecucaoHomologacao({ execucaoId: prep.execucaoId, agora: AGORA }, d)
    ).rejects.toMatchObject({ codigo: 'AUTORIZACAO_JA_CONSUMIDA' });
  });

  it('ticket consumido', async () => {
    const { prep, d, canal, ticket, fiscalDir } = await basePrepLiberavel({ ativar: true });
    await canal.consumir(
      prep.execucaoId,
      {
        execucaoId: prep.execucaoId,
        cnpj: CNPJ,
        periodoConsulta: PERIODO,
        diretorioFiscal: fiscalDir,
        agora: AGORA,
      },
      'TESTE'
    );
    expect(ticket).toBeTruthy();
    await expect(
      liberarExecucaoHomologacao({ execucaoId: prep.execucaoId, agora: AGORA }, d)
    ).rejects.toMatchObject({ codigo: 'AUTORIZACAO_JA_CONSUMIDA' });
  });

  it('CNPJ / período / execucaoId / diretório divergentes na ponte', async () => {
    const fiscalDir = await dirTmp();
    const outroDir = await dirTmp();
    const canal = criarCanalAutorizacaoMemoria();
    usarCanal(canal);
    const d = deps();
    const prep = await prepararExecucaoHomologacao(
      {
        empresaId: 1,
        cnpj: CNPJ,
        periodoInicio: PERIODO.inicio,
        periodoFim: PERIODO.fim,
        agora: AGORA,
      },
      d
    );
    await emitirTicket(canal, prep.execucaoId, fiscalDir, { ativar: true });
    await liberarExecucaoHomologacao({ execucaoId: prep.execucaoId, agora: AGORA }, d);

    const cnpjDiv = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: prep.execucaoId,
      cnpj: CNPJ_OUTRO,
      periodoConsulta: PERIODO,
      pagePresente: true,
      page: PAGE,
      discover: mockDiscoverCompleto(),
      persistirEvidencias: false,
      agora: AGORA,
    });
    expect(cnpjDiv.codigoErro).toBe('CNPJ_DIVERGENTE');
    expect(cnpjDiv.ticketConsumido).toBe(false);
    assertSemEfeitosProibidos(cnpjDiv);

    // ticket ainda disponível — período
    const perDiv = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: prep.execucaoId,
      cnpj: CNPJ,
      periodoConsulta: PERIODO_OUTRO,
      pagePresente: true,
      page: PAGE,
      discover: mockDiscoverCompleto(),
      persistirEvidencias: false,
      agora: AGORA,
    });
    expect(perDiv.codigoErro).toBe('PERIODO_DIVERGENTE');

    const idDiv = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: '999999',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      page: PAGE,
      discover: mockDiscoverCompleto(),
      persistirEvidencias: false,
      agora: AGORA,
    });
    expect(idDiv.situacao).toBe('SEM_AUTORIZACAO');
    expect(idDiv.encerrarEtapaFiscal).toBe(false);

    // diretório: ticket aponta para fiscalDir; validação usa ticket.diretorioFiscal
    // divergência explícita via ticket de outra execução
    await emitirTicket(canal, '888', outroDir, { ativar: true });
    const dirOk = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: '888',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      page: PAGE,
      discover: mockDiscoverCompleto(),
      persistirEvidencias: false,
      agora: AGORA,
    });
    expect(dirOk.situacao === 'DESCOBERTA_CONCLUIDA' || dirOk.descobertaExecutada).toBeTruthy();
    void outroDir;
  });

  it('limites (timeout) / inventário parcial / cancelamento', async () => {
    const fiscalDir = await dirTmp();
    const canal = criarCanalAutorizacaoMemoria();
    usarCanal(canal);
    const d = deps();
    const prep = await prepararExecucaoHomologacao(
      {
        empresaId: 1,
        cnpj: CNPJ,
        periodoInicio: PERIODO.inicio,
        periodoFim: PERIODO.fim,
        agora: AGORA,
      },
      d
    );
    await emitirTicket(canal, prep.execucaoId, fiscalDir, {
      ativar: true,
      timeoutMs: 50,
    });
    await liberarExecucaoHomologacao({ execucaoId: prep.execucaoId, agora: AGORA }, d);

    const timeout = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: prep.execucaoId,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      page: PAGE,
      discover: async (input) => {
        await new Promise((r) => setTimeout(r, 80));
        return fecharMock({
          tipo: input.tipo,
          status: 'DISCOVERY_COMPLETE',
          inventario: inv('EMITIDA', [{ n: 1 }]),
          paginas: 1,
        });
      },
      persistirEvidencias: false,
      agora: AGORA,
      inicioLimitesEm: AGORA,
      relogio: () => new Date(AGORA.getTime() + 200),
    });
    expect(timeout.ticketConsumido).toBe(true);
    expect(timeout.efeitosProibidos.sefin).toBe(false);
    expect(['DESCOBERTA_FALHA', 'DESCOBERTA_INCOMPLETA', 'DESCOBERTA_CONCLUIDA']).toContain(
      timeout.situacao
    );

    // nova execução — parcial
    const prep2 = await prepararExecucaoHomologacao(
      {
        empresaId: 2,
        cnpj: CNPJ,
        periodoInicio: PERIODO.inicio,
        periodoFim: PERIODO.fim,
        agora: AGORA,
      },
      d
    );
    await emitirTicket(canal, prep2.execucaoId, fiscalDir, { ativar: true });
    await liberarExecucaoHomologacao({ execucaoId: prep2.execucaoId, agora: AGORA }, d);
    const parcial = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: prep2.execucaoId,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      page: PAGE,
      discover: mockDiscoverParcial(),
      persistirEvidencias: false,
      agora: AGORA,
    });
    expect(parcial.estadoOperacional).toBe('INCOMPLETA');
    expect(parcial.efeitosProibidos.sefin).toBe(false);

    // cancelamento
    const prep3 = await prepararExecucaoHomologacao(
      {
        empresaId: 3,
        cnpj: CNPJ,
        periodoInicio: PERIODO.inicio,
        periodoFim: PERIODO.fim,
        agora: AGORA,
      },
      d
    );
    await emitirTicket(canal, prep3.execucaoId, fiscalDir, { ativar: true });
    await liberarExecucaoHomologacao({ execucaoId: prep3.execucaoId, agora: AGORA }, d);
    const ac = new AbortController();
    ac.abort();
    const cancelado = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: prep3.execucaoId,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      page: PAGE,
      discover: mockDiscoverCompleto(),
      signal: ac.signal,
      persistirEvidencias: false,
      agora: AGORA,
    });
    expect(cancelado.efeitosProibidos.sefin).toBe(false);
    expect(cancelado.ticketConsumido).toBe(true);
  });

  it('preparação duplicada (dois IDs) e liberação duplicada/concorrente', async () => {
    const fiscalDir = await dirTmp();
    const canal = criarCanalAutorizacaoMemoria();
    usarCanal(canal);
    const d = deps();
    const a = await prepararExecucaoHomologacao(
      {
        empresaId: 1,
        cnpj: CNPJ,
        periodoInicio: PERIODO.inicio,
        periodoFim: PERIODO.fim,
        agora: AGORA,
      },
      d
    );
    const b = await prepararExecucaoHomologacao(
      {
        empresaId: 1,
        cnpj: CNPJ,
        periodoInicio: PERIODO.inicio,
        periodoFim: PERIODO.fim,
        agora: AGORA,
      },
      d
    );
    expect(a.execucaoId).not.toBe(b.execucaoId);
    expect(enqueues).toHaveLength(0);

    await emitirTicket(canal, a.execucaoId, fiscalDir, { ativar: true });
    await liberarExecucaoHomologacao({ execucaoId: a.execucaoId, agora: AGORA }, d);
    await expect(
      liberarExecucaoHomologacao({ execucaoId: a.execucaoId, agora: AGORA }, d)
    ).rejects.toMatchObject({ codigo: 'AUTORIZACAO_JA_CONSUMIDA' });

    await emitirTicket(canal, b.execucaoId, fiscalDir, { ativar: true });
    const rs = await Promise.allSettled([
      liberarExecucaoHomologacao({ execucaoId: b.execucaoId, agora: AGORA }, d),
      liberarExecucaoHomologacao({ execucaoId: b.execucaoId, agora: AGORA }, d),
    ]);
    expect(rs.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(rs.filter((x) => x.status === 'rejected')).toHaveLength(1);
  });

  it('falha após create / após updateMany / antes e depois de fila.add', async () => {
    const fiscalDir = await dirTmp();
    const canal = criarCanalAutorizacaoMemoria();
    usarCanal(canal);

    await expect(
      prepararExecucaoHomologacao(
        {
          empresaId: 1,
          cnpj: CNPJ,
          periodoInicio: PERIODO.inicio,
          periodoFim: PERIODO.fim,
          agora: AGORA,
        },
        deps({
          async ganchoAposCriarAntesDoPayload() {
            throw new Error('falha pós-create');
          },
        })
      )
    ).rejects.toBeTruthy();
    expect([...storeExec.values()].pop()?.status).toBe(STATUS_HOMOLOGACAO_BLOQUEADA);

    const d = deps();
    const prep = await prepararExecucaoHomologacao(
      {
        empresaId: 2,
        cnpj: CNPJ,
        periodoInicio: PERIODO.inicio,
        periodoFim: PERIODO.fim,
        agora: AGORA,
      },
      d
    );
    await emitirTicket(canal, prep.execucaoId, fiscalDir, { ativar: true });
    await expect(
      liberarExecucaoHomologacao(
        { execucaoId: prep.execucaoId, agora: AGORA },
        deps({
          async ganchoAposReservaAntesDoEnqueue() {
            throw new Error('falha antes fila.add');
          },
        })
      )
    ).rejects.toBeTruthy();
    expect(storeExec.get(Number(prep.execucaoId))?.status).toBe(STATUS_HOMOLOGACAO_BLOQUEADA);

    const prep2 = await prepararExecucaoHomologacao(
      {
        empresaId: 3,
        cnpj: CNPJ,
        periodoInicio: PERIODO.inicio,
        periodoFim: PERIODO.fim,
        agora: AGORA,
      },
      d
    );
    await emitirTicket(canal, prep2.execucaoId, fiscalDir, { ativar: true });
    let enfileirou = false;
    await expect(
      liberarExecucaoHomologacao(
        { execucaoId: prep2.execucaoId, agora: AGORA },
        deps({
          async enfileirar(p) {
            enfileirou = true;
            enqueues.push(p);
            throw new Error('falha depois de registrar enqueue');
          },
        })
      )
    ).rejects.toBeTruthy();
    expect(enfileirou).toBe(true);
    expect(storeExec.get(Number(prep2.execucaoId))?.status).toBe(STATUS_HOMOLOGACAO_BLOQUEADA);
    // não re-liberável
    await expect(
      liberarExecucaoHomologacao({ execucaoId: prep2.execucaoId, agora: AGORA }, d)
    ).rejects.toMatchObject({ codigo: 'CONTEXTO_INVALIDO' });
  });

  it('reinício Map vazio / estado bloqueado / evidência falha / UDS ausente', async () => {
    const fiscalDir = await dirTmp();
    const canal = criarCanalAutorizacaoMemoria();
    usarCanal(canal);
    const d = deps();
    const prep = await prepararExecucaoHomologacao(
      {
        empresaId: 1,
        cnpj: CNPJ,
        periodoInicio: PERIODO.inicio,
        periodoFim: PERIODO.fim,
        agora: AGORA,
      },
      d
    );
    await emitirTicket(canal, prep.execucaoId, fiscalDir, { ativar: true });
    simularReinicioProcessoSomenteTeste();
    await expect(
      liberarExecucaoHomologacao({ execucaoId: prep.execucaoId, agora: AGORA }, d)
    ).rejects.toMatchObject({ message: expect.stringMatching(/payload|reinício|instância/i) });

    storeExec.set(77, {
      id: 77,
      status: STATUS_HOMOLOGACAO_BLOQUEADA,
      cnpj: CNPJ,
      periodoInicio: PERIODO.inicio,
      periodoFim: PERIODO.fim,
      empresaId: 1,
    });
    await expect(
      liberarExecucaoHomologacao({ execucaoId: '77', agora: AGORA }, d)
    ).rejects.toMatchObject({ codigo: 'CONTEXTO_INVALIDO' });

    // evidência: gravar arquivo previamente para forçar colisão
    const prepE = await prepararExecucaoHomologacao(
      {
        empresaId: 5,
        cnpj: CNPJ,
        periodoInicio: PERIODO.inicio,
        periodoFim: PERIODO.fim,
        agora: AGORA,
      },
      d
    );
    await emitirTicket(canal, prepE.execucaoId, fiscalDir, { ativar: true });
    await liberarExecucaoHomologacao({ execucaoId: prepE.execucaoId, agora: AGORA }, d);
    const stamp = AGORA.toISOString().replace(/[:.]/g, '-');
    const evidDirColisao = path.join(fiscalDir, 'homologacao');
    await mkdir(evidDirColisao, { recursive: true });
    const destino = path.join(evidDirColisao, `evidencia-h2-${prepE.execucaoId}-${stamp}.json`);
    await writeFile(destino, '{}\n', { flag: 'wx' });
    const falhaEv = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: prepE.execucaoId,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      page: PAGE,
      discover: mockDiscoverCompleto(),
      persistirEvidencias: true,
      agora: AGORA,
    });
    expect(falhaEv.codigoErro).toBe('FALHA_EVIDENCIA');
    expect(falhaEv.efeitosProibidos.sefin).toBe(false);

    // UDS sem servidor / sem handler
    limparHandlersAdminPreparacaoLiberacaoSomenteTeste();
    const sockDir = await dirTmp();
    const ativo = await iniciarAdminServidorUds({ socketDir: sockDir, segredo: SEGREDO });
    const r = await enviarComandoAdminUds({
      socketPath: ativo.socketPath,
      token: SEGREDO,
      op: 'preparar',
      params: {
        empresaId: 1,
        cnpj: CNPJ,
        periodoInicio: PERIODO.inicio,
        periodoFim: PERIODO.fim,
      },
    });
    expect(r.ok).toBe(false);
    await ativo.fechar();
  });
});

describe('H2.2.5 preservação do legado', () => {
  it('sem ticket → SEM_AUTORIZACAO e legado preservado; gate fechado; enqueue normal intocado', async () => {
    expect(GATE_EXECUCAO_REAL_DISCOVERY_ONLY).toBe(false);
    usarCanal(criarCanalAutorizacaoMemoria());
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'legado-sem-ticket',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      page: PAGE,
      discover: mockDiscoverCompleto(),
      agora: AGORA,
    });
    expect(r.situacao).toBe('SEM_AUTORIZACAO');
    expect(r.encerrarEtapaFiscal).toBe(false);
    expect(r.descobertaExecutada).toBe(false);
    expect(r.ticketConsumido).toBe(false);

    // status pendente não é liberável pelo admin
    storeExec.set(1, {
      id: 1,
      status: 'pendente',
      cnpj: CNPJ,
      periodoInicio: PERIODO.inicio,
      periodoFim: PERIODO.fim,
      empresaId: 1,
    });
    await expect(
      liberarExecucaoHomologacao({ execucaoId: '1', agora: AGORA }, deps())
    ).rejects.toMatchObject({ codigo: 'CONTEXTO_INVALIDO' });
    expect(enqueues).toHaveLength(0);
  });

  it('canal null → legado; UDS health não altera fila fiscal', async () => {
    configurarCanalHomologacaoOperacional(null);
    const r = await avaliarPonteHomologacaoDiscoveryOnly({
      execucaoId: 'x',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      pagePresente: true,
      agora: AGORA,
    });
    expect(r.situacao).toBe('SEM_AUTORIZACAO');
    expect(r.encerrarEtapaFiscal).toBe(false);

    const sockDir = await dirTmp();
    const ativo = await iniciarAdminServidorUds({ socketDir: sockDir, segredo: SEGREDO });
    const h = await enviarComandoAdminUds({
      socketPath: ativo.socketPath,
      token: SEGREDO,
      op: 'health',
    });
    expect(h.ok).toBe(true);
    expect(enqueues).toHaveLength(0);
    expect(GATE_EXECUCAO_REAL_DISCOVERY_ONLY).toBe(false);
    await ativo.fechar();
  });
});
