/**
 * API-01S — Testes integrados offline dos 3 fluxos Iniciar.
 * Sem rede ADN/Portal/SEFIN. Sem Chromium real.
 *
 * 1. Empresa A (A1) → ADN, chromiumAberto=false
 * 2. Empresa B (usuário/senha) → Playwright legado (stub)
 * 3. Progresso fiscal PARCIAL (fim NSU ≠ completude mensal)
 * + concorrência, interrupção, SSE/polling, flag off, sem fallback silencioso
 */
import PQueue from 'p-queue';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adaptarSyncAdnParaInventarioParcial, criarPeriodoReferenciaAdn } from './inventory-adapter';
import { decidirAdnIniciar } from './iniciar-routing';
import { executarFluxoAdnIniciar } from './iniciar-executor';
import {
  resetIniciarAdnRuntimeParaTestes,
  syncAdnIniciarFixoParaTestes,
} from './iniciar-runtime';
import { NOME_FLAG_ADN_INICIAR } from './iniciar-feature-flag';
import {
  configAdnIniciarPadrao,
  resetConfigAdnIniciarParaTestes,
  setConfigAdnIniciarParaTestes,
} from './iniciar-config';
import { ErroAdn } from './errors';
import type { ResultadoSyncAdn } from './types';
import {
  limparRetencaoProgressoFiscal,
  limparRevisoesProgressoFiscal,
  listarSnapshotsPorLote,
  obterSnapshotPorExecucao,
  progressoFiscalDeSyncAdn,
  publicarProgressoFiscal,
  retenirProgressoFiscal,
} from '../progresso-fiscal';

const CNPJ_A = '45517515000100';
const CNPJ_B = '11222333000181';
const CHAVE_E = '41069022228631747000167000000000003626090719238991';
const CHAVE_R = '41069022252448489000162000000000005526095260389667';

/** Env sem kill-switch — produto manda (adnPadraoA1). */
function envProduto(): NodeJS.ProcessEnv {
  return {};
}

function syncAdnOk(cnpj: string): ResultadoSyncAdn {
  return {
    cnpj,
    ambiente: 'producao',
    documentos: [
      {
        nsu: 1,
        chaveAcesso: CHAVE_E,
        classificacao: 'emitida',
        papeis: ['emitente'],
        sha256: 'a'.repeat(64),
        xmlValido: true,
        competencia: '2026-01',
      },
      {
        nsu: 2,
        chaveAcesso: CHAVE_R,
        classificacao: 'recebida',
        papeis: ['tomador'],
        sha256: 'b'.repeat(64),
        xmlValido: true,
        competencia: '2026-01',
      },
    ],
    nsuInicial: 1,
    ultimoNsuProcessado: 2,
    lotesProcessados: 2,
    requests: 2,
    status: 'COMPLETO',
    fimDistribuicaoConfirmado: true,
    inventarioMensalCompletoDeclarado: false,
    motivoParada: 'NENHUM_DOCUMENTO_LOCALIZADO',
    duplicidades: 0,
    xmlsInvalidos: 0,
    contagens: {
      emitidas: 1,
      recebidas: 1,
      intermediadas: 0,
      eventos: 0,
      naoClassificados: 0,
    },
  };
}

interface EvidenciaFluxo {
  empresa: string;
  cnpj: string;
  modo: 'ADN' | 'PLAYWRIGHT';
  chromiumAberto: boolean;
  playwrightUsado: boolean;
  sefinChamado: boolean;
  hcaptchaUsado: boolean;
  stages: string[];
  fiscalCompletude: string | null;
  fiscalEstado: string | null;
  fiscalConfiavel: boolean | null;
  ok: boolean;
}

/** Stub do legado Playwright — registra abertura de Chromium sem browser real. */
async function simularPlaywrightLegado(params: {
  empresa: string;
  cnpj: string;
}): Promise<EvidenciaFluxo> {
  return {
    empresa: params.empresa,
    cnpj: params.cnpj,
    modo: 'PLAYWRIGHT',
    chromiumAberto: true,
    playwrightUsado: true,
    sefinChamado: false,
    hcaptchaUsado: true,
    stages: ['abrir_navegador', 'login', 'captcha_manual', 'processamento'],
    fiscalCompletude: 'PARCIAL',
    fiscalEstado: 'parcial',
    fiscalConfiavel: false,
    ok: true,
  };
}

async function simularFluxoAdnEmpresaA(params?: {
  env?: NodeJS.ProcessEnv;
  interromperAntes?: boolean;
  syncFalhar?: boolean;
  execucaoId?: string;
}): Promise<EvidenciaFluxo> {
  const env = params?.env ?? envProduto();
  const execucaoId = params?.execucaoId ?? '1001';
  const decisao = decidirAdnIniciar({
    tipoAutenticacao: 'certificado',
    cnpj: CNPJ_A,
    env,
  });

  if (!decisao.executarAdn) {
    return simularPlaywrightLegado({ empresa: 'A', cnpj: CNPJ_A });
  }

  expect(decisao.abrirChromium).toBe(false);
  const stages = ['adn_distribuicao'];

  const executarSync = params?.syncFalhar
    ? async () => {
        throw new ErroAdn('ADN_SYNC_FALHOU', 'TRANSITORIO', 'Falha simulada ADN');
      }
    : syncAdnIniciarFixoParaTestes(syncAdnOk(CNPJ_A));

  const resultado = await executarFluxoAdnIniciar(
    {
      cnpj: CNPJ_A,
      dataInicio: '01/01/2026',
      dataFim: '31/01/2026',
      identidade: {
        batchId: 'lote-01s',
        empresaId: '10',
        execucaoId,
        cnpj: CNPJ_A,
      },
      decisao,
      deveInterromper: () => Boolean(params?.interromperAntes),
      env,
    },
    { executarSync, exigirGateLive: false }
  );

  let fiscal = resultado.fiscal;
  if (fiscal) {
    fiscal = publicarProgressoFiscal(fiscal);
    retenirProgressoFiscal(
      {
        batch_id: 'lote-01s',
        empresa_id: '10',
        execucao_id: execucaoId,
        cnpj: CNPJ_A,
        status: resultado.ok ? 'concluido' : 'falhou',
        etapa_atual: 'adn_distribuicao',
        progresso: 100,
        mensagem: resultado.motivo,
        qtd_notas_emitidas: resultado.contagens.emitidas,
        qtd_notas_recebidas: resultado.contagens.recebidas,
        qtd_notas_canceladas: resultado.contagens.canceladas,
        resultado_final: resultado.ok ? 'NFS_ENCONTRADAS' : 'ERRO',
        fiscal,
      },
      { marcadoFinalizado: true }
    );
  }

  return {
    empresa: 'A',
    cnpj: CNPJ_A,
    modo: 'ADN',
    chromiumAberto: resultado.chromiumAberto,
    playwrightUsado: resultado.playwrightUsado,
    sefinChamado: resultado.sefinChamado,
    hcaptchaUsado: resultado.hcaptchaUsado,
    stages,
    fiscalCompletude: fiscal?.inventario.completude ?? null,
    fiscalEstado: fiscal?.inventario.estado ?? null,
    fiscalConfiavel: fiscal?.inventario.conclusao_confiavel ?? null,
    ok: resultado.ok,
  };
}

describe('API-01S / API-02D — Roteamento Iniciar', () => {
  beforeEach(() => {
    setConfigAdnIniciarParaTestes(configAdnIniciarPadrao());
  });

  afterEach(() => {
    resetIniciarAdnRuntimeParaTestes();
    resetConfigAdnIniciarParaTestes();
  });

  it('produto default: A1 → ADN sem Chromium (sem flags de piloto)', () => {
    const d = decidirAdnIniciar({
      tipoAutenticacao: 'certificado',
      cnpj: CNPJ_A,
      env: {},
    });
    expect(d.executarAdn).toBe(true);
    expect(d.abrirChromium).toBe(false);
    expect(d.situacao).toBe('ADN_SOLICITADO');
  });

  it('credenciais → Playwright (nunca ADN)', () => {
    const d = decidirAdnIniciar({
      tipoAutenticacao: 'credenciais',
      cnpj: CNPJ_A,
      env: envProduto(),
    });
    expect(d.executarAdn).toBe(false);
    expect(d.abrirChromium).toBe(true);
    expect(d.situacao).toBe('LEGADO_CREDENCIAIS');
  });

  it('A1 na exceção Playwright → Chromium', () => {
    setConfigAdnIniciarParaTestes({
      ...configAdnIniciarPadrao(),
      playwrightExcecaoCnpjs: [CNPJ_B],
    });
    const d = decidirAdnIniciar({
      tipoAutenticacao: 'certificado',
      cnpj: CNPJ_B,
      env: {},
    });
    expect(d.executarAdn).toBe(false);
    expect(d.abrirChromium).toBe(true);
    expect(d.situacao).toBe('LEGADO_EXCECAO_PLAYWRIGHT');
  });

  it('kill-switch env false → Playwright mesmo com produto on', () => {
    const d = decidirAdnIniciar({
      tipoAutenticacao: 'certificado',
      cnpj: CNPJ_A,
      env: { [NOME_FLAG_ADN_INICIAR]: 'false' },
    });
    expect(d.executarAdn).toBe(false);
    expect(d.abrirChromium).toBe(true);
    expect(d.situacao).toBe('LEGADO_KILL_SWITCH');
  });

  it('autorização explícita por empresa ativa ADN mesmo com exceção', () => {
    setConfigAdnIniciarParaTestes({
      ...configAdnIniciarPadrao(),
      playwrightExcecaoCnpjs: [CNPJ_B],
    });
    const d = decidirAdnIniciar({
      tipoAutenticacao: 'certificado',
      cnpj: CNPJ_B,
      env: {},
      autorizacaoAdnIniciar: { ativa: true, cnpj: CNPJ_B },
    });
    expect(d.executarAdn).toBe(true);
    expect(d.abrirChromium).toBe(false);
  });
});

describe('API-01S — Progresso fiscal ADN', () => {
  beforeEach(() => {
    limparRetencaoProgressoFiscal();
    limparRevisoesProgressoFiscal();
  });

  it('fim da distribuição NSU não declara COMPLETO', () => {
    const sync = syncAdnOk(CNPJ_A);
    const adaptacao = adaptarSyncAdnParaInventarioParcial({
      sync,
      periodoConsulta: criarPeriodoReferenciaAdn('01/01/2026', '31/01/2026'),
    });
    expect(adaptacao.inventario.completude).toBe('PARCIAL');
    expect(adaptacao.inventarioMensalCompletoDeclarado).toBe(false);

    const fiscal = progressoFiscalDeSyncAdn({
      identidade: {
        batchId: 'b1',
        empresaId: '1',
        execucaoId: '9',
        cnpj: CNPJ_A,
      },
      sync,
      adaptacao,
    });
    expect(fiscal.inventario.completude).toBe('PARCIAL');
    expect(fiscal.inventario.estado).toBe('parcial');
    expect(fiscal.inventario.conclusao_confiavel).toBe(false);
    expect(fiscal.validacao.origem).toBe('ADN');
    expect(fiscal.validacao.conclusao_confiavel).toBe(false);
    expect(fiscal.recuperacao.estado).toBe('nao_executada');
    expect(fiscal.inventario.totais.emitidas).toBe(1);
    expect(fiscal.inventario.totais.recebidas).toBe(1);
  });
});

describe('API-01S — Três fluxos concorrentes (PQueue única)', () => {
  beforeEach(() => {
    resetIniciarAdnRuntimeParaTestes();
    setConfigAdnIniciarParaTestes(configAdnIniciarPadrao());
    limparRetencaoProgressoFiscal();
    limparRevisoesProgressoFiscal();
  });

  afterEach(() => {
    resetIniciarAdnRuntimeParaTestes();
    resetConfigAdnIniciarParaTestes();
  });

  it('Empresa A ADN + Empresa B Playwright sem interferência; A sem Chromium', async () => {
    const fila = new PQueue({ concurrency: 2 });
    const evidencias: EvidenciaFluxo[] = [];

    await Promise.all([
      fila.add(async () => {
        evidencias.push(await simularFluxoAdnEmpresaA());
      }),
      fila.add(async () => {
        const d = decidirAdnIniciar({
          tipoAutenticacao: 'credenciais',
          cnpj: CNPJ_B,
          env: envProduto(),
        });
        expect(d.executarAdn).toBe(false);
        evidencias.push(await simularPlaywrightLegado({ empresa: 'B', cnpj: CNPJ_B }));
      }),
    ]);

    const a = evidencias.find((e) => e.empresa === 'A')!;
    const b = evidencias.find((e) => e.empresa === 'B')!;

    expect(a.modo).toBe('ADN');
    expect(a.chromiumAberto).toBe(false);
    expect(a.playwrightUsado).toBe(false);
    expect(a.sefinChamado).toBe(false);
    expect(a.hcaptchaUsado).toBe(false);
    expect(a.stages).not.toContain('abrir_navegador');
    expect(a.stages).toContain('adn_distribuicao');
    expect(a.fiscalCompletude).toBe('PARCIAL');
    expect(a.fiscalConfiavel).toBe(false);
    expect(a.ok).toBe(true);

    expect(b.modo).toBe('PLAYWRIGHT');
    expect(b.chromiumAberto).toBe(true);
    expect(b.playwrightUsado).toBe(true);
    expect(b.stages).toContain('abrir_navegador');
    expect(b.stages).toContain('captcha_manual');

    const snap = obterSnapshotPorExecucao('1001');
    expect(snap?.fiscal.inventario.completude).toBe('PARCIAL');
    expect(snap?.fiscal.validacao.origem).toBe('ADN');

    const porLote = listarSnapshotsPorLote('lote-01s');
    expect(porLote.some((s) => s.execucao_id === '1001')).toBe(true);
  });

  it('kill-switch: A1 também vai para Playwright (rollback)', async () => {
    const ev = await simularFluxoAdnEmpresaA({
      env: { [NOME_FLAG_ADN_INICIAR]: 'false' },
    });
    expect(ev.modo).toBe('PLAYWRIGHT');
    expect(ev.chromiumAberto).toBe(true);
  });

  it('erro ADN não faz fallback silencioso para Playwright', async () => {
    const ev = await simularFluxoAdnEmpresaA({ syncFalhar: true });
    expect(ev.modo).toBe('ADN');
    expect(ev.ok).toBe(false);
    expect(ev.chromiumAberto).toBe(false);
    expect(ev.playwrightUsado).toBe(false);
    expect(ev.stages).not.toContain('abrir_navegador');
  });

  it('interrupção encerra ADN sem abrir Chromium', async () => {
    const ev = await simularFluxoAdnEmpresaA({ interromperAntes: true });
    expect(ev.modo).toBe('ADN');
    expect(ev.chromiumAberto).toBe(false);
    expect(ev.ok).toBe(false);
  });

  it('isolamento por CNPJ na fila única', async () => {
    const fila = new PQueue({ concurrency: 2 });
    const marks: string[] = [];
    await Promise.all([
      fila.add(async () => {
        const a = await simularFluxoAdnEmpresaA({ execucaoId: '2001' });
        marks.push(`${a.modo}:${a.cnpj}:${a.chromiumAberto}`);
      }),
      fila.add(async () => {
        const b = await simularPlaywrightLegado({ empresa: 'B', cnpj: CNPJ_B });
        marks.push(`${b.modo}:${b.cnpj}:${b.chromiumAberto}`);
      }),
    ]);
    expect(marks).toContain(`ADN:${CNPJ_A}:false`);
    expect(marks).toContain(`PLAYWRIGHT:${CNPJ_B}:true`);
  });
});
