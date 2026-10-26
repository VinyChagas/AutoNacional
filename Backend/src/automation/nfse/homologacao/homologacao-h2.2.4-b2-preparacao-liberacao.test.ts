/**
 * H2.2.4-B2 — Preparação e liberação controlada (offline).
 * Sem Portal, SEFIN, navegador, login, certificado, descoberta, XML, checkpoint, gate global.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { criarPeriodoConsultaPortal } from '../contracts/periodo';
import {
  configurarCanalHomologacaoOperacional,
  criarAutorizacaoHomologacao,
  criarAutorizacaoId,
  criarCanalAutorizacaoMemoria,
  criarLimitesHomologacao,
  definirGateExecucaoRealSomenteTeste,
  GATE_EXECUCAO_REAL_DISCOVERY_ONLY,
  HomologacaoNfseError,
  liberarExecucaoHomologacao,
  limparRegistryPreparacaoSomenteTeste,
  obterPayloadPreparacao,
  prepararExecucaoHomologacao,
  simularReinicioProcessoSomenteTeste,
  STATUS_HOMOLOGACAO_BLOQUEADA,
  STATUS_HOMOLOGACAO_LIBERADA,
  STATUS_HOMOLOGACAO_PREPARADA,
  type CanalAutorizacaoHomologacao,
  type DependenciasPreparacaoLiberacao,
  type PayloadExecucaoHomologacao,
} from './index';
import {
  limparHandlersAdminPreparacaoLiberacaoSomenteTeste,
  registrarHandlersAdminPreparacaoLiberacao,
  enviarComandoAdminUds,
  iniciarAdminServidorUds,
} from './admin';

const CNPJ = '11222333000181';
const CNPJ_OUTRO = '99888777000166';
const PERIODO = criarPeriodoConsultaPortal('01/01/2024', '31/01/2024');
const AGORA = new Date('2024-06-15T12:00:00.000Z');
const VALIDO_ATE = '2024-06-16T12:00:00.000Z';
const SEGREDO = 'x'.repeat(32) + '-admin-b2-secret-ok';

const dirs: string[] = [];
let seqId = 1000;
let enqueues: PayloadExecucaoHomologacao[] = [];
let storeExec: Map<
  number,
  {
    id: number;
    status: string;
    cnpj: string | null;
    periodoInicio: string | null;
    periodoFim: string | null;
    empresaId: number;
  }
> = new Map();

let canalAtual: CanalAutorizacaoHomologacao | null = null;

function usarCanal(c: CanalAutorizacaoHomologacao | null): void {
  canalAtual = c;
  configurarCanalHomologacaoOperacional(c);
}

function depsComCanal(
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
  const d = await mkdtemp(path.join(tmpdir(), 'an-h224b2-'));
  dirs.push(d);
  return d;
}

async function emitirAtivar(
  canal: CanalAutorizacaoHomologacao,
  execucaoId: string,
  opts?: {
    cnpj?: string;
    periodo?: { inicio: string; fim: string };
    ativar?: boolean;
    validoAte?: string;
    maxPaginas?: number;
    /** Relógio na emissão (para tickets que expirarão depois). */
    agoraEmissao?: Date;
  }
) {
  const dir = await dirTmp();
  const agoraEmissao = opts?.agoraEmissao ?? AGORA;
  const auth = criarAutorizacaoHomologacao({
    cnpj: opts?.cnpj ?? CNPJ,
    periodoConsulta: opts?.periodo
      ? criarPeriodoConsultaPortal(opts.periodo.inicio, opts.periodo.fim)
      : PERIODO,
    execucaoId,
    operacao: 'DISCOVERY_ONLY',
    validoAte: opts?.validoAte ?? VALIDO_ATE,
    diretorioFiscal: dir,
    limites: criarLimitesHomologacao({
      maxDocumentos: 10,
      maxPaginas: opts?.maxPaginas ?? 5,
      maxRequisicoesSefin: 0,
      timeoutMs: 30_000,
    }),
    motivo: 'b2-teste',
    agora: agoraEmissao,
  });
  const ticket = await canal.emitir({
    versao: 1,
    autorizacaoId: criarAutorizacaoId(),
    autorizacao: auth,
    emitidoEm: agoraEmissao.toISOString(),
  });
  if (opts?.ativar !== false) {
    await canal.ativarDiscoveryReal(ticket.autorizacaoId, 'b2-ativar', agoraEmissao);
  }
  return ticket;
}

beforeEach(() => {
  limparRegistryPreparacaoSomenteTeste();
  limparHandlersAdminPreparacaoLiberacaoSomenteTeste();
  definirGateExecucaoRealSomenteTeste(null);
  usarCanal(null);
  seqId = 1000;
  enqueues = [];
  storeExec = new Map();
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

describe('H2.2.4-B2 preparação e liberação offline', () => {
  it('01 preparação válida', async () => {
    const r = await prepararExecucaoHomologacao(
      {
        empresaId: 1,
        cnpj: CNPJ,
        periodoInicio: PERIODO.inicio,
        periodoFim: PERIODO.fim,
        tipo: 'DISCOVERY_ONLY',
        agora: AGORA,
      },
      depsComCanal()
    );
    expect(r.status).toBe(STATUS_HOMOLOGACAO_PREPARADA);
    expect(r.enfileirado).toBe(false);
    expect(r.navegadorIniciado).toBe(false);
    expect(r.loginIniciado).toBe(false);
    expect(r.descobertaIniciada).toBe(false);
    expect(storeExec.get(Number(r.execucaoId))?.status).toBe(STATUS_HOMOLOGACAO_PREPARADA);
  });

  it('02 preparação inválida (CNPJ / período / tipo)', async () => {
    await expect(
      prepararExecucaoHomologacao(
        {
          empresaId: 1,
          cnpj: '123',
          periodoInicio: PERIODO.inicio,
          periodoFim: PERIODO.fim,
        },
        depsComCanal()
      )
    ).rejects.toMatchObject({ codigo: 'AUTORIZACAO_MALFORMADA' });

    await expect(
      prepararExecucaoHomologacao(
        {
          empresaId: 1,
          cnpj: CNPJ,
          periodoInicio: '2024-01-01',
          periodoFim: PERIODO.fim,
        },
        depsComCanal()
      )
    ).rejects.toMatchObject({ codigo: 'CONTEXTO_INVALIDO' });

    await expect(
      prepararExecucaoHomologacao(
        {
          empresaId: 1,
          cnpj: CNPJ,
          periodoInicio: PERIODO.inicio,
          periodoFim: PERIODO.fim,
          tipo: 'SEFIN_RECOVERY',
        },
        depsComCanal()
      )
    ).rejects.toMatchObject({ codigo: 'OPERACAO_NAO_AUTORIZADA' });
  });

  it('03 preparação sem enqueue', async () => {
    await prepararExecucaoHomologacao(
      {
        empresaId: 1,
        cnpj: CNPJ,
        periodoInicio: PERIODO.inicio,
        periodoFim: PERIODO.fim,
        agora: AGORA,
      },
      depsComCanal()
    );
    expect(enqueues).toHaveLength(0);
  });

  it('04 obtenção de execucaoId', async () => {
    const r = await prepararExecucaoHomologacao(
      {
        empresaId: 7,
        cnpj: CNPJ,
        periodoInicio: PERIODO.inicio,
        periodoFim: PERIODO.fim,
        agora: AGORA,
      },
      depsComCanal()
    );
    expect(r.execucaoId).toMatch(/^\d+$/);
    expect(obterPayloadPreparacao(r.execucaoId)?.empresaId).toBe(7);
  });

  it('05 ticket válido → liberação', async () => {
    const canal = criarCanalAutorizacaoMemoria();
    usarCanal(canal);
    const prep = await prepararExecucaoHomologacao(
      {
        empresaId: 1,
        cnpj: CNPJ,
        periodoInicio: PERIODO.inicio,
        periodoFim: PERIODO.fim,
        agora: AGORA,
      },
      depsComCanal()
    );
    await emitirAtivar(canal, prep.execucaoId);
    const lib = await liberarExecucaoHomologacao(
      { execucaoId: prep.execucaoId, agora: AGORA },
      depsComCanal()
    );
    expect(lib.enfileirado).toBe(true);
    expect(lib.ticketConsumido).toBe(false);
    expect(lib.status).toBe(STATUS_HOMOLOGACAO_LIBERADA);
    expect(enqueues).toHaveLength(1);
    expect((await canal.consultar(prep.execucaoId))?.estado).toBe('DISPONIVEL');
  });

  it('06 ticket não ativado', async () => {
    const canal = criarCanalAutorizacaoMemoria();
    usarCanal(canal);
    const prep = await prepararExecucaoHomologacao(
      {
        empresaId: 1,
        cnpj: CNPJ,
        periodoInicio: PERIODO.inicio,
        periodoFim: PERIODO.fim,
        agora: AGORA,
      },
      depsComCanal()
    );
    await emitirAtivar(canal, prep.execucaoId, { ativar: false });
    await expect(
      liberarExecucaoHomologacao({ execucaoId: prep.execucaoId, agora: AGORA }, depsComCanal())
    ).rejects.toMatchObject({ codigo: 'ATIVACAO_INDIVIDUAL_AUSENTE' });
    expect(enqueues).toHaveLength(0);
  });

  it('07 ticket expirado', async () => {
    const canal = criarCanalAutorizacaoMemoria();
    usarCanal(canal);
    const prep = await prepararExecucaoHomologacao(
      {
        empresaId: 1,
        cnpj: CNPJ,
        periodoInicio: PERIODO.inicio,
        periodoFim: PERIODO.fim,
        agora: AGORA,
      },
      depsComCanal()
    );
    await emitirAtivar(canal, prep.execucaoId, {
      validoAte: '2024-06-15T11:00:00.000Z',
      agoraEmissao: new Date('2024-06-15T10:00:00.000Z'),
    });
    await expect(
      liberarExecucaoHomologacao({ execucaoId: prep.execucaoId, agora: AGORA }, depsComCanal())
    ).rejects.toMatchObject({ codigo: 'AUTORIZACAO_EXPIRADA' });
    expect(enqueues).toHaveLength(0);
  });

  it('08 ticket cancelado', async () => {
    const canal = criarCanalAutorizacaoMemoria();
    usarCanal(canal);
    const prep = await prepararExecucaoHomologacao(
      {
        empresaId: 1,
        cnpj: CNPJ,
        periodoInicio: PERIODO.inicio,
        periodoFim: PERIODO.fim,
        agora: AGORA,
      },
      depsComCanal()
    );
    const t = await emitirAtivar(canal, prep.execucaoId);
    await canal.cancelar(t.autorizacaoId, 'cancel-b2');
    await expect(
      liberarExecucaoHomologacao({ execucaoId: prep.execucaoId, agora: AGORA }, depsComCanal())
    ).rejects.toMatchObject({ codigo: 'AUTORIZACAO_JA_CONSUMIDA' });
  });

  it('09 ticket consumido', async () => {
    const canal = criarCanalAutorizacaoMemoria();
    usarCanal(canal);
    const prep = await prepararExecucaoHomologacao(
      {
        empresaId: 1,
        cnpj: CNPJ,
        periodoInicio: PERIODO.inicio,
        periodoFim: PERIODO.fim,
        agora: AGORA,
      },
      depsComCanal()
    );
    const t = await emitirAtivar(canal, prep.execucaoId);
    await canal.consumir(
      prep.execucaoId,
      {
        execucaoId: prep.execucaoId,
        cnpj: CNPJ,
        periodoConsulta: PERIODO,
        diretorioFiscal: t.autorizacao.diretorioFiscal,
        agora: AGORA,
      },
      'TESTE'
    );
    await expect(
      liberarExecucaoHomologacao({ execucaoId: prep.execucaoId, agora: AGORA }, depsComCanal())
    ).rejects.toMatchObject({ codigo: 'AUTORIZACAO_JA_CONSUMIDA' });
  });

  it('10 escopo divergente (CNPJ)', async () => {
    const canal = criarCanalAutorizacaoMemoria();
    usarCanal(canal);
    const prep = await prepararExecucaoHomologacao(
      {
        empresaId: 1,
        cnpj: CNPJ,
        periodoInicio: PERIODO.inicio,
        periodoFim: PERIODO.fim,
        agora: AGORA,
      },
      depsComCanal()
    );
    await emitirAtivar(canal, prep.execucaoId, { cnpj: CNPJ_OUTRO });
    await expect(
      liberarExecucaoHomologacao({ execucaoId: prep.execucaoId, agora: AGORA }, depsComCanal())
    ).rejects.toMatchObject({ codigo: 'CNPJ_DIVERGENTE' });
    expect(enqueues).toHaveLength(0);
  });

  it('11 liberação válida (já coberto em 05 — reforço estado)', async () => {
    const canal = criarCanalAutorizacaoMemoria();
    usarCanal(canal);
    const prep = await prepararExecucaoHomologacao(
      {
        empresaId: 2,
        cnpj: CNPJ,
        periodoInicio: PERIODO.inicio,
        periodoFim: PERIODO.fim,
        agora: AGORA,
      },
      depsComCanal()
    );
    await emitirAtivar(canal, prep.execucaoId);
    const lib = await liberarExecucaoHomologacao(
      { execucaoId: prep.execucaoId, agora: AGORA },
      depsComCanal()
    );
    expect(storeExec.get(Number(prep.execucaoId))?.status).toBe(STATUS_HOMOLOGACAO_LIBERADA);
    expect(lib.autorizacaoId).toBeTruthy();
  });

  it('12 liberação duplicada', async () => {
    const canal = criarCanalAutorizacaoMemoria();
    usarCanal(canal);
    const prep = await prepararExecucaoHomologacao(
      {
        empresaId: 1,
        cnpj: CNPJ,
        periodoInicio: PERIODO.inicio,
        periodoFim: PERIODO.fim,
        agora: AGORA,
      },
      depsComCanal()
    );
    await emitirAtivar(canal, prep.execucaoId);
    await liberarExecucaoHomologacao({ execucaoId: prep.execucaoId, agora: AGORA }, depsComCanal());
    await expect(
      liberarExecucaoHomologacao({ execucaoId: prep.execucaoId, agora: AGORA }, depsComCanal())
    ).rejects.toMatchObject({ codigo: 'AUTORIZACAO_JA_CONSUMIDA' });
    expect(enqueues).toHaveLength(1);
  });

  it('13 liberação concorrente', async () => {
    const canal = criarCanalAutorizacaoMemoria();
    usarCanal(canal);
    const prep = await prepararExecucaoHomologacao(
      {
        empresaId: 1,
        cnpj: CNPJ,
        periodoInicio: PERIODO.inicio,
        periodoFim: PERIODO.fim,
        agora: AGORA,
      },
      depsComCanal()
    );
    await emitirAtivar(canal, prep.execucaoId);
    const d = depsComCanal();
    const resultados = await Promise.allSettled([
      liberarExecucaoHomologacao({ execucaoId: prep.execucaoId, agora: AGORA }, d),
      liberarExecucaoHomologacao({ execucaoId: prep.execucaoId, agora: AGORA }, d),
    ]);
    const oks = resultados.filter((x) => x.status === 'fulfilled');
    const fails = resultados.filter((x) => x.status === 'rejected');
    expect(oks).toHaveLength(1);
    expect(fails).toHaveLength(1);
    expect(enqueues).toHaveLength(1);
  });

  it('14 falha antes de enqueue (validação)', async () => {
    await expect(
      liberarExecucaoHomologacao({ execucaoId: '99999', agora: AGORA }, depsComCanal())
    ).rejects.toMatchObject({ codigo: 'CONTEXTO_INVALIDO' });
    expect(enqueues).toHaveLength(0);
  });

  it('15 falha depois de updateMany / no enqueue → bloqueada', async () => {
    const canal = criarCanalAutorizacaoMemoria();
    usarCanal(canal);
    const prep = await prepararExecucaoHomologacao(
      {
        empresaId: 1,
        cnpj: CNPJ,
        periodoInicio: PERIODO.inicio,
        periodoFim: PERIODO.fim,
        agora: AGORA,
      },
      depsComCanal()
    );
    await emitirAtivar(canal, prep.execucaoId);
    await expect(
      liberarExecucaoHomologacao(
        { execucaoId: prep.execucaoId, agora: AGORA },
        depsComCanal({
          async enfileirar() {
            throw new Error('fila indisponível');
          },
        })
      )
    ).rejects.toMatchObject({ codigo: 'CONTEXTO_INVALIDO' });
    expect(storeExec.get(Number(prep.execucaoId))?.status).toBe(STATUS_HOMOLOGACAO_BLOQUEADA);
    expect(obterPayloadPreparacao(prep.execucaoId)).toBeUndefined();
    expect(enqueues).toHaveLength(0);
    // Segunda tentativa após falha — recusa; sem reenqueue
    await expect(
      liberarExecucaoHomologacao({ execucaoId: prep.execucaoId, agora: AGORA }, depsComCanal())
    ).rejects.toMatchObject({ codigo: 'CONTEXTO_INVALIDO' });
  });

  it('16 reinício — payload perdido', async () => {
    const canal = criarCanalAutorizacaoMemoria();
    usarCanal(canal);
    const prep = await prepararExecucaoHomologacao(
      {
        empresaId: 1,
        cnpj: CNPJ,
        periodoInicio: PERIODO.inicio,
        periodoFim: PERIODO.fim,
        agora: AGORA,
      },
      depsComCanal()
    );
    await emitirAtivar(canal, prep.execucaoId);
    simularReinicioProcessoSomenteTeste();
    await expect(
      liberarExecucaoHomologacao({ execucaoId: prep.execucaoId, agora: AGORA }, depsComCanal())
    ).rejects.toMatchObject({
      codigo: 'CONTEXTO_INVALIDO',
      message: expect.stringContaining('Reconciliação manual'),
    });
    expect(enqueues).toHaveLength(0);
    expect(storeExec.get(Number(prep.execucaoId))?.status).toBe(STATUS_HOMOLOGACAO_PREPARADA);
  });

  it('17 estado incerto (já iniciada / finalizada)', async () => {
    const canal = criarCanalAutorizacaoMemoria();
    usarCanal(canal);
    const prep = await prepararExecucaoHomologacao(
      {
        empresaId: 1,
        cnpj: CNPJ,
        periodoInicio: PERIODO.inicio,
        periodoFim: PERIODO.fim,
        agora: AGORA,
      },
      depsComCanal()
    );
    await emitirAtivar(canal, prep.execucaoId);
    storeExec.set(Number(prep.execucaoId), {
      ...storeExec.get(Number(prep.execucaoId))!,
      status: 'em_andamento',
    });
    await expect(
      liberarExecucaoHomologacao({ execucaoId: prep.execucaoId, agora: AGORA }, depsComCanal())
    ).rejects.toMatchObject({ codigo: 'CONTEXTO_INVALIDO' });

    storeExec.set(Number(prep.execucaoId), {
      ...storeExec.get(Number(prep.execucaoId))!,
      status: 'concluido',
    });
    await expect(
      liberarExecucaoHomologacao({ execucaoId: prep.execucaoId, agora: AGORA }, depsComCanal())
    ).rejects.toMatchObject({ codigo: 'CONTEXTO_INVALIDO' });
  });

  it('18 legado preservado (sem ticket / gate fechado / status pendente intocado)', async () => {
    expect(GATE_EXECUCAO_REAL_DISCOVERY_ONLY).toBe(false);
    usarCanal(criarCanalAutorizacaoMemoria());
    storeExec.set(42, {
      id: 42,
      status: 'pendente',
      cnpj: CNPJ,
      periodoInicio: PERIODO.inicio,
      periodoFim: PERIODO.fim,
      empresaId: 1,
    });
    await expect(
      liberarExecucaoHomologacao({ execucaoId: '42', agora: AGORA }, depsComCanal())
    ).rejects.toMatchObject({ codigo: 'CONTEXTO_INVALIDO' });
    expect(storeExec.get(42)?.status).toBe('pendente');
    expect(enqueues).toHaveLength(0);
  });

  it('19–24 nenhum efeito fiscal real (navegador/SEFIN/descoberta/XML/checkpoint/gate)', async () => {
    expect(GATE_EXECUCAO_REAL_DISCOVERY_ONLY).toBe(false);
    const canal = criarCanalAutorizacaoMemoria();
    usarCanal(canal);
    const prep = await prepararExecucaoHomologacao(
      {
        empresaId: 1,
        cnpj: CNPJ,
        periodoInicio: PERIODO.inicio,
        periodoFim: PERIODO.fim,
        agora: AGORA,
      },
      depsComCanal()
    );
    await emitirAtivar(canal, prep.execucaoId);
    await liberarExecucaoHomologacao({ execucaoId: prep.execucaoId, agora: AGORA }, depsComCanal());
    expect(prep.navegadorIniciado).toBe(false);
    expect(prep.descobertaIniciada).toBe(false);
    // enqueue mock não abre browser
    expect(enqueues[0]?.execucaoId).toBe(prep.execucaoId);
    expect((await canal.consultar(prep.execucaoId))?.estado).toBe('DISPONIVEL');
    expect((await canal.consultar(prep.execucaoId))?.autorizacao.limites.maxRequisicoesSefin).toBe(
      0
    );
  });

  it('admin UDS preparar/liberar com handlers injetados', async () => {
    const canal = criarCanalAutorizacaoMemoria();
    usarCanal(canal);
    const d = depsComCanal();
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

    const dir = await dirTmp();
    const ativo = await iniciarAdminServidorUds({ socketDir: dir, segredo: SEGREDO });
    const prepResp = await enviarComandoAdminUds({
      socketPath: ativo.socketPath,
      token: SEGREDO,
      op: 'preparar',
      params: {
        empresaId: 3,
        cnpj: CNPJ,
        periodoInicio: PERIODO.inicio,
        periodoFim: PERIODO.fim,
        tipo: 'DISCOVERY_ONLY',
      },
    });
    expect(prepResp.ok).toBe(true);
    if (!prepResp.ok) throw new Error('prep');
    const execucaoId = String(prepResp.data.execucaoId);
    await emitirAtivar(canal, execucaoId);
    const libResp = await enviarComandoAdminUds({
      socketPath: ativo.socketPath,
      token: SEGREDO,
      op: 'liberar',
      params: { execucaoId },
    });
    expect(libResp.ok).toBe(true);
    if (libResp.ok) {
      expect(libResp.data.enfileirado).toBe(true);
      expect(libResp.data.ticketConsumido).toBe(false);
    }
    expect(enqueues).toHaveLength(1);
    await ativo.fechar();
  });

  it('admin liberar sem handler → erro explícito', async () => {
    const dir = await dirTmp();
    const ativo = await iniciarAdminServidorUds({ socketDir: dir, segredo: SEGREDO });
    const r = await enviarComandoAdminUds({
      socketPath: ativo.socketPath,
      token: SEGREDO,
      op: 'liberar',
      params: { execucaoId: '1' },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.codigo).toBe('CONTEXTO_INVALIDO');
    }
    await ativo.fechar();
  });

  it('mutex: HomologacaoNfseError tipado em concorrência', async () => {
    const canal = criarCanalAutorizacaoMemoria();
    usarCanal(canal);
    const prep = await prepararExecucaoHomologacao(
      {
        empresaId: 1,
        cnpj: CNPJ,
        periodoInicio: PERIODO.inicio,
        periodoFim: PERIODO.fim,
        agora: AGORA,
      },
      depsComCanal()
    );
    await emitirAtivar(canal, prep.execucaoId);
    const d = depsComCanal();
    const [a, b] = await Promise.allSettled([
      liberarExecucaoHomologacao({ execucaoId: prep.execucaoId, agora: AGORA }, d),
      liberarExecucaoHomologacao({ execucaoId: prep.execucaoId, agora: AGORA }, d),
    ]);
    const rej = [a, b].find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect(rej.reason).toBeInstanceOf(HomologacaoNfseError);
  });
});

describe('H2.2.4-B2-R1 consistência e recuperação', () => {
  it('R1 falha após Prisma.create antes do Map → bloqueada, sem payload', async () => {
    await expect(
      prepararExecucaoHomologacao(
        {
          empresaId: 1,
          cnpj: CNPJ,
          periodoInicio: PERIODO.inicio,
          periodoFim: PERIODO.fim,
          agora: AGORA,
        },
        depsComCanal({
          async ganchoAposCriarAntesDoPayload() {
            throw new Error('crash simulado pós-create');
          },
        })
      )
    ).rejects.toMatchObject({ codigo: 'CONTEXTO_INVALIDO' });
    const ultima = [...storeExec.values()].pop();
    expect(ultima?.status).toBe(STATUS_HOMOLOGACAO_BLOQUEADA);
    expect(obterPayloadPreparacao(String(ultima!.id))).toBeUndefined();
    expect(enqueues).toHaveLength(0);
  });

  it('R1 falha após Map.set antes do retorno → bloqueada e payload removido', async () => {
    await expect(
      prepararExecucaoHomologacao(
        {
          empresaId: 1,
          cnpj: CNPJ,
          periodoInicio: PERIODO.inicio,
          periodoFim: PERIODO.fim,
          agora: AGORA,
        },
        depsComCanal({
          async ganchoAposPayloadAntesDoRetorno(execucaoId) {
            expect(obterPayloadPreparacao(execucaoId)).toBeTruthy();
            throw new Error('falha ao montar resposta');
          },
        })
      )
    ).rejects.toBeTruthy();
    const ultima = [...storeExec.values()].pop();
    expect(ultima?.status).toBe(STATUS_HOMOLOGACAO_BLOQUEADA);
    expect(obterPayloadPreparacao(String(ultima!.id))).toBeUndefined();
  });

  it('R1 updateMany count=0 → concorrência, sem enqueue', async () => {
    const canal = criarCanalAutorizacaoMemoria();
    usarCanal(canal);
    const prep = await prepararExecucaoHomologacao(
      {
        empresaId: 1,
        cnpj: CNPJ,
        periodoInicio: PERIODO.inicio,
        periodoFim: PERIODO.fim,
        agora: AGORA,
      },
      depsComCanal()
    );
    await emitirAtivar(canal, prep.execucaoId);
    await expect(
      liberarExecucaoHomologacao(
        { execucaoId: prep.execucaoId, agora: AGORA },
        depsComCanal({
          async atualizarSeStatus() {
            return 0;
          },
        })
      )
    ).rejects.toMatchObject({ codigo: 'AUTORIZACAO_CONCORRENCIA' });
    expect(enqueues).toHaveLength(0);
    expect(storeExec.get(Number(prep.execucaoId))?.status).toBe(STATUS_HOMOLOGACAO_PREPARADA);
  });

  it('R1 falha após reserva antes de fila.add → bloqueada', async () => {
    const canal = criarCanalAutorizacaoMemoria();
    usarCanal(canal);
    const prep = await prepararExecucaoHomologacao(
      {
        empresaId: 1,
        cnpj: CNPJ,
        periodoInicio: PERIODO.inicio,
        periodoFim: PERIODO.fim,
        agora: AGORA,
      },
      depsComCanal()
    );
    await emitirAtivar(canal, prep.execucaoId);
    await expect(
      liberarExecucaoHomologacao(
        { execucaoId: prep.execucaoId, agora: AGORA },
        depsComCanal({
          async ganchoAposReservaAntesDoEnqueue() {
            throw new Error('falha pré-enqueue');
          },
        })
      )
    ).rejects.toMatchObject({ codigo: 'CONTEXTO_INVALIDO' });
    expect(storeExec.get(Number(prep.execucaoId))?.status).toBe(STATUS_HOMOLOGACAO_BLOQUEADA);
    expect(enqueues).toHaveLength(0);
  });

  it('R1 payload diverge do Prisma → recusa', async () => {
    const canal = criarCanalAutorizacaoMemoria();
    usarCanal(canal);
    const prep = await prepararExecucaoHomologacao(
      {
        empresaId: 1,
        cnpj: CNPJ,
        periodoInicio: PERIODO.inicio,
        periodoFim: PERIODO.fim,
        agora: AGORA,
      },
      depsComCanal()
    );
    await emitirAtivar(canal, prep.execucaoId);
    storeExec.set(Number(prep.execucaoId), {
      ...storeExec.get(Number(prep.execucaoId))!,
      cnpj: CNPJ_OUTRO,
    });
    await expect(
      liberarExecucaoHomologacao({ execucaoId: prep.execucaoId, agora: AGORA }, depsComCanal())
    ).rejects.toMatchObject({ codigo: 'CONTEXTO_INVALIDO' });
    expect(enqueues).toHaveLength(0);
  });

  it('R1 preparações distintas isolam CNPJ/período (dois execucaoId)', async () => {
    const a = await prepararExecucaoHomologacao(
      {
        empresaId: 1,
        cnpj: CNPJ,
        periodoInicio: PERIODO.inicio,
        periodoFim: PERIODO.fim,
        agora: AGORA,
      },
      depsComCanal()
    );
    const b = await prepararExecucaoHomologacao(
      {
        empresaId: 2,
        cnpj: CNPJ_OUTRO,
        periodoInicio: '01/02/2024',
        periodoFim: '28/02/2024',
        agora: AGORA,
      },
      depsComCanal()
    );
    expect(a.execucaoId).not.toBe(b.execucaoId);
    expect(obterPayloadPreparacao(a.execucaoId)?.cnpj).toBe(CNPJ);
    expect(obterPayloadPreparacao(b.execucaoId)?.cnpj).toBe(CNPJ_OUTRO);
    expect(enqueues).toHaveLength(0);
  });

  it('R1 estado persistido divergente (liberada sem payload) → sem reenqueue', async () => {
    storeExec.set(55, {
      id: 55,
      status: STATUS_HOMOLOGACAO_LIBERADA,
      cnpj: CNPJ,
      periodoInicio: PERIODO.inicio,
      periodoFim: PERIODO.fim,
      empresaId: 1,
    });
    await expect(
      liberarExecucaoHomologacao({ execucaoId: '55', agora: AGORA }, depsComCanal())
    ).rejects.toMatchObject({ codigo: 'AUTORIZACAO_JA_CONSUMIDA' });
    expect(enqueues).toHaveLength(0);
  });

  it('R1 liberação sequencial: segunda recusada; ticket intacto', async () => {
    const canal = criarCanalAutorizacaoMemoria();
    usarCanal(canal);
    const prep = await prepararExecucaoHomologacao(
      {
        empresaId: 1,
        cnpj: CNPJ,
        periodoInicio: PERIODO.inicio,
        periodoFim: PERIODO.fim,
        agora: AGORA,
      },
      depsComCanal()
    );
    await emitirAtivar(canal, prep.execucaoId);
    const d = depsComCanal();
    await liberarExecucaoHomologacao({ execucaoId: prep.execucaoId, agora: AGORA }, d);
    await expect(
      liberarExecucaoHomologacao({ execucaoId: prep.execucaoId, agora: AGORA }, d)
    ).rejects.toMatchObject({ codigo: 'AUTORIZACAO_JA_CONSUMIDA' });
    expect((await canal.consultar(prep.execucaoId))?.estado).toBe('DISPONIVEL');
    expect(enqueues).toHaveLength(1);
  });

  it('R1 multi-instância simulada: outro processo sem payload não libera', async () => {
    const canal = criarCanalAutorizacaoMemoria();
    usarCanal(canal);
    const prep = await prepararExecucaoHomologacao(
      {
        empresaId: 1,
        cnpj: CNPJ,
        periodoInicio: PERIODO.inicio,
        periodoFim: PERIODO.fim,
        agora: AGORA,
      },
      depsComCanal()
    );
    await emitirAtivar(canal, prep.execucaoId);
    // Instância B: DB compartilhado, Map vazio
    simularReinicioProcessoSomenteTeste();
    await expect(
      liberarExecucaoHomologacao({ execucaoId: prep.execucaoId, agora: AGORA }, depsComCanal())
    ).rejects.toMatchObject({
      message: expect.stringMatching(/outra instância|reinício|payload/i),
    });
    expect(storeExec.get(Number(prep.execucaoId))?.status).toBe(STATUS_HOMOLOGACAO_PREPARADA);
    expect(enqueues).toHaveLength(0);
  });
});
