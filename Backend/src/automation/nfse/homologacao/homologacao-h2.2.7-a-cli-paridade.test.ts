/**
 * H2.2.7-A — Paridade CLI --headless / --captcha-mode (offline).
 * Sem Portal, Playwright real, login ou liberação operacional.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { criarPeriodoConsultaPortal } from '../contracts/periodo';
import { parseFlagCaptchaMode, parseFlagHeadless } from './cli-homologacao-flags';
import {
  configurarCanalHomologacaoOperacional,
  criarAutorizacaoHomologacao,
  criarAutorizacaoId,
  criarCanalAutorizacaoMemoria,
  criarLimitesHomologacao,
  liberarExecucaoHomologacao,
  limparRegistryPreparacaoSomenteTeste,
  obterPayloadPreparacao,
  prepararExecucaoHomologacao,
  type DependenciasPreparacaoLiberacao,
  type PayloadExecucaoHomologacao,
} from './index';
import { HomologacaoNfseError } from './types';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

const CNPJ = '11222333000181';
const PERIODO = criarPeriodoConsultaPortal('01/01/2024', '31/01/2024');
const AGORA = new Date('2024-06-15T12:00:00.000Z');
const VALIDO_ATE = '2024-06-16T12:00:00.000Z';

let seqId = 7000;
let enqueues: PayloadExecucaoHomologacao[] = [];
let storeExec = new Map<number, { id: number; status: string; cnpj: string | null; periodoInicio: string | null; periodoFim: string | null; empresaId: number }>();
const dirs: string[] = [];

function deps(overrides?: Partial<DependenciasPreparacaoLiberacao>): DependenciasPreparacaoLiberacao {
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
      storeExec.set(id, { ...e, status: data.status ?? e.status });
      return 1;
    },
    async enfileirar(payload) {
      enqueues.push(payload);
    },
    obterCanal: () => null,
    headlessPadrao: true,
    ...overrides,
  };
}

beforeEach(() => {
  limparRegistryPreparacaoSomenteTeste();
  configurarCanalHomologacaoOperacional(null);
  seqId = 7000;
  enqueues = [];
  storeExec = new Map();
});

afterEach(async () => {
  limparRegistryPreparacaoSomenteTeste();
  configurarCanalHomologacaoOperacional(null);
  while (dirs.length) {
    const d = dirs.pop();
    if (d) await rm(d, { recursive: true, force: true });
  }
});

describe('H2.2.7-A flags CLI headless / captcha-mode', () => {
  it('01 --headless false', () => {
    expect(parseFlagHeadless({ headless: 'false' })).toBe(false);
  });

  it('02 --headless true', () => {
    expect(parseFlagHeadless({ headless: 'true' })).toBe(true);
  });

  it('03 --captcha-mode MANUAL', () => {
    expect(parseFlagCaptchaMode({ 'captcha-mode': 'MANUAL' })).toBe('MANUAL');
  });

  it('04 --captcha-mode TWO_CAPTCHA', () => {
    expect(parseFlagCaptchaMode({ 'captcha-mode': 'TWO_CAPTCHA' })).toBe('TWO_CAPTCHA');
  });

  it('05 valores inválidos', () => {
    expect(() => parseFlagHeadless({ headless: 'maybe' })).toThrow(HomologacaoNfseError);
    expect(() => parseFlagHeadless({ headless: true })).toThrow(HomologacaoNfseError);
    expect(() => parseFlagCaptchaMode({ 'captcha-mode': 'AUTO' })).toThrow(HomologacaoNfseError);
    expect(() => parseFlagCaptchaMode({ 'captcha-mode': true })).toThrow(HomologacaoNfseError);
  });

  it('06 defaults preservados (flags ausentes → undefined)', () => {
    expect(parseFlagHeadless({})).toBeUndefined();
    expect(parseFlagCaptchaMode({})).toBeUndefined();
  });

  it('07 propagação até payload (headless=false, MANUAL)', async () => {
    const r = await prepararExecucaoHomologacao(
      {
        empresaId: 1,
        cnpj: CNPJ,
        periodoInicio: PERIODO.inicio,
        periodoFim: PERIODO.fim,
        headless: false,
        captchaMode: 'MANUAL',
        agora: AGORA,
      },
      deps({ headlessPadrao: true })
    );
    const p = obterPayloadPreparacao(r.execucaoId);
    expect(p?.headless).toBe(false);
    expect(p?.captchaMode).toBe('MANUAL');
    expect(enqueues).toHaveLength(0);
  });

  it('08 propagação até enqueue (false e MANUAL intactos)', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'an-h227a-'));
    dirs.push(dir);
    const canal = criarCanalAutorizacaoMemoria();
    configurarCanalHomologacaoOperacional(canal);
    const d = deps({ obterCanal: () => canal });
    const prep = await prepararExecucaoHomologacao(
      {
        empresaId: 1,
        cnpj: CNPJ,
        periodoInicio: PERIODO.inicio,
        periodoFim: PERIODO.fim,
        headless: false,
        captchaMode: 'MANUAL',
        agora: AGORA,
      },
      d
    );
    const auth = criarAutorizacaoHomologacao({
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: prep.execucaoId,
      operacao: 'DISCOVERY_ONLY',
      validoAte: VALIDO_ATE,
      diretorioFiscal: dir,
      limites: criarLimitesHomologacao({
        maxDocumentos: 10,
        maxPaginas: 5,
        maxRequisicoesSefin: 0,
        timeoutMs: 30_000,
      }),
      motivo: 'h227a',
      agora: AGORA,
    });
    const ticket = await canal.emitir({
      versao: 1,
      autorizacaoId: criarAutorizacaoId(),
      autorizacao: auth,
      emitidoEm: AGORA.toISOString(),
    });
    await canal.ativarDiscoveryReal(ticket.autorizacaoId, 'ativar', AGORA);
    await liberarExecucaoHomologacao({ execucaoId: prep.execucaoId, agora: AGORA }, d);
    expect(enqueues).toHaveLength(1);
    expect(enqueues[0]?.headless).toBe(false);
    expect(enqueues[0]?.captchaMode).toBe('MANUAL');
  });

  it('09 legado / defaults sem flags (headlessPadrao + TWO_CAPTCHA)', async () => {
    const r = await prepararExecucaoHomologacao(
      {
        empresaId: 1,
        cnpj: CNPJ,
        periodoInicio: PERIODO.inicio,
        periodoFim: PERIODO.fim,
        agora: AGORA,
      },
      deps({ headlessPadrao: true })
    );
    const p = obterPayloadPreparacao(r.execucaoId)!;
    expect(p.headless).toBe(true);
    expect(p.captchaMode).toBe('TWO_CAPTCHA');
  });

  it('10 nenhuma execução real (sem enqueue na preparação)', async () => {
    await prepararExecucaoHomologacao(
      {
        empresaId: 1,
        cnpj: CNPJ,
        periodoInicio: PERIODO.inicio,
        periodoFim: PERIODO.fim,
        headless: false,
        captchaMode: 'MANUAL',
        agora: AGORA,
      },
      deps()
    );
    expect(enqueues).toHaveLength(0);
  });

  it('headless=false não é sobrescrito por headlessPadrao', async () => {
    const r = await prepararExecucaoHomologacao(
      {
        empresaId: 1,
        cnpj: CNPJ,
        periodoInicio: PERIODO.inicio,
        periodoFim: PERIODO.fim,
        headless: false,
        agora: AGORA,
      },
      deps({ headlessPadrao: true })
    );
    expect(obterPayloadPreparacao(r.execucaoId)?.headless).toBe(false);
  });
});
