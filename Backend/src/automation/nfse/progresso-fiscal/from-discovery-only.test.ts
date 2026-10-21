/**
 * UI-01e-B — testes offline do adaptador Discovery-Only → progresso fiscal.
 * Sem Portal Nacional, sem SEFIN, sem certificado real, sem banco operacional.
 */
import { describe, expect, it } from 'vitest';
import { criarPeriodoConsultaPortal } from '../contracts/periodo';
import type { ResultadoDiscoveryOnlyHomologacao } from '../homologacao/types';
import {
  progressoFiscalDeDiscoveryOnly,
  progressoFiscalSemDadosSensiveis,
} from './from-discovery-only';
import { emitirProgressoFiscalSeAssociado } from '../../../services/execution-events.service';
import type { ExecutionEvent } from '../../../services/execution-events.service';

const PERIODO = criarPeriodoConsultaPortal('01/01/2024', '31/01/2024');

function baseResultado(
  parcial: Partial<ResultadoDiscoveryOnlyHomologacao> &
    Pick<ResultadoDiscoveryOnlyHomologacao, 'veredito' | 'estadoInventario' | 'totais'>
): ResultadoDiscoveryOnlyHomologacao {
  return {
    execucaoId: '42',
    cnpjMascarado: '12.***.***/****-90',
    periodoConsulta: PERIODO,
    diagnosticos: [],
    evidencias: [],
    limitesAplicados: {
      maxDocumentos: 500,
      maxPaginas: 50,
      maxRequisicoesSefin: 0,
      timeoutMs: 60_000,
    },
    codigoErro: null,
    efeitosProibidos: {
      sefin: false,
      escritaXml: false,
      checkpointRecuperacao: false,
      navegadorAdicional: false,
      loginAdicional: false,
    },
    ...parcial,
  };
}

const ID = {
  batchId: 'batch-abc',
  empresaId: '7',
  execucaoId: '42',
  cnpj: '12345678000190',
};

describe('progressoFiscalDeDiscoveryOnly', () => {
  it('1. inventário completo + PASS → inventário/validação completa; recuperação nao_executada', () => {
    const r = progressoFiscalDeDiscoveryOnly({
      identidade: ID,
      resultado: baseResultado({
        veredito: 'PASS',
        estadoInventario: 'COMPLETO',
        totais: {
          emitidas: 10,
          recebidas: 5,
          vigentes: 12,
          canceladas: 3,
          indeterminadas: 0,
          paginas: 2,
        },
      }),
      estadoOperacional: 'CONCLUIDA',
    });
    expect(r.inventario.estado).toBe('completa');
    expect(r.inventario.completude).toBe('COMPLETO');
    expect(r.inventario.conclusao_confiavel).toBe(true);
    expect(r.inventario.totais.descobertos).toBe(15);
    expect(r.validacao.estado).toBe('completa');
    expect(r.validacao.conclusao_confiavel).toBe(true);
    expect(r.recuperacao.estado).toBe('nao_executada');
    expect(r.recuperacao.conclusao_confiavel).toBe(false);
  });

  it('2. inventário parcial → classificação parcial; não declara conclusão completa', () => {
    const r = progressoFiscalDeDiscoveryOnly({
      identidade: ID,
      resultado: baseResultado({
        veredito: 'INCOMPLETO',
        estadoInventario: 'PARCIAL',
        totais: {
          emitidas: 4,
          recebidas: 1,
          vigentes: 3,
          canceladas: 1,
          indeterminadas: 1,
          paginas: 1,
        },
        codigoErro: 'LIMITE_PAGINAS',
      }),
      estadoOperacional: 'INCOMPLETA',
    });
    expect(r.inventario.estado).toBe('limite');
    expect(r.inventario.conclusao_confiavel).toBe(false);
    expect(r.validacao.estado).toBe('limite');
    expect(r.validacao.conclusao_confiavel).toBe(false);
    expect(r.inventario.totais.emitidas).toBe(4);
  });

  it('3. inventário indeterminado → parcial, sem sucesso inferido', () => {
    const r = progressoFiscalDeDiscoveryOnly({
      identidade: ID,
      resultado: baseResultado({
        veredito: 'INCOMPLETO',
        estadoInventario: 'INDETERMINADO',
        totais: {
          emitidas: 0,
          recebidas: 0,
          vigentes: 0,
          canceladas: 0,
          indeterminadas: 2,
          paginas: 1,
        },
        codigoErro: 'SITUACAO_INDETERMINADA',
      }),
      estadoOperacional: 'INCOMPLETA',
    });
    expect(r.inventario.estado).toBe('parcial');
    expect(r.inventario.completude).toBe('INDETERMINADO');
    expect(r.inventario.conclusao_confiavel).toBe(false);
    expect(r.validacao.estado).toBe('parcial');
  });

  it('4–7. expõe emitidas, recebidas, canceladas, vigentes e indeterminadas', () => {
    const r = progressoFiscalDeDiscoveryOnly({
      identidade: ID,
      resultado: baseResultado({
        veredito: 'PASS',
        estadoInventario: 'COMPLETO',
        totais: {
          emitidas: 8,
          recebidas: 2,
          vigentes: 7,
          canceladas: 2,
          indeterminadas: 1,
          paginas: 3,
        },
      }),
      estadoOperacional: 'CONCLUIDA',
    });
    expect(r.inventario.totais.emitidas).toBe(8);
    expect(r.inventario.totais.recebidas).toBe(2);
    expect(r.inventario.totais.canceladas).toBe(2);
    expect(r.inventario.totais.vigentes).toBe(7);
    expect(r.inventario.totais.indeterminadas).toBe(1);
    expect(r.validacao.vigentes).toBe(7);
    expect(r.validacao.canceladas).toBe(2);
    expect(r.validacao.indeterminadas).toBe(1);
  });

  it('8. classificação parcial quando inventário incompleto mesmo com totais', () => {
    const r = progressoFiscalDeDiscoveryOnly({
      identidade: ID,
      resultado: baseResultado({
        veredito: 'INCOMPLETO',
        estadoInventario: 'PARCIAL',
        totais: {
          emitidas: 20,
          recebidas: 10,
          vigentes: 25,
          canceladas: 5,
          indeterminadas: 0,
          paginas: 5,
        },
        codigoErro: 'INVENTARIO_INCOMPLETO',
      }),
      estadoOperacional: 'INCOMPLETA',
    });
    expect(r.inventario.estado).toBe('parcial');
    expect(r.validacao.estado).toBe('parcial');
    expect(r.validacao.conclusao_confiavel).toBe(false);
  });

  it('9. Discovery cancelada', () => {
    const r = progressoFiscalDeDiscoveryOnly({
      identidade: ID,
      resultado: baseResultado({
        veredito: 'FAIL',
        estadoInventario: 'PARCIAL',
        totais: {
          emitidas: 1,
          recebidas: 0,
          vigentes: 1,
          canceladas: 0,
          indeterminadas: 0,
          paginas: 1,
        },
        codigoErro: 'INTERRUPCAO',
      }),
      estadoOperacional: 'CANCELADA',
    });
    expect(r.inventario.estado).toBe('cancelada');
    expect(r.validacao.estado).toBe('cancelada');
  });

  it('10. Discovery bloqueada (sem resultadoDiscovery)', () => {
    const r = progressoFiscalDeDiscoveryOnly({
      identidade: ID,
      resultado: null,
      estadoOperacional: 'BLOQUEADA',
      codigoErroPonte: 'GATE_EXECUCAO_FECHADO',
      motivo: 'Gate fechado',
    });
    expect(r.inventario.estado).toBe('falha');
    expect(r.inventario.totais.descobertos).toBe(0);
    expect(r.validacao.estado).toBe('indisponivel');
    expect(r.recuperacao.estado).toBe('nao_executada');
    expect(r.codigo).toBe('GATE_EXECUCAO_FECHADO');
  });

  it('11. timeout', () => {
    const r = progressoFiscalDeDiscoveryOnly({
      identidade: ID,
      resultado: baseResultado({
        veredito: 'INCOMPLETO',
        estadoInventario: 'PARCIAL',
        totais: {
          emitidas: 3,
          recebidas: 0,
          vigentes: 2,
          canceladas: 0,
          indeterminadas: 1,
          paginas: 1,
        },
        codigoErro: 'TIMEOUT',
      }),
      estadoOperacional: 'INCOMPLETA',
    });
    expect(r.inventario.estado).toBe('timeout');
    expect(r.inventario.conclusao_confiavel).toBe(false);
  });

  it('12. limite de páginas', () => {
    const r = progressoFiscalDeDiscoveryOnly({
      identidade: ID,
      resultado: baseResultado({
        veredito: 'INCOMPLETO',
        estadoInventario: 'PARCIAL',
        totais: {
          emitidas: 50,
          recebidas: 0,
          vigentes: 50,
          canceladas: 0,
          indeterminadas: 0,
          paginas: 50,
        },
        codigoErro: 'LIMITE_PAGINAS',
      }),
      estadoOperacional: 'INCOMPLETA',
    });
    expect(r.inventario.estado).toBe('limite');
    expect(r.codigo).toBe('LIMITE_PAGINAS');
  });

  it('13. limite de documentos', () => {
    const r = progressoFiscalDeDiscoveryOnly({
      identidade: ID,
      resultado: baseResultado({
        veredito: 'INCOMPLETO',
        estadoInventario: 'PARCIAL',
        totais: {
          emitidas: 500,
          recebidas: 0,
          vigentes: 500,
          canceladas: 0,
          indeterminadas: 0,
          paginas: 10,
        },
        codigoErro: 'LIMITE_DOCUMENTOS',
      }),
      estadoOperacional: 'INCOMPLETA',
    });
    expect(r.inventario.estado).toBe('limite');
    expect(r.codigo).toBe('LIMITE_DOCUMENTOS');
  });

  it('14. falha de descoberta', () => {
    const r = progressoFiscalDeDiscoveryOnly({
      identidade: ID,
      resultado: baseResultado({
        veredito: 'FAIL',
        estadoInventario: 'INDETERMINADO',
        totais: {
          emitidas: 0,
          recebidas: 0,
          vigentes: 0,
          canceladas: 0,
          indeterminadas: 0,
          paginas: 0,
        },
        codigoErro: 'CONTEXTO_INVALIDO',
      }),
      estadoOperacional: 'FALHA',
    });
    expect(r.inventario.estado).toBe('falha');
    expect(r.veredito_discovery).toBe('FAIL');
  });

  it('15. recuperação sempre nao_executada (Discovery-Only)', () => {
    for (const estado of ['CONCLUIDA', 'INCOMPLETA', 'FALHA', 'CANCELADA', 'BLOQUEADA'] as const) {
      const r = progressoFiscalDeDiscoveryOnly({
        identidade: ID,
        resultado:
          estado === 'BLOQUEADA'
            ? null
            : baseResultado({
                veredito: 'PASS',
                estadoInventario: 'COMPLETO',
                totais: {
                  emitidas: 1,
                  recebidas: 0,
                  vigentes: 1,
                  canceladas: 0,
                  indeterminadas: 0,
                  paginas: 1,
                },
              }),
        estadoOperacional: estado,
      });
      expect(r.recuperacao.estado).toBe('nao_executada');
    }
  });

  it('não inventa percentual nem trata count isolado como inventário completo', () => {
    const r = progressoFiscalDeDiscoveryOnly({
      identidade: ID,
      resultado: baseResultado({
        veredito: 'INCOMPLETO',
        estadoInventario: 'PARCIAL',
        totais: {
          emitidas: 100,
          recebidas: 100,
          vigentes: 200,
          canceladas: 0,
          indeterminadas: 0,
          paginas: 1,
        },
      }),
      estadoOperacional: 'INCOMPLETA',
    });
    expect(r.inventario.estado).not.toBe('completa');
    expect(JSON.stringify(r)).not.toMatch(/percent|%/i);
  });

  it('22. ausência de dados sensíveis no progresso', () => {
    const r = progressoFiscalDeDiscoveryOnly({
      identidade: ID,
      resultado: baseResultado({
        veredito: 'PASS',
        estadoInventario: 'COMPLETO',
        totais: {
          emitidas: 1,
          recebidas: 1,
          vigentes: 2,
          canceladas: 0,
          indeterminadas: 0,
          paginas: 1,
        },
      }),
      estadoOperacional: 'CONCLUIDA',
      motivo: 'ok',
    });
    expect(progressoFiscalSemDadosSensiveis(r)).toBe(true);
    const raw = JSON.stringify(r);
    expect(raw).not.toMatch(/senha|password|pfx|cookie|-----BEGIN|<nfse/i);
  });

  it('18. identidade canônica: execucao_id ≠ batch_id; correlaciona empresa', () => {
    const r = progressoFiscalDeDiscoveryOnly({
      identidade: {
        batchId: 'lote-1',
        empresaId: '99',
        execucaoId: '1001',
        cnpj: '00000000000191',
      },
      resultado: baseResultado({
        veredito: 'PASS',
        estadoInventario: 'COMPLETO',
        totais: {
          emitidas: 0,
          recebidas: 0,
          vigentes: 0,
          canceladas: 0,
          indeterminadas: 0,
          paginas: 0,
        },
      }),
    });
    expect(r.batch_id).toBe('lote-1');
    expect(r.empresa_id).toBe('99');
    expect(r.execucao_id).toBe('1001');
    expect(r.execucao_id).not.toBe(r.batch_id);
  });
});

describe('emitirProgressoFiscalSeAssociado / correlação SSE', () => {
  it('16. ausência de batchId → não emite', () => {
    const fiscal = progressoFiscalDeDiscoveryOnly({
      identidade: { ...ID, batchId: null },
      resultado: null,
      estadoOperacional: 'BLOQUEADA',
    });
    expect(
      emitirProgressoFiscalSeAssociado({
        batchId: undefined,
        empresaId: ID.empresaId,
        execucaoId: ID.execucaoId,
        cnpj: ID.cnpj,
        fiscal,
      })
    ).toBe(false);
  });

  it('17. batchId válido + associação → emite (sem clientes SSE é no-op seguro)', () => {
    const fiscal = progressoFiscalDeDiscoveryOnly({
      identidade: ID,
      resultado: baseResultado({
        veredito: 'PASS',
        estadoInventario: 'COMPLETO',
        totais: {
          emitidas: 1,
          recebidas: 0,
          vigentes: 1,
          canceladas: 0,
          indeterminadas: 0,
          paginas: 1,
        },
      }),
      estadoOperacional: 'CONCLUIDA',
    });
    expect(
      emitirProgressoFiscalSeAssociado({
        batchId: ID.batchId,
        empresaId: ID.empresaId,
        execucaoId: ID.execucaoId,
        cnpj: ID.cnpj,
        fiscal,
      })
    ).toBe(true);
  });

  it('18–19. rejeita associação cruzada (outra empresa / outro lote)', () => {
    const fiscal = progressoFiscalDeDiscoveryOnly({
      identidade: ID,
      resultado: null,
      estadoOperacional: 'BLOQUEADA',
    });
    expect(
      emitirProgressoFiscalSeAssociado({
        batchId: ID.batchId,
        empresaId: '999',
        execucaoId: ID.execucaoId,
        cnpj: ID.cnpj,
        fiscal,
      })
    ).toBe(false);
    expect(
      emitirProgressoFiscalSeAssociado({
        batchId: 'outro-lote',
        empresaId: ID.empresaId,
        execucaoId: ID.execucaoId,
        cnpj: ID.cnpj,
        fiscal: { ...fiscal, batch_id: ID.batchId },
      })
    ).toBe(false);
  });

  it('20. eventos legados mantêm shape (compatibilidade tipada)', () => {
    const legados: ExecutionEvent[] = [
      {
        type: 'execution:started',
        empresa_id: '1',
        cnpj: '1',
        metodo: 'CERTIFICADO',
      },
      { type: 'execution:stage', empresa_id: '1', stage: 'x', message: 'y' },
      {
        type: 'execution:counts',
        empresa_id: '1',
        qtd_emitidas: 1,
        qtd_recebidas: 2,
        qtd_canceladas: 0,
      },
      {
        type: 'execution:finished',
        empresa_id: '1',
        status: 'OK',
        qtd_emitidas: 1,
        qtd_recebidas: 2,
      },
      { type: 'execution:login_ready', empresa_id: '1', message: 'ok' },
    ];
    for (const e of legados) {
      expect(e.type.startsWith('execution:')).toBe(true);
      expect(e.type).not.toBe('execution:fiscal');
      if (e.type === 'execution:counts') {
        expect(e).toHaveProperty('qtd_emitidas');
        expect(e).not.toHaveProperty('fiscal');
      }
    }
  });

  it('21. polling legado: campo fiscal é opcional e isolado por identidade', () => {
    const fiscalA = progressoFiscalDeDiscoveryOnly({
      identidade: { ...ID, batchId: 'lote-A', empresaId: '1', execucaoId: '10' },
      resultado: baseResultado({
        veredito: 'PASS',
        estadoInventario: 'COMPLETO',
        totais: {
          emitidas: 1,
          recebidas: 0,
          vigentes: 1,
          canceladas: 0,
          indeterminadas: 0,
          paginas: 1,
        },
      }),
    });
    const fiscalB = progressoFiscalDeDiscoveryOnly({
      identidade: { ...ID, batchId: 'lote-B', empresaId: '2', execucaoId: '20' },
      resultado: baseResultado({
        veredito: 'PASS',
        estadoInventario: 'COMPLETO',
        totais: {
          emitidas: 9,
          recebidas: 0,
          vigentes: 9,
          canceladas: 0,
          indeterminadas: 0,
          paginas: 1,
        },
      }),
    });
    const legadoSemFiscal = {
      empresa_id: '1',
      status: 'em_andamento',
      qtd_notas_emitidas: 0,
    };
    const comFiscal = { ...legadoSemFiscal, fiscal: fiscalA };
    expect(legadoSemFiscal).not.toHaveProperty('fiscal');
    expect(comFiscal.fiscal.empresa_id).toBe('1');
    expect(comFiscal.fiscal.batch_id).not.toBe(fiscalB.batch_id);
    expect(comFiscal.fiscal.inventario.totais.emitidas).not.toBe(
      fiscalB.inventario.totais.emitidas
    );
  });
});
