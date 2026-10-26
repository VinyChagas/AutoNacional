/**
 * API-02D — ADN padrão de produto no Iniciar (offline).
 * Sem chamadas reais ADN/Portal/SEFIN/Chromium.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decidirAdnIniciar } from './iniciar-routing';
import { executarFluxoAdnIniciar } from './iniciar-executor';
import {
  resetIniciarAdnRuntimeParaTestes,
  syncAdnIniciarFixoParaTestes,
} from './iniciar-runtime';
import { NOME_FLAG_ADN_INICIAR } from './iniciar-feature-flag';
import {
  caminhoArquivoConfigAdnIniciar,
  carregarConfigAdnIniciar,
  configAdnIniciarPadrao,
  resetConfigAdnIniciarParaTestes,
  salvarConfigAdnIniciar,
  setConfigAdnIniciarParaTestes,
} from './iniciar-config';
import { ErroAdn } from './errors';
import type { ResultadoSyncAdn } from './types';

const CNPJ_274 = '19903461000100';
const CNPJ_139 = '24762400000100';
const CNPJ_226 = '46704878000109';
const CNPJ_SENHA = '11222333000181';

function syncOk(cnpj: string): ResultadoSyncAdn {
  return {
    cnpj,
    ambiente: 'producao',
    documentos: [],
    nsuInicial: 51,
    ultimoNsuProcessado: 51,
    lotesProcessados: 0,
    requests: 1,
    status: 'COMPLETO',
    fimDistribuicaoConfirmado: true,
    inventarioMensalCompletoDeclarado: false,
    motivoParada: 'nenhum_documento_localizado',
    duplicidades: 0,
    xmlsInvalidos: 0,
    contagens: {
      emitidas: 0,
      recebidas: 0,
      intermediadas: 0,
      eventos: 0,
      naoClassificados: 0,
    },
  };
}

describe('API-02D — ADN padrão de produto', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adn-iniciar-cfg-'));
    resetConfigAdnIniciarParaTestes();
    setConfigAdnIniciarParaTestes(null);
    resetIniciarAdnRuntimeParaTestes();
  });

  afterEach(() => {
    resetIniciarAdnRuntimeParaTestes();
    resetConfigAdnIniciarParaTestes();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('persiste config em disco e recarrega após “reinício” (novo load)', () => {
    const salvo = salvarConfigAdnIniciar(
      {
        adnPadraoA1: true,
        playwrightExcecaoCnpjs: [CNPJ_226],
        maxRequests: 10,
        homologRoot: path.join(tmpDir, 'homolog'),
      },
      { dir: tmpDir }
    );
    expect(salvo.playwrightExcecaoCnpjs).toEqual([CNPJ_226]);
    expect(fs.existsSync(caminhoArquivoConfigAdnIniciar(tmpDir))).toBe(true);

    // Simula reinício: limpa cache/override e recarrega do disco.
    resetConfigAdnIniciarParaTestes();
    const relido = carregarConfigAdnIniciar({ dir: tmpDir, criarSeAusente: false });
    expect(relido.adnPadraoA1).toBe(true);
    expect(relido.playwrightExcecaoCnpjs).toEqual([CNPJ_226]);
    expect(relido.maxRequests).toBe(10);
    expect(relido.homologRoot).toContain('homolog');
  });

  it('API-02K — A1 sem auth explícita → ADN não automático', () => {
    setConfigAdnIniciarParaTestes({
      ...configAdnIniciarPadrao(),
      adnPadraoA1: true,
    });
    for (const cnpj of [CNPJ_274, CNPJ_139, CNPJ_226]) {
      const d = decidirAdnIniciar({
        tipoAutenticacao: 'certificado',
        cnpj,
        env: {},
      });
      expect(d.executarAdn).toBe(false);
      expect(d.situacao).toBe('LEGADO_PRODUTO_DESLIGADO');
    }
  });

  it('API-02K — A1 com auth explícita → ADN complementar', () => {
    setConfigAdnIniciarParaTestes(configAdnIniciarPadrao());
    for (const cnpj of [CNPJ_274, CNPJ_139, CNPJ_226]) {
      const d = decidirAdnIniciar({
        tipoAutenticacao: 'certificado',
        cnpj,
        env: {},
        autorizacaoAdnIniciar: { ativa: true, cnpj },
      });
      expect(d.modo).toBe('ADN');
      expect(d.executarAdn).toBe(true);
      expect(d.abrirChromium).toBe(false);
      expect(d.situacao).toBe('ADN_SOLICITADO');
    }
  });

  it('usuário/senha → Playwright', () => {
    setConfigAdnIniciarParaTestes(configAdnIniciarPadrao());
    const d = decidirAdnIniciar({
      tipoAutenticacao: 'credenciais',
      cnpj: CNPJ_SENHA,
      env: {},
    });
    expect(d.modo).toBe('PLAYWRIGHT');
    expect(d.abrirChromium).toBe(true);
    expect(d.situacao).toBe('LEGADO_CREDENCIAIS');
  });

  it('exceção explícita força Playwright para A1', () => {
    setConfigAdnIniciarParaTestes({
      ...configAdnIniciarPadrao(),
      playwrightExcecaoCnpjs: [CNPJ_274],
    });
    const d = decidirAdnIniciar({
      tipoAutenticacao: 'certificado',
      cnpj: CNPJ_274,
      env: {},
    });
    expect(d.modo).toBe('PLAYWRIGHT');
    expect(d.situacao).toBe('LEGADO_EXCECAO_PLAYWRIGHT');
  });

  it('falha ADN não abre Chromium (sem fallback silencioso)', async () => {
    setConfigAdnIniciarParaTestes(configAdnIniciarPadrao());
    const decisao = decidirAdnIniciar({
      tipoAutenticacao: 'certificado',
      cnpj: CNPJ_274,
      env: {},
      autorizacaoAdnIniciar: { ativa: true, cnpj: CNPJ_274 },
    });
    expect(decisao.executarAdn).toBe(true);

    const r = await executarFluxoAdnIniciar(
      {
        cnpj: CNPJ_274,
        dataInicio: '01/09/2026',
        dataFim: '30/09/2026',
        identidade: {
          batchId: 'lote-02d',
          empresaId: '274',
          execucaoId: '02d-fail',
          cnpj: CNPJ_274,
        },
        decisao,
        env: {},
      },
      {
        executarSync: async () => {
          throw new ErroAdn('ADN_SYNC_FALHOU', 'TRANSITORIO', 'Falha simulada API-02D');
        },
        exigirGateLive: false,
      }
    );

    expect(r.ok).toBe(false);
    expect(r.chromiumAberto).toBe(false);
    expect(r.playwrightUsado).toBe(false);
    expect(r.sefinChamado).toBe(false);
    expect(r.hcaptchaUsado).toBe(false);
    expect(r.resultadoFinal).toBe('ERRO');
  });

  it('kill-switch env desliga ADN sem alterar arquivo de produto', () => {
    salvarConfigAdnIniciar({ adnPadraoA1: true }, { dir: tmpDir });
    resetConfigAdnIniciarParaTestes();
    carregarConfigAdnIniciar({ dir: tmpDir });

    const d = decidirAdnIniciar({
      tipoAutenticacao: 'certificado',
      cnpj: CNPJ_139,
      env: { [NOME_FLAG_ADN_INICIAR]: 'false' },
      configProduto: carregarConfigAdnIniciar({ dir: tmpDir }),
    });
    expect(d.situacao).toBe('LEGADO_KILL_SWITCH');
    expect(d.executarAdn).toBe(false);

    const disco = carregarConfigAdnIniciar({ dir: tmpDir });
    expect(disco.adnPadraoA1).toBe(true);
  });

  it('sync ADN ok com auth explícita (stub) — motor ADN complementar', async () => {
    setConfigAdnIniciarParaTestes(configAdnIniciarPadrao());
    const decisao = decidirAdnIniciar({
      tipoAutenticacao: 'certificado',
      cnpj: CNPJ_139,
      env: {},
      autorizacaoAdnIniciar: { ativa: true, cnpj: CNPJ_139 },
    });
    expect(decisao.executarAdn).toBe(true);
    const r = await executarFluxoAdnIniciar(
      {
        cnpj: CNPJ_139,
        dataInicio: '01/09/2026',
        dataFim: '30/09/2026',
        identidade: {
          batchId: 'lote-02d',
          empresaId: '139',
          execucaoId: '02d-ok',
          cnpj: CNPJ_139,
        },
        decisao,
        env: {},
      },
      {
        executarSync: syncAdnIniciarFixoParaTestes(syncOk(CNPJ_139)),
        exigirGateLive: false,
      }
    );
    expect(r.ok).toBe(true);
    expect(r.chromiumAberto).toBe(false);
  });
});
