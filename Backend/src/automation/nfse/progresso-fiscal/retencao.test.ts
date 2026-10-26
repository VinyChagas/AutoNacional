/**
 * UI-01e-B1 — ciclo de vida / retenção do progresso fiscal (offline).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { obterStatusBatch } from '../../../services/execution-service';
import type { ExecutionEvent } from '../../../services/execution-events.service';
import { progressoFiscalDeDiscoveryOnly } from './from-discovery-only';
import type { ResultadoDiscoveryOnlyHomologacao } from '../homologacao/types';
import { criarPeriodoConsultaPortal } from '../contracts/periodo';
import {
  limparRetencaoProgressoFiscal,
  listarSnapshotsPorLote,
  obterSnapshotPorExecucao,
  obterSnapshotPorLoteEmpresa,
  retenirProgressoFiscal,
  tamanhoRetencaoProgressoFiscal,
  type SnapshotProgressoFiscalPolling,
} from './retencao';

const PERIODO = criarPeriodoConsultaPortal('01/03/2024', '31/03/2024');

function resultado(
  parcial: Partial<ResultadoDiscoveryOnlyHomologacao> &
    Pick<ResultadoDiscoveryOnlyHomologacao, 'veredito' | 'estadoInventario' | 'totais'>
): ResultadoDiscoveryOnlyHomologacao {
  return {
    execucaoId: '100',
    cnpjMascarado: '12.***.***/****-90',
    periodoConsulta: PERIODO,
    diagnosticos: [],
    evidencias: [],
    limitesAplicados: {
      maxDocumentos: 100,
      maxPaginas: 10,
      maxRequisicoesSefin: 0,
      timeoutMs: 30_000,
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

function snap(opts: {
  batchId: string | null;
  empresaId: string;
  execucaoId: string;
  cnpj?: string;
  estadoOp?: 'CONCLUIDA' | 'INCOMPLETA' | 'CANCELADA' | 'BLOQUEADA' | 'FALHA';
  resultado?: ResultadoDiscoveryOnlyHomologacao | null;
  periodoInicio?: string;
  periodoFim?: string;
}): SnapshotProgressoFiscalPolling {
  const fiscal = progressoFiscalDeDiscoveryOnly({
    identidade: {
      batchId: opts.batchId,
      empresaId: opts.empresaId,
      execucaoId: opts.execucaoId,
      cnpj: opts.cnpj ?? '12345678000190',
    },
    resultado: opts.resultado === undefined
      ? resultado({
          veredito: 'PASS',
          estadoInventario: 'COMPLETO',
          totais: {
            emitidas: 2,
            recebidas: 1,
            vigentes: 3,
            canceladas: 0,
            indeterminadas: 0,
            paginas: 1,
          },
        })
      : opts.resultado,
    estadoOperacional: opts.estadoOp ?? 'CONCLUIDA',
  });
  return {
    empresa_id: opts.empresaId,
    cnpj: opts.cnpj ?? '12345678000190',
    batch_id: opts.batchId,
    execucao_id: opts.execucaoId,
    status: 'concluido',
    etapa_atual: 'finalizacao',
    progresso: 100,
    mensagem: 'ok',
    qtd_notas_emitidas: fiscal.inventario.totais.emitidas,
    qtd_notas_recebidas: fiscal.inventario.totais.recebidas,
    qtd_notas_canceladas: fiscal.inventario.totais.canceladas,
    resultado_final: 'NFS_ENCONTRADAS',
    periodo_inicio: opts.periodoInicio ?? '01/03/2024',
    periodo_fim: opts.periodoFim ?? '31/03/2024',
    fiscal,
  };
}

afterEach(() => {
  limparRetencaoProgressoFiscal();
});

describe('retenção progresso fiscal (UI-01e-B1)', () => {
  it('1. progresso durante execução — retido e consultável por execução', () => {
    const s = snap({ batchId: 'lote-1', empresaId: '7', execucaoId: '101' });
    retenirProgressoFiscal(s, { marcadoFinalizado: false });
    expect(obterSnapshotPorExecucao('101')?.fiscal.inventario.totais.emitidas).toBe(2);
    expect(tamanhoRetencaoProgressoFiscal()).toBe(1);
  });

  it('2–3. progresso após finalização — polling de lote ainda retorna fiscal', async () => {
    retenirProgressoFiscal(snap({ batchId: 'lote-fin', empresaId: '7', execucaoId: '202' }), {
      marcadoFinalizado: true,
    });
    // Simula remoção de execucoesAtivas: só retenção permanece.
    const rows = await obterStatusBatch('lote-fin');
    expect(rows).toHaveLength(1);
    expect(rows[0].fiscal).toBeDefined();
    expect((rows[0].fiscal as { execucao_id: string }).execucao_id).toBe('202');
    expect(rows[0].empresa_id).toBe('7');
  });

  it('4. reinicialização simulada — retenção some (não sobrevive a restart)', async () => {
    retenirProgressoFiscal(snap({ batchId: 'lote-r', empresaId: '1', execucaoId: '1' }), {
      marcadoFinalizado: true,
    });
    limparRetencaoProgressoFiscal();
    expect(tamanhoRetencaoProgressoFiscal()).toBe(0);
    const rows = await obterStatusBatch('lote-r');
    expect(rows).toHaveLength(0);
  });

  it('5. execução sem progresso fiscal — retenção não inventa', () => {
    expect(obterSnapshotPorLoteEmpresa('lote-x', '9')).toBeNull();
    expect(listarSnapshotsPorLote('lote-x')).toHaveLength(0);
  });

  it('6. inventário parcial preservado na retenção', () => {
    retenirProgressoFiscal(
      snap({
        batchId: 'lote-p',
        empresaId: '3',
        execucaoId: '30',
        estadoOp: 'INCOMPLETA',
        resultado: resultado({
          veredito: 'INCOMPLETO',
          estadoInventario: 'PARCIAL',
          totais: {
            emitidas: 4,
            recebidas: 0,
            vigentes: 3,
            canceladas: 0,
            indeterminadas: 1,
            paginas: 2,
          },
          codigoErro: 'LIMITE_PAGINAS',
        }),
      })
    );
    const f = obterSnapshotPorLoteEmpresa('lote-p', '3')!.fiscal;
    expect(f.inventario.completude).toBe('PARCIAL');
    expect(f.inventario.estado).toBe('limite');
    expect(f.inventario.conclusao_confiavel).toBe(false);
    expect(f.validacao.estado).toBe('limite');
  });

  it('7. execução cancelada', () => {
    retenirProgressoFiscal(
      snap({
        batchId: 'lote-c',
        empresaId: '4',
        execucaoId: '40',
        estadoOp: 'CANCELADA',
        resultado: resultado({
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
      })
    );
    expect(obterSnapshotPorExecucao('40')!.fiscal.inventario.estado).toBe('cancelada');
  });

  it('8. execução bloqueada (sem resultado Discovery)', () => {
    retenirProgressoFiscal(
      snap({
        batchId: 'lote-b',
        empresaId: '5',
        execucaoId: '50',
        estadoOp: 'BLOQUEADA',
        resultado: null,
      })
    );
    const f = obterSnapshotPorExecucao('50')!.fiscal;
    expect(f.inventario.estado).toBe('falha');
    expect(f.recuperacao.estado).toBe('nao_executada');
  });

  it('9. execuções diferentes da mesma empresa — isoladas por execucao_id', () => {
    retenirProgressoFiscal(
      snap({ batchId: 'lote-a', empresaId: '8', execucaoId: '801', cnpj: '111' })
    );
    retenirProgressoFiscal(
      snap({
        batchId: 'lote-b2',
        empresaId: '8',
        execucaoId: '802',
        cnpj: '111',
        resultado: resultado({
          veredito: 'PASS',
          estadoInventario: 'COMPLETO',
          totais: {
            emitidas: 99,
            recebidas: 0,
            vigentes: 99,
            canceladas: 0,
            indeterminadas: 0,
            paginas: 1,
          },
        }),
      })
    );
    expect(obterSnapshotPorExecucao('801')!.fiscal.inventario.totais.emitidas).toBe(2);
    expect(obterSnapshotPorExecucao('802')!.fiscal.inventario.totais.emitidas).toBe(99);
  });

  it('10. competências diferentes — snapshots distintos (período + execução)', () => {
    retenirProgressoFiscal(
      snap({
        batchId: 'lote-comp-1',
        empresaId: '2',
        execucaoId: '21',
        periodoInicio: '01/01/2024',
        periodoFim: '31/01/2024',
      })
    );
    retenirProgressoFiscal(
      snap({
        batchId: 'lote-comp-2',
        empresaId: '2',
        execucaoId: '22',
        periodoInicio: '01/02/2024',
        periodoFim: '29/02/2024',
        resultado: resultado({
          veredito: 'PASS',
          estadoInventario: 'COMPLETO',
          totais: {
            emitidas: 7,
            recebidas: 0,
            vigentes: 7,
            canceladas: 0,
            indeterminadas: 0,
            paginas: 1,
          },
        }),
      })
    );
    expect(obterSnapshotPorLoteEmpresa('lote-comp-1', '2')!.periodo_inicio).toBe('01/01/2024');
    expect(obterSnapshotPorLoteEmpresa('lote-comp-2', '2')!.fiscal.inventario.totais.emitidas).toBe(7);
  });

  it('11. lotes diferentes — listarSnapshotsPorLote isola', async () => {
    retenirProgressoFiscal(snap({ batchId: 'L1', empresaId: '1', execucaoId: '11' }));
    retenirProgressoFiscal(snap({ batchId: 'L2', empresaId: '1', execucaoId: '12' }));
    expect(listarSnapshotsPorLote('L1')).toHaveLength(1);
    expect(listarSnapshotsPorLote('L2')).toHaveLength(1);
    const r1 = await obterStatusBatch('L1');
    const r2 = await obterStatusBatch('L2');
    expect(r1[0].batch_id).toBe('L1');
    expect(r2[0].batch_id).toBe('L2');
    expect((r1[0].fiscal as { execucao_id: string }).execucao_id).toBe('11');
    expect((r2[0].fiscal as { execucao_id: string }).execucao_id).toBe('12');
  });

  it('12. homologação administrativa sem batchId — retida por execução, fora do polling de lote', async () => {
    retenirProgressoFiscal(snap({ batchId: null, empresaId: '77', execucaoId: '770' }));
    expect(obterSnapshotPorExecucao('770')).not.toBeNull();
    expect(listarSnapshotsPorLote('qualquer')).toHaveLength(0);
    const rows = await obterStatusBatch('lote-comum');
    expect(rows.every((r) => r.empresa_id !== '77')).toBe(true);
  });

  it('13. ausência de vazamento entre empresas', async () => {
    retenirProgressoFiscal(snap({ batchId: 'lote-v', empresaId: '10', execucaoId: '1000' }));
    retenirProgressoFiscal(
      snap({
        batchId: 'lote-v',
        empresaId: '11',
        execucaoId: '1001',
        resultado: resultado({
          veredito: 'PASS',
          estadoInventario: 'COMPLETO',
          totais: {
            emitidas: 50,
            recebidas: 0,
            vigentes: 50,
            canceladas: 0,
            indeterminadas: 0,
            paginas: 1,
          },
        }),
      })
    );
    const a = obterSnapshotPorLoteEmpresa('lote-v', '10')!;
    const b = obterSnapshotPorLoteEmpresa('lote-v', '11')!;
    expect(a.fiscal.inventario.totais.emitidas).toBe(2);
    expect(b.fiscal.inventario.totais.emitidas).toBe(50);
    const rows = await obterStatusBatch('lote-v');
    expect(rows).toHaveLength(2);
    const byEmp = Object.fromEntries(rows.map((r) => [r.empresa_id, r]));
    expect((byEmp['10'].fiscal as { inventario: { totais: { emitidas: number } } }).inventario.totais.emitidas).toBe(2);
    expect((byEmp['11'].fiscal as { inventario: { totais: { emitidas: number } } }).inventario.totais.emitidas).toBe(50);
  });

  it('14. compatibilidade SSE legado — shapes inalterados', () => {
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
        qtd_recebidas: 0,
      },
      { type: 'execution:finished', empresa_id: '1', status: 'OK' },
      { type: 'execution:login_ready', empresa_id: '1', message: 'ok' },
    ];
    for (const e of legados) {
      expect(Object.keys(e)).not.toContain('fiscal');
    }
  });

  it('rejeita associação cruzada lote/empresa no snapshot', () => {
    const s = snap({ batchId: 'lote-ok', empresaId: '1', execucaoId: '1' });
    s.fiscal = { ...s.fiscal, empresa_id: '999' };
    retenirProgressoFiscal(s);
    expect(obterSnapshotPorExecucao('1')).toBeNull();
  });
});
