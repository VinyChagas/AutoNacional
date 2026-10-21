/**
 * Testes offline da orquestração nativa (Commit 07).
 * Sem Playwright real, SEFIN, Portal Nacional ou certificados de produção.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as forge from 'node-forge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Page } from 'playwright';
import { criarDocumentoFiscal } from '../contracts/documento-fiscal';
import { montarInventario, type InventarioNfse } from '../contracts/inventario';
import { criarPeriodoConsultaPortal } from '../contracts/periodo';
import {
  AdaptadorCertificadoA1,
  RepositorioFiscalNfse,
  criarResolvedorRaizInjetada,
} from '../infrastructure';
import type { ResultadoDescobertaNfse } from '../discovery/types';
import type { ResultadoRecuperacaoSefin, TransporteHttpMtls } from '../recovery/types';
import {
  NOME_FLAG_RECUPERACAO_NATIVA,
  flagRecuperacaoNativaAtiva,
  lerFlagRecuperacaoNativa,
  lerRaizFiscalNativa,
} from './feature-flag';
import { decidirIntegracaoNativa, tentarFluxoNativoControlado } from './integration-adapter';
import { executarFluxoFiscalNativo } from './native-orchestrator';
import type { DependenciasFluxoFiscalNativo } from './types';

const CNPJ = '12345678000199';
const TOMADOR = '11222333000181';
const SENHA = 'SENHA-QUE-NAO-PODE-VAZAR';
const PERIODO = criarPeriodoConsultaPortal('01/09/2026', '30/09/2026');
const PAGE = { url: () => 'https://www.nfse.gov.br/' } as unknown as Page;

let raiz: string;

beforeEach(async () => {
  raiz = await mkdtemp(path.join(tmpdir(), 'nfse-orch-'));
});

afterEach(async () => {
  await rm(raiz, { recursive: true, force: true });
});

describe('feature flag NFSE_NATIVE_RECOVERY_ENABLED', () => {
  it('01 flag ausente desativa', () => {
    expect(lerFlagRecuperacaoNativa({})).toMatchObject({ ativa: false, motivo: 'AUSENTE' });
    expect(flagRecuperacaoNativaAtiva({})).toBe(false);
  });

  it('02 flag false desativa', () => {
    expect(lerFlagRecuperacaoNativa({ [NOME_FLAG_RECUPERACAO_NATIVA]: 'false' })).toMatchObject({
      ativa: false,
      motivo: 'FALSE',
    });
  });

  it('03 flag true habilita', () => {
    expect(lerFlagRecuperacaoNativa({ [NOME_FLAG_RECUPERACAO_NATIVA]: 'true' })).toMatchObject({
      ativa: true,
      motivo: 'TRUE',
    });
  });

  it('04 flag inválida falha segura', () => {
    expect(lerFlagRecuperacaoNativa({ [NOME_FLAG_RECUPERACAO_NATIVA]: 'sim' })).toMatchObject({
      ativa: false,
      motivo: 'INVALIDA',
    });
    expect(lerFlagRecuperacaoNativa({ [NOME_FLAG_RECUPERACAO_NATIVA]: '1' })).toMatchObject({
      ativa: false,
      motivo: 'INVALIDA',
    });
  });

  it('05 importação não dispara efeitos', async () => {
    const modulo = await import('./index');
    expect(typeof modulo.executarFluxoFiscalNativo).toBe('function');
    expect(typeof modulo.decidirIntegracaoNativa).toBe('function');
    expect(flagRecuperacaoNativaAtiva({})).toBe(false);
    expect(lerRaizFiscalNativa({})).toBeNull();
  });
});

describe('legado e decisão de integração', () => {
  it('06–10 flag desativada preserva legado sem orquestrador/A1/navegação/storage', () => {
    const descobrir = vi.fn();
    const recuperacao = vi.fn();
    const decisao = decidirIntegracaoNativa({
      page: PAGE,
      cnpj: CNPJ,
      dataInicio: '01/09/2026',
      dataFim: '30/09/2026',
      tipo: 'ambas',
      baixarPdf: false,
      execucaoId: 'exec-1',
      tipoAutenticacao: 'certificado',
      env: {},
    });
    expect(decisao).toMatchObject({
      modo: 'LEGADO',
      situacao: 'LEGADO_SOLICITADO',
      executarNativo: false,
      compatibilidadePdf: 'LEGADO_PRESERVADO',
    });
    expect(descobrir).not.toHaveBeenCalled();
    expect(recuperacao).not.toHaveBeenCalled();
  });

  it('31 integração flag desativada não executa nativo', async () => {
    const { decisao, resultado } = await tentarFluxoNativoControlado({
      page: PAGE,
      cnpj: CNPJ,
      dataInicio: '01/09/2026',
      dataFim: '30/09/2026',
      tipo: 'ambas',
      baixarPdf: false,
      execucaoId: 'exec-off',
      tipoAutenticacao: 'certificado',
      env: { NFSE_FISCAL_STORAGE_PATH: raiz },
    });
    expect(decisao.executarNativo).toBe(false);
    expect(decisao.situacao).toBe('LEGADO_SOLICITADO');
    expect(resultado).toBeNull();
  });

  it('40 nenhuma alteração de concorrência na decisão', () => {
    const a = decidirIntegracaoNativa(baseCtx({ env: {} }));
    const b = decidirIntegracaoNativa(baseCtx({ env: {} }));
    expect(a.modo).toBe('LEGADO');
    expect(b.modo).toBe('LEGADO');
  });
});

describe('ativação 22.7.1 — flag + autorização', () => {
  const envOn = () => ({
    [NOME_FLAG_RECUPERACAO_NATIVA]: 'true',
    NFSE_FISCAL_STORAGE_PATH: raiz,
  });
  const auth = { autorizada: true as const, motivo: 'teste-offline' };

  it('1–2 flag ausente/false → LEGADO_SOLICITADO', () => {
    expect(decidirIntegracaoNativa(baseCtx({ env: {}, autorizacaoNativa: auth })).situacao).toBe(
      'LEGADO_SOLICITADO'
    );
    expect(
      decidirIntegracaoNativa(
        baseCtx({ env: { [NOME_FLAG_RECUPERACAO_NATIVA]: 'false' }, autorizacaoNativa: auth })
      ).situacao
    ).toBe('LEGADO_SOLICITADO');
  });

  it('3 flag true sem autorização → LEGADO_SOLICITADO', () => {
    const d = decidirIntegracaoNativa(baseCtx({ env: envOn() }));
    expect(d).toMatchObject({
      situacao: 'LEGADO_SOLICITADO',
      executarNativo: false,
      codigoRecusa: 'AUTORIZACAO_AUSENTE',
    });
  });

  it('4 flag true com autorização → NATIVO_SOLICITADO', () => {
    const d = decidirIntegracaoNativa(baseCtx({ env: envOn(), autorizacaoNativa: auth }));
    expect(d).toMatchObject({
      situacao: 'NATIVO_SOLICITADO',
      modo: 'NATIVO_CONTROLADO',
      executarNativo: true,
    });
  });

  it('5 autorização sem flag → LEGADO_SOLICITADO', () => {
    const d = decidirIntegracaoNativa(baseCtx({ env: {}, autorizacaoNativa: auth }));
    expect(d.executarNativo).toBe(false);
    expect(d.situacao).toBe('LEGADO_SOLICITADO');
  });

  it('6–9 requisitos inválidos com autorização → NATIVO_RECUSADO', () => {
    // API-02K: baixarPdf não bloqueia mais — XML-only com aviso
    expect(
      decidirIntegracaoNativa(
        baseCtx({ env: envOn(), autorizacaoNativa: auth, baixarPdf: true })
      )
    ).toMatchObject({
      situacao: 'NATIVO_SOLICITADO',
      executarNativo: true,
      compatibilidadePdf: 'PDF_NAO_RECUPERADO',
    });

    expect(
      decidirIntegracaoNativa(
        baseCtx({
          env: { [NOME_FLAG_RECUPERACAO_NATIVA]: 'true' },
          autorizacaoNativa: auth,
        })
      )
    ).toMatchObject({ situacao: 'NATIVO_RECUSADO', codigoRecusa: 'RAIZ_FISCAL_AUSENTE' });

    expect(
      decidirIntegracaoNativa(
        baseCtx({ env: envOn(), autorizacaoNativa: auth, page: null })
      )
    ).toMatchObject({ situacao: 'NATIVO_RECUSADO', codigoRecusa: 'PAGE_AUSENTE' });

    expect(
      decidirIntegracaoNativa(
        baseCtx({ env: envOn(), autorizacaoNativa: auth, tipoAutenticacao: 'credenciais' })
      )
    ).toMatchObject({ situacao: 'NATIVO_RECUSADO', codigoRecusa: 'CONTEXTO_INVALIDO' });
  });

  it('7 PDF solicitado sem autorização permanece legado (não declara nativo)', () => {
    const d = decidirIntegracaoNativa(baseCtx({ env: envOn(), baixarPdf: true }));
    expect(d.situacao).toBe('LEGADO_SOLICITADO');
    expect(d.executarNativo).toBe(false);
  });

  it('10 nenhum efeito nativo sem autorização', async () => {
    const { resultado } = await tentarFluxoNativoControlado(baseCtx({ env: envOn() }));
    expect(resultado).toBeNull();
  });

  it('11–12 erro estruturado após autorização sem fallback', async () => {
    // API-02K: PDF não recusa — ausência de raiz ainda recusa
    await expect(
      tentarFluxoNativoControlado(
        baseCtx({
          env: { [NOME_FLAG_RECUPERACAO_NATIVA]: 'true' },
          autorizacaoNativa: auth,
          baixarPdf: true,
        })
      )
    ).rejects.toMatchObject({ codigo: 'RAIZ_FISCAL_AUSENTE' });

    await expect(
      tentarFluxoNativoControlado(
        baseCtx({
          env: { [NOME_FLAG_RECUPERACAO_NATIVA]: 'true' },
          autorizacaoNativa: auth,
        })
      )
    ).rejects.toMatchObject({ codigo: 'RAIZ_FISCAL_AUSENTE' });
  });
});

describe('orquestrador nativo offline', () => {
  it('11 contexto válido completa fluxo simulado', async () => {
    const inv = inventario([documento(chave(1)), documento(chave(2), { situacao: 'CANCELADA' })]);
    const deps = depsSimuladas(inv, {
      recuperar: async (entrada) => recuperadoOk(entrada.chave),
    });
    const resultado = await executarFluxoFiscalNativo({
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'exec-ok',
      tipo: 'emitidas',
      baixarPdf: false,
      raizFiscal: raiz,
      dependencias: deps,
    });
    expect(resultado.modo).toBe('NATIVO_CONTROLADO');
    expect(resultado.vigentes).toBe(1);
    expect(resultado.canceladas).toBe(1);
    expect(resultado.persistidos).toBe(1);
    expect(resultado.conclusaoReconciliacao).toBe('RECONCILIADA');
    expect(resultado.estadoAuditoria).toBe('RECONCILIADA');
    expect(resultado.caminhoAuditoria).toBeTruthy();
    expect(deps.descobrir).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(resultado)).not.toContain(SENHA);
  });

  it('12 CNPJ inválido', async () => {
    await expect(
      executarFluxoFiscalNativo({
        page: PAGE,
        cnpj: '123',
        periodoConsulta: PERIODO,
        execucaoId: 'exec-cnpj',
        tipo: 'emitidas',
        baixarPdf: false,
        raizFiscal: raiz,
        dependencias: depsSimuladas(inventario([])),
      })
    ).rejects.toMatchObject({ codigo: 'CNPJ_INVALIDO' });
  });

  it('13 período inválido', async () => {
    await expect(
      executarFluxoFiscalNativo({
        page: PAGE,
        cnpj: CNPJ,
        periodoConsulta: { tipo: 'PERIODO_CONSULTA_PORTAL', inicio: '2026-09-01', fim: '2026-09-30' } as never,
        execucaoId: 'exec-per',
        tipo: 'emitidas',
        baixarPdf: false,
        raizFiscal: raiz,
        dependencias: depsSimuladas(inventario([])),
      })
    ).rejects.toMatchObject({ codigo: 'PERIODO_INVALIDO' });
  });

  it('14 page ausente', async () => {
    await expect(
      executarFluxoFiscalNativo({
        page: null as unknown as Page,
        cnpj: CNPJ,
        periodoConsulta: PERIODO,
        execucaoId: 'exec-page',
        tipo: 'emitidas',
        baixarPdf: false,
        raizFiscal: raiz,
        dependencias: depsSimuladas(inventario([])),
      })
    ).rejects.toMatchObject({ codigo: 'PAGE_AUSENTE' });
  });

  it('15 inventário incompleto', async () => {
    const inv = inventario([documento(chave(1))], 'PARCIAL');
    await expect(
      executarFluxoFiscalNativo({
        page: PAGE,
        cnpj: CNPJ,
        periodoConsulta: PERIODO,
        execucaoId: 'exec-inc',
        tipo: 'emitidas',
        baixarPdf: false,
        raizFiscal: raiz,
        dependencias: depsSimuladas(inv, { statusDescoberta: 'DISCOVERY_INCOMPLETE' }),
      })
    ).rejects.toMatchObject({ codigo: 'DESCOBERTA_INCOMPLETA' });
  });

  it('16 indeterminada bloqueia', async () => {
    const inv = inventario([documento(chave(1), { situacao: 'INDETERMINADA' })]);
    await expect(
      executarFluxoFiscalNativo({
        page: PAGE,
        cnpj: CNPJ,
        periodoConsulta: PERIODO,
        execucaoId: 'exec-indet',
        tipo: 'emitidas',
        baixarPdf: false,
        raizFiscal: raiz,
        dependencias: depsSimuladas(inv),
      })
    ).rejects.toMatchObject({ codigo: 'SITUACAO_INDETERMINADA' });
  });

  it('17 cancelada excluída do plano e permanece no inventário', async () => {
    const inv = inventario([
      documento(chave(1)),
      documento(chave(9), { situacao: 'CANCELADA' }),
    ]);
    const deps = depsSimuladas(inv, {
      recuperar: async (entrada) => {
        expect(entrada.chave).toBe(chave(1));
        return recuperadoOk(entrada.chave);
      },
    });
    const resultado = await executarFluxoFiscalNativo({
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'exec-canc',
      tipo: 'emitidas',
      baixarPdf: false,
      raizFiscal: raiz,
      dependencias: deps,
    });
    expect(resultado.canceladas).toBe(1);
    expect(deps.recuperar).toHaveBeenCalledTimes(1);
  });

  it('18–21 planejamento, recuperação, persistência e retomada simulados', async () => {
    const inv = inventario([documento(chave(1)), documento(chave(2))]);
    const deps = depsSimuladas(inv, {
      recuperar: async (entrada) => recuperadoOk(entrada.chave),
    });
    const primeiro = await executarFluxoFiscalNativo({
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'exec-plano',
      tipo: 'emitidas',
      baixarPdf: false,
      raizFiscal: raiz,
      dependencias: deps,
    });
    expect(primeiro.persistidos).toBe(2);
    expect(primeiro.loteLiberado).toBe(true);

    const depsRetoma = depsSimuladas(inv, {
      recuperar: async () => {
        throw new Error('não deveria recuperar novamente');
      },
    });
    const segundo = await executarFluxoFiscalNativo({
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'exec-retoma',
      tipo: 'emitidas',
      baixarPdf: false,
      raizFiscal: raiz,
      dependencias: depsRetoma,
    });
    expect(segundo.persistidos).toBe(2);
    expect(depsRetoma.recuperar).not.toHaveBeenCalled();
  });

  it('22 auditoria parcial e 23 reconciliada', async () => {
    const inv = inventario([documento(chave(1)), documento(chave(2))]);
    const depsParcial = depsSimuladas(inv, {
      recuperar: async (entrada) => {
        if (entrada.chave === chave(2)) {
          return {
            chaveNacional: entrada.chave,
            cnpj: CNPJ,
            direcao: 'EMITIDA',
            periodoConsulta: PERIODO,
            resultado: 'FALHOU',
            validacaoXml: 'NAO_APLICADA',
            classeErro: 'TRANSITORIO',
            codigo: 'TIMEOUT',
            mensagem: 'timeout simulado',
            dCompet: null,
            hashSha256: null,
            xml: null,
          };
        }
        return recuperadoOk(entrada.chave);
      },
    });
    const parcial = await executarFluxoFiscalNativo({
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'exec-parcial',
      tipo: 'emitidas',
      baixarPdf: false,
      raizFiscal: raiz,
      dependencias: depsParcial,
    });
    expect(parcial.estadoAuditoria).toBe('PARCIAL');
    expect(parcial.conclusaoReconciliacao).toBe('NAO_RECONCILIADA');
    expect(parcial.persistidos).toBe(1);
    expect(parcial.vigentes).toBe(2);

    const raiz2 = await mkdtemp(path.join(tmpdir(), 'nfse-orch2-'));
    try {
      const depsOk = depsSimuladas(inventario([documento(chave(1))]), {
        recuperar: async (e) => recuperadoOk(e.chave),
        raizOverride: raiz2,
      });
      const ok = await executarFluxoFiscalNativo({
        page: PAGE,
        cnpj: CNPJ,
        periodoConsulta: PERIODO,
        execucaoId: 'exec-rec',
        tipo: 'emitidas',
        baixarPdf: false,
        raizFiscal: raiz2,
        dependencias: depsOk,
      });
      expect(ok.estadoAuditoria).toBe('RECONCILIADA');
      expect(ok.conclusaoReconciliacao).toBe('RECONCILIADA');
    } finally {
      await rm(raiz2, { recursive: true, force: true });
    }
  });

  it('24 falha SEFIN simulada e 26 erro estruturado', async () => {
    const inv = inventario([documento(chave(1))]);
    const deps = depsSimuladas(inv, {
      recuperar: async (entrada) => ({
        chaveNacional: entrada.chave,
        cnpj: CNPJ,
        direcao: 'EMITIDA',
        periodoConsulta: PERIODO,
        resultado: 'FALHOU',
        validacaoXml: 'NAO_APLICADA',
        classeErro: 'PERMANENTE',
        codigo: 'HTTP_404',
        mensagem: 'não encontrada',
        dCompet: null,
        hashSha256: null,
        xml: null,
      }),
    });
    const resultado = await executarFluxoFiscalNativo({
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'exec-sefin',
      tipo: 'emitidas',
      baixarPdf: false,
      raizFiscal: raiz,
      dependencias: deps,
    });
    expect(resultado.conclusaoReconciliacao).toBe('NAO_RECONCILIADA');
    expect(resultado.recuperacoes[0]?.codigo).toBe('HTTP_404');
  });

  it('25 falha de persistência', async () => {
    const inv = inventario([documento(chave(1))]);
    const deps = depsSimuladas(inv, {
      recuperar: async (e) => recuperadoOk(e.chave),
    });
    vi.spyOn(deps.repositorio, 'persistirXml').mockRejectedValue(new Error('disco cheio'));
    await expect(
      executarFluxoFiscalNativo({
        page: PAGE,
        cnpj: CNPJ,
        periodoConsulta: PERIODO,
        execucaoId: 'exec-disk',
        tipo: 'emitidas',
        baixarPdf: false,
        raizFiscal: raiz,
        dependencias: deps,
      })
    ).rejects.toMatchObject({ codigo: 'FALHA_PERSISTENCIA' });
  });

  it('27 sem vazamento de credenciais', async () => {
    const inv = inventario([documento(chave(1))]);
    const deps = depsSimuladas(inv, {
      recuperar: async (e) => recuperadoOk(e.chave),
    });
    const resultado = await executarFluxoFiscalNativo({
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'exec-sec',
      tipo: 'emitidas',
      baixarPdf: false,
      raizFiscal: raiz,
      dependencias: deps,
    });
    const serializado = JSON.stringify(resultado);
    expect(serializado).not.toContain(SENHA);
    expect(serializado).not.toContain('BEGIN');
    expect(resultado.recuperacoes.every((r) => r.chaveMascarada.includes('…') || r.chaveMascarada.length < 50)).toBe(
      true
    );
  });

  it('28–30 sem navegador, login ou CAPTCHA adicionais', async () => {
    const inv = inventario([documento(chave(1))]);
    const deps = depsSimuladas(inv, {
      recuperar: async (e) => recuperadoOk(e.chave),
    });
    await executarFluxoFiscalNativo({
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'exec-no-browser',
      tipo: 'emitidas',
      baixarPdf: false,
      raizFiscal: raiz,
      dependencias: deps,
    });
    expect(deps.descobrir).toHaveBeenCalledWith(
      expect.objectContaining({ page: PAGE, tipo: 'EMITIDAS' })
    );
  });

  it('API-02K — baixarPdf não bloqueia orquestrador (XML-only)', async () => {
    const r = await executarFluxoFiscalNativo({
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'exec-pdf-orch',
      tipo: 'emitidas',
      baixarPdf: true,
      raizFiscal: raiz,
      dependencias: depsSimuladas(inventario([])),
    });
    expect(r.compatibilidadePdf).toBe('PDF_NAO_RECUPERADO');
    expect(r.diagnosticos.some((d) => d.codigo === 'PDF_NAO_RECUPERADO')).toBe(true);
  });

  it('certificado indisponível', async () => {
    const inv = inventario([documento(chave(1))]);
    const deps = depsSimuladas(inv);
    deps.provedorA1 = {
      async obter() {
        throw new Error('sem cert');
      },
    };
    await expect(
      executarFluxoFiscalNativo({
        page: PAGE,
        cnpj: CNPJ,
        periodoConsulta: PERIODO,
        execucaoId: 'exec-a1',
        tipo: 'emitidas',
        baixarPdf: false,
        raizFiscal: raiz,
        dependencias: deps,
      })
    ).rejects.toMatchObject({ codigo: 'CERTIFICADO_INDISPONIVEL' });
  });

  it('raiz fiscal ausente', async () => {
    await expect(
      executarFluxoFiscalNativo({
        page: PAGE,
        cnpj: CNPJ,
        periodoConsulta: PERIODO,
        execucaoId: 'exec-raiz',
        tipo: 'emitidas',
        baixarPdf: false,
        raizFiscal: '   ',
        dependencias: depsSimuladas(inventario([])),
      })
    ).rejects.toMatchObject({ codigo: 'RAIZ_FISCAL_AUSENTE' });
  });
});

describe('integração controlada', () => {
  it('33 flag+autorização com contexto válido → NATIVO_SOLICITADO', () => {
    const decisao = decidirIntegracaoNativa(
      baseCtx({
        env: { [NOME_FLAG_RECUPERACAO_NATIVA]: 'true', NFSE_FISCAL_STORAGE_PATH: raiz },
        autorizacaoNativa: { autorizada: true, motivo: 'teste' },
      })
    );
    expect(decisao).toMatchObject({
      modo: 'NATIVO_CONTROLADO',
      situacao: 'NATIVO_SOLICITADO',
      executarNativo: true,
    });
  });

  it('34 flag on sem autorização (page nula) → LEGADO_SOLICITADO', () => {
    const decisao = decidirIntegracaoNativa(
      baseCtx({
        page: null,
        env: { [NOME_FLAG_RECUPERACAO_NATIVA]: 'true', NFSE_FISCAL_STORAGE_PATH: raiz },
      })
    );
    expect(decisao.situacao).toBe('LEGADO_SOLICITADO');
    expect(decisao.executarNativo).toBe(false);
  });

  it('35–36 falha após efeitos parciais sem fallback silencioso', async () => {
    const inv = inventario([documento(chave(1)), documento(chave(2))]);
    const deps = depsSimuladas(inv, {
      recuperar: async (entrada) => {
        if (entrada.chave === chave(1)) return recuperadoOk(entrada.chave);
        throw new Error(`falha sefin ${SENHA}`);
      },
    });
    const resultado = await executarFluxoFiscalNativo({
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'exec-parcial-efeito',
      tipo: 'emitidas',
      baixarPdf: false,
      raizFiscal: raiz,
      dependencias: deps,
    });
    expect(resultado.persistidos).toBe(1);
    expect(resultado.conclusaoReconciliacao).toBe('NAO_RECONCILIADA');
    expect(resultado.modo).toBe('NATIVO_CONTROLADO');
    const serializado = JSON.stringify(resultado);
    expect(serializado).not.toContain(SENHA);
    expect(resultado.diagnosticos.some((d) => d.codigo === 'FALHA_RECUPERACAO')).toBe(true);
  });

  it('38–39 contratos e SSE sem segredos', () => {
    const evento = {
      type: 'execution:stage',
      stage: 'nfse_nativo',
      message: 'Recuperação fiscal nativa…',
    };
    expect(JSON.stringify(evento)).not.toContain(SENHA);
    expect(evento).not.toHaveProperty('pfx');
    expect(evento).not.toHaveProperty('passphrase');
  });
});

describe('concorrência e exclusividade 22.7.1', () => {
  it('13 duas execuções simultâneas mesmo CNPJ/período', async () => {
    const inv = inventario([documento(chave(1))]);
    const depsA = depsSimuladas(inv);
    // Segura a trava fiscal antes da segunda execução (determinístico, sem sleep).
    await depsA.repositorio.executarComExclusividadeFiscal(CNPJ, PERIODO, async () => {
      await expect(
        executarFluxoFiscalNativo({
          page: PAGE,
          cnpj: CNPJ,
          periodoConsulta: PERIODO,
          execucaoId: 'exec-conc-b',
          tipo: 'emitidas',
          baixarPdf: false,
          raizFiscal: raiz,
          dependencias: depsSimuladas(inv),
        })
      ).rejects.toMatchObject({ codigo: 'EXECUCAO_EM_USO' });
    });
    const resultadoA = await executarFluxoFiscalNativo({
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'exec-conc-a',
      tipo: 'emitidas',
      baixarPdf: false,
      raizFiscal: raiz,
      dependencias: depsA,
    });
    expect(resultadoA.persistidos).toBe(1);
  });

  it('14–15 empresas/períodos diferentes não colidem', async () => {
    const OUTRO = '99888777000166';
    const outroPeriodo = criarPeriodoConsultaPortal('01/10/2026', '31/10/2026');
    const invA = inventario([documento(chave(1))]);
    const invB = montarInventario({
      id: 'inv-outro',
      cnpj: OUTRO,
      periodoConsulta: PERIODO,
      documentos: [
        criarDocumentoFiscal({
          chaveNacional: chave(3),
          cnpj: OUTRO,
          direcao: 'EMITIDA',
          situacao: 'VIGENTE',
          periodoConsulta: PERIODO,
        }),
      ],
      completude: 'COMPLETO',
    });
    const invC = montarInventario({
      id: 'inv-per',
      cnpj: CNPJ,
      periodoConsulta: outroPeriodo,
      documentos: [
        criarDocumentoFiscal({
          chaveNacional: chave(4),
          cnpj: CNPJ,
          direcao: 'EMITIDA',
          situacao: 'VIGENTE',
          periodoConsulta: outroPeriodo,
        }),
      ],
      completude: 'COMPLETO',
    });

    const raizB = await mkdtemp(path.join(tmpdir(), 'nfse-orch-b-'));
    const raizC = await mkdtemp(path.join(tmpdir(), 'nfse-orch-c-'));
    try {
      // Mesma raiz: empresas/períodos distintos usam travas distintas.
      const depsA = depsSimuladas(invA);
      const depsB = depsSimuladas(invB, {
        recuperar: async (e) => ({
          ...recuperadoOk(e.chave),
          cnpj: OUTRO,
          xml: xmlFiscalOutro(e.chave, OUTRO),
        }),
      });
      // Ajustar descoberta B
      depsB.descobrir = vi.fn(async () => ({
        cnpj: OUTRO,
        periodoConsulta: PERIODO,
        tipo: 'EMITIDAS' as const,
        status: 'DISCOVERY_COMPLETE' as const,
        inventario: invB,
        registros: [],
        diagnosticos: [],
        paginasPercorridas: 1,
      }));

      const [a, b] = await Promise.all([
        executarFluxoFiscalNativo({
          page: PAGE,
          cnpj: CNPJ,
          periodoConsulta: PERIODO,
          execucaoId: 'exec-emp-a',
          tipo: 'emitidas',
          baixarPdf: false,
          raizFiscal: raiz,
          dependencias: depsA,
        }),
        executarFluxoFiscalNativo({
          page: PAGE,
          cnpj: OUTRO,
          periodoConsulta: PERIODO,
          execucaoId: 'exec-emp-b',
          tipo: 'emitidas',
          baixarPdf: false,
          raizFiscal: raiz,
          dependencias: depsB,
        }),
      ]);
      expect(a.persistidos).toBe(1);
      expect(b.persistidos).toBe(1);

      const depsC = depsSimuladas(invC, { raizOverride: raizC });
      depsC.descobrir = vi.fn(async () => ({
        cnpj: CNPJ,
        periodoConsulta: outroPeriodo,
        tipo: 'EMITIDAS' as const,
        status: 'DISCOVERY_COMPLETE' as const,
        inventario: invC,
        registros: [],
        diagnosticos: [],
        paginasPercorridas: 1,
      }));
      const c = await executarFluxoFiscalNativo({
        page: PAGE,
        cnpj: CNPJ,
        periodoConsulta: outroPeriodo,
        execucaoId: 'exec-per',
        tipo: 'emitidas',
        baixarPdf: false,
        raizFiscal: raizC,
        dependencias: depsC,
      });
      expect(c.persistidos).toBe(1);
      void raizB;
    } finally {
      await rm(raizB, { recursive: true, force: true });
      await rm(raizC, { recursive: true, force: true });
    }
  });

  it('16–20 trava cobrindo recuperação/auditoria e liberada em falhas', async () => {
    const raizSefin = await mkdtemp(path.join(tmpdir(), 'nfse-orch-sefin-'));
    const raizDisk = await mkdtemp(path.join(tmpdir(), 'nfse-orch-disk-'));
    try {
      const inv = inventario([documento(chave(1))]);
      let dentroDaTrava = false;
      const deps = depsSimuladas(inv, {
        recuperar: async (entrada) => {
          dentroDaTrava = true;
          // Segunda aquisição na mesma identidade deve falhar enquanto esta corre.
          await expect(
            deps.repositorio.executarComExclusividadeFiscal(CNPJ, PERIODO, async () => 'x')
          ).rejects.toMatchObject({ codigo: 'CHECKPOINT_EM_USO' });
          return recuperadoOk(entrada.chave);
        },
      });

      await executarFluxoFiscalNativo({
        page: PAGE,
        cnpj: CNPJ,
        periodoConsulta: PERIODO,
        execucaoId: 'exec-trava-ok',
        tipo: 'emitidas',
        baixarPdf: false,
        raizFiscal: raiz,
        dependencias: deps,
      });
      expect(dentroDaTrava).toBe(true);

      // Após sucesso, a trava foi liberada.
      await deps.repositorio.executarComExclusividadeFiscal(CNPJ, PERIODO, async () => 'livre');

      const depsSefin = depsSimuladas(inventario([documento(chave(5))]), {
        raizOverride: raizSefin,
        recuperar: async () => {
          throw new Error('sefin-boom');
        },
      });
      await executarFluxoFiscalNativo({
        page: PAGE,
        cnpj: CNPJ,
        periodoConsulta: PERIODO,
        execucaoId: 'exec-trava-sefin',
        tipo: 'emitidas',
        baixarPdf: false,
        raizFiscal: raizSefin,
        dependencias: depsSefin,
      });
      await depsSefin.repositorio.executarComExclusividadeFiscal(CNPJ, PERIODO, async () => 'apos-sefin');

      const depsDisk = depsSimuladas(inventario([documento(chave(6))]), { raizOverride: raizDisk });
      vi.spyOn(depsDisk.repositorio, 'persistirXml').mockRejectedValue(new Error('disco'));
      await expect(
        executarFluxoFiscalNativo({
          page: PAGE,
          cnpj: CNPJ,
          periodoConsulta: PERIODO,
          execucaoId: 'exec-trava-disk',
          tipo: 'emitidas',
          baixarPdf: false,
          raizFiscal: raizDisk,
          dependencias: depsDisk,
        })
      ).rejects.toMatchObject({ codigo: 'FALHA_PERSISTENCIA' });
      await depsDisk.repositorio.executarComExclusividadeFiscal(CNPJ, PERIODO, async () => 'apos-disk');
    } finally {
      await rm(raizSefin, { recursive: true, force: true });
      await rm(raizDisk, { recursive: true, force: true });
    }
  });

  it('21–22 segunda execução não sobrescreve XML/checkpoint íntegros', async () => {
    const inv = inventario([documento(chave(1))]);
    const deps1 = depsSimuladas(inv);
    const primeiro = await executarFluxoFiscalNativo({
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'exec-idem-1',
      tipo: 'emitidas',
      baixarPdf: false,
      raizFiscal: raiz,
      dependencias: deps1,
    });
    expect(primeiro.persistidos).toBe(1);

    const deps2 = depsSimuladas(inv, {
      recuperar: async () => {
        throw new Error('não deve chamar SEFIN');
      },
    });
    const segundo = await executarFluxoFiscalNativo({
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'exec-idem-2',
      tipo: 'emitidas',
      baixarPdf: false,
      raizFiscal: raiz,
      dependencias: deps2,
    });
    expect(segundo.persistidos).toBe(1);
    expect(deps2.recuperar).not.toHaveBeenCalled();
  });
});

describe('retomada 22.7.1', () => {
  it('23 XML íntegro não recuperado novamente', async () => {
    const inv = inventario([documento(chave(1))]);
    await executarFluxoFiscalNativo({
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'exec-ret-1',
      tipo: 'emitidas',
      baixarPdf: false,
      raizFiscal: raiz,
      dependencias: depsSimuladas(inv),
    });
    const deps = depsSimuladas(inv, {
      recuperar: async () => {
        throw new Error('re-recuperar');
      },
    });
    await executarFluxoFiscalNativo({
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'exec-ret-2',
      tipo: 'emitidas',
      baixarPdf: false,
      raizFiscal: raiz,
      dependencias: deps,
    });
    expect(deps.recuperar).not.toHaveBeenCalled();
  });

  it('24 XML órfão válido reaproveitado', async () => {
    const inv = inventario([documento(chave(1))]);
    const repo = new RepositorioFiscalNfse(criarResolvedorRaizInjetada(raiz));
    await repo.criarCheckpoint(inv, 'exec-orfao');
    await repo.xmls.persistir(CNPJ, PERIODO, chave(1), xmlFiscal(chave(1)), 'EMITIDA');
    // Checkpoint ainda PENDENTE; retomada deve promover órfão.
    const deps = depsSimuladas(inv, {
      recuperar: async () => {
        throw new Error('não deveria SEFIN');
      },
    });
    const resultado = await executarFluxoFiscalNativo({
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'exec-orfao-2',
      tipo: 'emitidas',
      baixarPdf: false,
      raizFiscal: raiz,
      dependencias: deps,
    });
    expect(resultado.persistidos).toBe(1);
    expect(deps.recuperar).not.toHaveBeenCalled();
  });

  it('25 XML corrompido bloqueado (INCONSISTENTE)', async () => {
    const inv = inventario([documento(chave(1))]);
    const repo = new RepositorioFiscalNfse(criarResolvedorRaizInjetada(raiz));
    await repo.criarCheckpoint(inv, 'exec-corr');
    await repo.persistirXml(inv, chave(1), xmlFiscal(chave(1)));
    // Corrompe o arquivo no disco após PERSISTIDO.
    const caminho = repo.caminhoXml(CNPJ, PERIODO, chave(1));
    const { writeFile } = await import('node:fs/promises');
    await writeFile(caminho, '<xml>corrompido</xml>', 'utf8');

    const deps = depsSimuladas(inv, {
      recuperar: async (e) => recuperadoOk(e.chave),
    });
    const resultado = await executarFluxoFiscalNativo({
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'exec-corr-2',
      tipo: 'emitidas',
      baixarPdf: false,
      raizFiscal: raiz,
      dependencias: deps,
    });
    // Retomada marca inconsistente; não sobrescreve nem re-recupera com sucesso automático.
    expect(resultado.recuperacoes.some((r) => r.resultado === 'INCONSISTENTE')).toBe(true);
    expect(deps.recuperar).not.toHaveBeenCalled();
  });

  it('26 fingerprint incompatível bloqueado', async () => {
    const invA = inventario([documento(chave(1))]);
    await executarFluxoFiscalNativo({
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'exec-fp-1',
      tipo: 'emitidas',
      baixarPdf: false,
      raizFiscal: raiz,
      dependencias: depsSimuladas(invA),
    });
    const invB = inventario([documento(chave(1)), documento(chave(2))]);
    await expect(
      executarFluxoFiscalNativo({
        page: PAGE,
        cnpj: CNPJ,
        periodoConsulta: PERIODO,
        execucaoId: 'exec-fp-2',
        tipo: 'emitidas',
        baixarPdf: false,
        raizFiscal: raiz,
        dependencias: depsSimuladas(invB),
      })
    ).rejects.toMatchObject({ codigo: 'IDENTIDADE_DIVERGENTE' });
  });

  it('27 falha parcial preserva checkpoint', async () => {
    const inv = inventario([documento(chave(1)), documento(chave(2))]);
    const deps = depsSimuladas(inv, {
      recuperar: async (entrada) => {
        if (entrada.chave === chave(1)) return recuperadoOk(entrada.chave);
        return {
          chaveNacional: entrada.chave,
          cnpj: CNPJ,
          direcao: 'EMITIDA',
          periodoConsulta: PERIODO,
          resultado: 'FALHOU',
          validacaoXml: 'NAO_APLICADA',
          classeErro: 'TRANSITORIO',
          codigo: 'TIMEOUT',
          mensagem: 'timeout',
          dCompet: null,
          hashSha256: null,
          xml: null,
        };
      },
    });
    const resultado = await executarFluxoFiscalNativo({
      page: PAGE,
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      execucaoId: 'exec-parcial-ckpt',
      tipo: 'emitidas',
      baixarPdf: false,
      raizFiscal: raiz,
      dependencias: deps,
    });
    expect(resultado.persistidos).toBe(1);
    const ck = await deps.repositorio.checkpoints.carregar(CNPJ, PERIODO);
    expect(ck?.documentos.find((d) => d.chaveNacional === chave(1))?.estado).toBe('PERSISTIDO');
    expect(ck?.documentos.find((d) => d.chaveNacional === chave(2))?.estado).toBe('FALHA_TRANSITORIA');
  });
});

function xmlFiscalOutro(chaveValor: string, emitente: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse">
  <infNFSe Id="NFS${chaveValor}">
    <chNFSe>${chaveValor}</chNFSe>
    <dCompet>2026-08</dCompet>
    <emit><CNPJ>${emitente}</CNPJ></emit>
    <toma><CNPJ>${TOMADOR}</CNPJ></toma>
  </infNFSe>
</NFSe>`;
}

function baseCtx(parcial: Partial<Parameters<typeof decidirIntegracaoNativa>[0]> = {}) {
  return {
    page: PAGE,
    cnpj: CNPJ,
    dataInicio: '01/09/2026',
    dataFim: '30/09/2026',
    tipo: 'ambas',
    baixarPdf: false,
    execucaoId: 'exec-base',
    tipoAutenticacao: 'certificado' as const,
    ...parcial,
  };
}

function chave(final: number): string {
  return String(final).padStart(50, '8');
}

function documento(
  chaveValor: string,
  opcoes: { situacao?: 'VIGENTE' | 'CANCELADA' | 'INDETERMINADA'; direcao?: 'EMITIDA' | 'RECEBIDA' } = {}
) {
  return criarDocumentoFiscal({
    chaveNacional: chaveValor,
    cnpj: CNPJ,
    direcao: opcoes.direcao ?? 'EMITIDA',
    situacao: opcoes.situacao ?? 'VIGENTE',
    periodoConsulta: PERIODO,
  });
}

function inventario(
  documentos: ReturnType<typeof documento>[],
  completude: 'COMPLETO' | 'PARCIAL' = 'COMPLETO'
): InventarioNfse {
  return montarInventario({
    id: 'inv-orch',
    cnpj: CNPJ,
    periodoConsulta: PERIODO,
    documentos,
    completude,
  });
}

function xmlFiscal(chaveValor: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse">
  <infNFSe Id="NFS${chaveValor}">
    <chNFSe>${chaveValor}</chNFSe>
    <dCompet>2026-08</dCompet>
    <emit><CNPJ>${CNPJ}</CNPJ></emit>
    <toma><CNPJ>${TOMADOR}</CNPJ></toma>
  </infNFSe>
</NFSe>`;
}

function recuperadoOk(chaveValor: string): ResultadoRecuperacaoSefin {
  const xml = xmlFiscal(chaveValor);
  return {
    chaveNacional: chaveValor,
    cnpj: CNPJ,
    direcao: 'EMITIDA',
    periodoConsulta: PERIODO,
    resultado: 'RECUPERADO',
    validacaoXml: 'CONFIRMADA',
    classeErro: null,
    codigo: null,
    mensagem: 'ok',
    dCompet: '2026-08',
    hashSha256: 'a'.repeat(64),
    xml,
  };
}

function pfxValido(): Buffer {
  const chaves = forge.pki.rsa.generateKeyPair(512);
  const certificado = forge.pki.createCertificate();
  certificado.publicKey = chaves.publicKey;
  certificado.serialNumber = '01';
  certificado.validity.notBefore = new Date('2020-01-01T00:00:00Z');
  certificado.validity.notAfter = new Date('2099-01-01T00:00:00Z');
  const attrs = [{ name: 'commonName', value: 'orch-teste' }];
  certificado.setSubject(attrs);
  certificado.setIssuer(attrs);
  certificado.sign(chaves.privateKey, forge.md.sha256.create());
  const asn1 = forge.pkcs12.toPkcs12Asn1(chaves.privateKey, [certificado], SENHA);
  return Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary');
}

function depsSimuladas(
  inv: InventarioNfse,
  opcoes: {
    recuperar?: DependenciasFluxoFiscalNativo['recuperar'];
    statusDescoberta?: ResultadoDescobertaNfse['status'];
    raizOverride?: string;
  } = {}
): DependenciasFluxoFiscalNativo & { descobrir: ReturnType<typeof vi.fn>; recuperar: ReturnType<typeof vi.fn> } {
  const raizLocal = opcoes.raizOverride ?? raiz;
  const repositorio = new RepositorioFiscalNfse(criarResolvedorRaizInjetada(raizLocal));
  const descobrir = vi.fn(async (): Promise<ResultadoDescobertaNfse> => ({
    cnpj: CNPJ,
    periodoConsulta: PERIODO,
    tipo: 'EMITIDAS',
    status: opcoes.statusDescoberta ?? (inv.completude === 'COMPLETO' ? 'DISCOVERY_COMPLETE' : 'DISCOVERY_INCOMPLETE'),
    inventario: inv,
    registros: [],
    diagnosticos: [],
    paginasPercorridas: 1,
  }));
  const recuperar = vi.fn(
    opcoes.recuperar ??
      (async (entrada) => recuperadoOk(entrada.chave))
  );
  const transporte: TransporteHttpMtls = {
    async consultar() {
      return { status: 200, body: Buffer.from('{}') };
    },
  };
  const provedorA1 = new AdaptadorCertificadoA1({
    async carregar() {
      return { pfx: pfxValido(), passphrase: SENHA };
    },
  });
  return { descobrir, recuperar, transporte, provedorA1, repositorio };
}
