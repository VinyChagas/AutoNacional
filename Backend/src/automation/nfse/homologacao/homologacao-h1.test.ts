/**
 * Homologação H1 — autorização, limites e gates offline.
 * Sem browser, SEFIN, Portal, certificados reais ou efeitos no legado.
 */
import { describe, expect, it } from 'vitest';
import { criarDocumentoFiscal } from '../contracts/documento-fiscal';
import { montarInventario } from '../contracts/inventario';
import { criarPeriodoConsultaPortal } from '../contracts/periodo';
import { decidirIntegracaoNativa } from '../orchestration';
import { NOME_FLAG_RECUPERACAO_NATIVA } from '../orchestration/feature-flag';
import {
  ControladorLimitesHomologacao,
  HomologacaoNfseError,
  criarAutorizacaoHomologacao,
  criarLimitesHomologacao,
  ehAutorizacaoHomologacaoEstruturada,
  evidenciaContemSegredo,
  prepararDiscoveryOnly,
  prepararSefinRecovery,
  registrarEvidenciaHomologacao,
  simularConsumoRequisicoesSefin,
  validarAutorizacaoHomologacao,
} from './index';
import type { AutorizacaoHomologacaoNfse, ContextoValidacaoHomologacao } from './types';

const CNPJ = '12345678000199';
const OUTRO = '99888777000166';
const PERIODO = criarPeriodoConsultaPortal('01/09/2026', '30/09/2026');
const OUTRO_PERIODO = criarPeriodoConsultaPortal('01/10/2026', '31/10/2026');
const DIR = '/tmp/nfse-fiscal-h1-autorizado';
const AGORA = new Date('2026-10-20T12:00:00.000Z');
const VALIDO_ATE = '2026-10-21T12:00:00.000Z';

describe('homologação H1 — autorização e gates', () => {
  it('01 autorização válida', () => {
    const auth = authDiscovery();
    const validada = validarAutorizacaoHomologacao(auth, ctx('DISCOVERY_ONLY'));
    expect(validada.cnpj).toBe(CNPJ);
    expect(validada.operacao).toBe('DISCOVERY_ONLY');
  });

  it('02 CNPJ divergente', () => {
    expect(() =>
      validarAutorizacaoHomologacao(authDiscovery(), {
        ...ctx('DISCOVERY_ONLY'),
        cnpj: OUTRO,
      })
    ).toThrow(HomologacaoNfseError);
    try {
      validarAutorizacaoHomologacao(authDiscovery(), { ...ctx('DISCOVERY_ONLY'), cnpj: OUTRO });
    } catch (e) {
      expect((e as HomologacaoNfseError).codigo).toBe('CNPJ_DIVERGENTE');
    }
  });

  it('03 período divergente', () => {
    try {
      validarAutorizacaoHomologacao(authDiscovery(), {
        ...ctx('DISCOVERY_ONLY'),
        periodoConsulta: OUTRO_PERIODO,
      });
      expect.fail('deveria falhar');
    } catch (e) {
      expect((e as HomologacaoNfseError).codigo).toBe('PERIODO_DIVERGENTE');
    }
  });

  it('04 execução divergente', () => {
    try {
      validarAutorizacaoHomologacao(authDiscovery(), {
        ...ctx('DISCOVERY_ONLY'),
        execucaoId: 'outra-exec',
      });
      expect.fail('deveria falhar');
    } catch (e) {
      expect((e as HomologacaoNfseError).codigo).toBe('EXECUCAO_DIVERGENTE');
    }
  });

  it('05 autorização expirada', () => {
    try {
      validarAutorizacaoHomologacao(authDiscovery(), {
        ...ctx('DISCOVERY_ONLY'),
        agora: new Date('2026-10-22T00:00:00.000Z'),
      });
      expect.fail('deveria falhar');
    } catch (e) {
      expect((e as HomologacaoNfseError).codigo).toBe('AUTORIZACAO_EXPIRADA');
    }
  });

  it('06 operação não autorizada', () => {
    try {
      validarAutorizacaoHomologacao(authDiscovery(), ctx('SEFIN_RECOVERY'));
      expect.fail('deveria falhar');
    } catch (e) {
      expect((e as HomologacaoNfseError).codigo).toBe('OPERACAO_NAO_AUTORIZADA');
    }
  });

  it('07 diretório divergente', () => {
    try {
      validarAutorizacaoHomologacao(authDiscovery(), {
        ...ctx('DISCOVERY_ONLY'),
        diretorioFiscal: '/tmp/outro-diretorio-fiscal',
      });
      expect.fail('deveria falhar');
    } catch (e) {
      expect((e as HomologacaoNfseError).codigo).toBe('DIRETORIO_DIVERGENTE');
    }
  });

  it('08 limite de documentos excedido', () => {
    const auth = authDiscovery({ maxDocumentos: 2 });
    const { limites } = prepararDiscoveryOnly({
      autorizacao: auth,
      contexto: ctx('DISCOVERY_ONLY'),
      quantidadeDocumentosEstimada: 2,
    });
    expect(() => limites.exigirDocumentos(3)).toThrow(
      expect.objectContaining({ codigo: 'LIMITE_DOCUMENTOS' })
    );
  });

  it('09 limite de requisições excedido', () => {
    const auth = authSefin({ maxRequisicoesSefin: 2 });
    const limites = new ControladorLimitesHomologacao(auth.limites);
    simularConsumoRequisicoesSefin(limites, 2);
    expect(() => limites.exigirProximaRequisicaoSefin()).toThrow(
      expect.objectContaining({ codigo: 'LIMITE_REQUISICOES' })
    );
  });

  it('10 autorização ausente', () => {
    expect(() => validarAutorizacaoHomologacao(null, ctx('DISCOVERY_ONLY'))).toThrow(
      expect.objectContaining({ codigo: 'AUTORIZACAO_AUSENTE' })
    );
  });

  it('11 autorização malformada / autorizada:true isolado insuficiente', () => {
    expect(ehAutorizacaoHomologacaoEstruturada({ autorizada: true })).toBe(false);
    expect(
      ehAutorizacaoHomologacaoEstruturada({
        autorizada: true,
        versao: 1,
        cnpj: CNPJ,
        senha: 'SEGREDO',
      })
    ).toBe(false);
    expect(() =>
      validarAutorizacaoHomologacao(
        { autorizada: true } as unknown as AutorizacaoHomologacaoNfse,
        ctx('DISCOVERY_ONLY')
      )
    ).toThrow(expect.objectContaining({ codigo: 'AUTORIZACAO_MALFORMADA' }));
  });

  it('12 DISCOVERY_ONLY sem SEFIN', () => {
    const { gate, evidencia } = prepararDiscoveryOnly({
      autorizacao: authDiscovery(),
      contexto: ctx('DISCOVERY_ONLY'),
      quantidadeDocumentosEstimada: 1,
    });
    expect(gate.permiteSefin).toBe(false);
    expect(gate.permitePersistenciaXml).toBe(false);
    expect(gate.permiteCheckpointRecuperacao).toBe(false);
    expect(evidenciaContemSegredo(evidencia)).toBe(false);
  });

  it('13 SEFIN_RECOVERY sem autorização', () => {
    expect(() =>
      prepararSefinRecovery({
        autorizacao: null,
        contexto: ctx('SEFIN_RECOVERY'),
        inventario: inventarioVigente(1),
        certificadoDisponivel: true,
      })
    ).toThrow(expect.objectContaining({ codigo: 'AUTORIZACAO_AUSENTE' }));
  });

  it('14 certificado indisponível', () => {
    expect(() =>
      prepararSefinRecovery({
        autorizacao: authSefin(),
        contexto: ctx('SEFIN_RECOVERY'),
        inventario: inventarioVigente(1),
        certificadoDisponivel: false,
      })
    ).toThrow(expect.objectContaining({ codigo: 'CERTIFICADO_INDISPONIVEL' }));
  });

  it('15 inventário incompleto', () => {
    const inv = montarInventario({
      id: 'inv-parcial',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      documentos: [documento(1)],
      completude: 'PARCIAL',
    });
    expect(() =>
      prepararSefinRecovery({
        autorizacao: authSefin(),
        contexto: ctx('SEFIN_RECOVERY'),
        inventario: inv,
        certificadoDisponivel: true,
      })
    ).toThrow(expect.objectContaining({ codigo: 'INVENTARIO_INCOMPLETO' }));
  });

  it('16 canceladas não recuperadas (só vigentes elegíveis)', () => {
    const inv = montarInventario({
      id: 'inv-canc',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      documentos: [
        documento(1, 'VIGENTE'),
        documento(2, 'CANCELADA'),
      ],
      completude: 'COMPLETO',
    });
    const prep = prepararSefinRecovery({
      autorizacao: authSefin({ maxDocumentos: 10, maxRequisicoesSefin: 5 }),
      contexto: ctx('SEFIN_RECOVERY'),
      inventario: inv,
      certificadoDisponivel: true,
    });
    expect(prep.elegiveis).toBe(1);
    expect(prep.evidencia.detalhes.canceladas).toBe(1);
  });

  it('17 indeterminadas elegíveis à SEFIN (API-03M)', () => {
    const inv = montarInventario({
      id: 'inv-indet',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      documentos: [documento(1, 'INDETERMINADA')],
      completude: 'COMPLETO',
    });
    const prep = prepararSefinRecovery({
      autorizacao: authSefin(),
      contexto: ctx('SEFIN_RECOVERY'),
      inventario: inv,
      certificadoDisponivel: true,
    });
    expect(prep.elegiveis).toBe(1);
  });

  it('18 interrupção segura', () => {
    const limites = new ControladorLimitesHomologacao(
      criarLimitesHomologacao({ maxDocumentos: 10, maxRequisicoesSefin: 10, timeoutMs: 1000 })
    );
    limites.interromper('operador solicitou parada');
    expect(limites.foiInterrompido()).toBe(true);
    expect(() => limites.exigirProximaRequisicaoSefin()).toThrow(
      expect.objectContaining({ codigo: 'INTERRUPCAO' })
    );
  });

  it('19 ausência de efeitos no legado (autorizada:true isolado não ativa nativo H1)', () => {
    const decisao = decidirIntegracaoNativa({
      page: { url: () => 'about:blank' } as never,
      cnpj: CNPJ,
      dataInicio: '01/09/2026',
      dataFim: '30/09/2026',
      tipo: 'ambas',
      baixarPdf: false,
      execucaoId: 'exec-legado',
      tipoAutenticacao: 'certificado',
      env: {
        [NOME_FLAG_RECUPERACAO_NATIVA]: 'true',
        NFSE_FISCAL_STORAGE_PATH: DIR,
      },
      // Commit 07: só { autorizada: true } — H1 exige contrato vinculado.
      autorizacaoNativa: { autorizada: true },
    });
    // Com auth Commit 07 o nativo operacional ainda pode ser solicitado;
    // o contrato H1 estruturado NÃO é esse objeto genérico.
    expect(ehAutorizacaoHomologacaoEstruturada({ autorizada: true })).toBe(false);
    expect(decisao.situacao === 'NATIVO_SOLICITADO' || decisao.situacao === 'LEGADO_SOLICITADO').toBe(
      true
    );
    // Sem autorização H1, prepararDiscoveryOnly falha.
    expect(() =>
      prepararDiscoveryOnly({
        autorizacao: { autorizada: true } as never,
        contexto: ctx('DISCOVERY_ONLY'),
      })
    ).toThrow(expect.objectContaining({ codigo: 'AUTORIZACAO_MALFORMADA' }));
  });

  it('20 nenhuma chamada real (evidência e preparação locais)', () => {
    const evid = registrarEvidenciaHomologacao({
      execucaoId: 'exec-h1',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      operacao: 'DISCOVERY_ONLY',
      evento: 'teste_offline',
      detalhes: { http: 0, browser: 0, sefin: false },
      agora: AGORA,
    });
    expect(evid.cnpjMascarado).toMatch(/…/);
    expect(JSON.stringify(evid)).not.toContain(CNPJ);
    expect(evidenciaContemSegredo(evid)).toBe(false);

    const prep = prepararSefinRecovery({
      autorizacao: authSefin(),
      contexto: ctx('SEFIN_RECOVERY'),
      inventario: inventarioVigente(1),
      certificadoDisponivel: true,
    });
    // Não consome requisição até simular.
    expect(prep.limites.contagem().requisicoesSefin).toBe(0);
  });

  it('DISCOVERY_ONLY rejeita maxRequisicoesSefin > 0 na criação', () => {
    try {
      criarAutorizacaoHomologacao({
        cnpj: CNPJ,
        periodoConsulta: PERIODO,
        execucaoId: 'exec-h1',
        operacao: 'DISCOVERY_ONLY',
        validoAte: VALIDO_ATE,
        diretorioFiscal: DIR,
        limites: criarLimitesHomologacao({ maxDocumentos: 5, maxRequisicoesSefin: 1 }),
        agora: AGORA,
      });
      expect.fail('deveria falhar');
    } catch (e) {
      expect((e as HomologacaoNfseError).codigo).toBe('AUTORIZACAO_MALFORMADA');
    }
  });
});

function ctx(operacao: 'DISCOVERY_ONLY' | 'SEFIN_RECOVERY'): ContextoValidacaoHomologacao {
  return {
    cnpj: CNPJ,
    periodoConsulta: PERIODO,
    execucaoId: 'exec-h1',
    operacaoSolicitada: operacao,
    diretorioFiscal: DIR,
    agora: AGORA,
  };
}

function authDiscovery(
  limites: Partial<{ maxDocumentos: number; maxRequisicoesSefin: number }> = {}
): AutorizacaoHomologacaoNfse {
  return criarAutorizacaoHomologacao({
    cnpj: CNPJ,
    periodoConsulta: PERIODO,
    execucaoId: 'exec-h1',
    operacao: 'DISCOVERY_ONLY',
    validoAte: VALIDO_ATE,
    diretorioFiscal: DIR,
    limites: criarLimitesHomologacao({
      maxDocumentos: limites.maxDocumentos ?? 5,
      maxRequisicoesSefin: limites.maxRequisicoesSefin ?? 0,
      timeoutMs: 30_000,
    }),
    motivo: 'teste-h1-discovery',
    agora: AGORA,
  });
}

function authSefin(
  limites: Partial<{ maxDocumentos: number; maxRequisicoesSefin: number }> = {}
): AutorizacaoHomologacaoNfse {
  return criarAutorizacaoHomologacao({
    cnpj: CNPJ,
    periodoConsulta: PERIODO,
    execucaoId: 'exec-h1',
    operacao: 'SEFIN_RECOVERY',
    validoAte: VALIDO_ATE,
    diretorioFiscal: DIR,
    limites: criarLimitesHomologacao({
      maxDocumentos: limites.maxDocumentos ?? 5,
      maxRequisicoesSefin: limites.maxRequisicoesSefin ?? 3,
      timeoutMs: 30_000,
    }),
    motivo: 'teste-h1-sefin',
    agora: AGORA,
  });
}

function chave(n: number): string {
  return String(n).padStart(50, '1');
}

function documento(n: number, situacao: 'VIGENTE' | 'CANCELADA' | 'INDETERMINADA' = 'VIGENTE') {
  return criarDocumentoFiscal({
    chaveNacional: chave(n),
    cnpj: CNPJ,
    direcao: 'EMITIDA',
    situacao,
    periodoConsulta: PERIODO,
  });
}

function inventarioVigente(qtd: number) {
  return montarInventario({
    id: 'inv-h1',
    cnpj: CNPJ,
    periodoConsulta: PERIODO,
    documentos: Array.from({ length: qtd }, (_, i) => documento(i + 1)),
    completude: 'COMPLETO',
  });
}
