/**
 * UI-01e-B2 — retenção limitada (TTL, teto, índices, imutabilidade). Relógio controlado.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { obterStatusBatch } from '../../../services/execution-service';
import type { ExecutionEvent } from '../../../services/execution-events.service';
import { progressoFiscalDeDiscoveryOnly } from './from-discovery-only';
import { criarPeriodoConsultaPortal } from '../contracts/periodo';
import type { ResultadoDiscoveryOnlyHomologacao } from '../homologacao/types';
import {
  RETENCAO_FISCAL_MAX_SNAPSHOTS,
  RETENCAO_FISCAL_TTL_MS,
  definirRelogioRetencaoFiscal,
  descartesRetencaoPorLimiteAtivas,
  limparRetencaoProgressoFiscal,
  listarSnapshotsPorLote,
  obterMetadadosRetencaoFiscal,
  obterSnapshotPorExecucao,
  obterSnapshotPorLoteEmpresa,
  retenirProgressoFiscal,
  tamanhoRetencaoProgressoFiscal,
  type SnapshotProgressoFiscalPolling,
} from './retencao';

const PERIODO = criarPeriodoConsultaPortal('01/04/2024', '30/04/2024');
const T0 = 1_700_000_000_000;

function resultado(
  parcial: Partial<ResultadoDiscoveryOnlyHomologacao> &
    Pick<ResultadoDiscoveryOnlyHomologacao, 'veredito' | 'estadoInventario' | 'totais'>
): ResultadoDiscoveryOnlyHomologacao {
  return {
    execucaoId: '1',
    cnpjMascarado: '12.***.***/****-90',
    periodoConsulta: PERIODO,
    diagnosticos: [],
    evidencias: [],
    limitesAplicados: {
      maxDocumentos: 50,
      maxPaginas: 5,
      maxRequisicoesSefin: 0,
      timeoutMs: 10_000,
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

function snap(
  execucaoId: string,
  opts?: {
    batchId?: string | null;
    empresaId?: string;
    emitidas?: number;
  }
): SnapshotProgressoFiscalPolling {
  const batchId = opts?.batchId === undefined ? 'lote-lim' : opts.batchId;
  const empresaId = opts?.empresaId ?? execucaoId;
  const emitidas = opts?.emitidas ?? 1;
  const fiscal = progressoFiscalDeDiscoveryOnly({
    identidade: {
      batchId,
      empresaId,
      execucaoId,
      cnpj: '12345678000190',
    },
    resultado: resultado({
      veredito: 'PASS',
      estadoInventario: 'COMPLETO',
      totais: {
        emitidas,
        recebidas: 0,
        vigentes: emitidas,
        canceladas: 0,
        indeterminadas: 0,
        paginas: 1,
      },
    }),
    estadoOperacional: 'CONCLUIDA',
  });
  return {
    empresa_id: empresaId,
    cnpj: '12345678000190',
    batch_id: batchId,
    execucao_id: execucaoId,
    status: 'concluido',
    etapa_atual: 'finalizacao',
    progresso: 100,
    mensagem: 'ok',
    qtd_notas_emitidas: emitidas,
    qtd_notas_recebidas: 0,
    qtd_notas_canceladas: 0,
    resultado_final: 'NFS_ENCONTRADAS',
    fiscal,
  };
}

afterEach(() => {
  limparRetencaoProgressoFiscal();
  definirRelogioRetencaoFiscal(null);
});

describe('retenção limitada UI-01e-B2', () => {
  it('1–3. TTL 24h: não expirado permanece; expirado some', () => {
    let agora = T0;
    definirRelogioRetencaoFiscal(() => agora);

    expect(RETENCAO_FISCAL_TTL_MS).toBe(24 * 60 * 60 * 1000);

    retenirProgressoFiscal(snap('10'), { marcadoFinalizado: true, agora: T0 });
    expect(obterSnapshotPorExecucao('10')).not.toBeNull();

    agora = T0 + RETENCAO_FISCAL_TTL_MS;
    expect(obterSnapshotPorExecucao('10')).not.toBeNull();

    agora = T0 + RETENCAO_FISCAL_TTL_MS + 1;
    expect(obterSnapshotPorExecucao('10')).toBeNull();
    expect(tamanhoRetencaoProgressoFiscal()).toBe(0);
  });

  it('4–5. limite 2000 remove finalizados mais antigos', () => {
    expect(RETENCAO_FISCAL_MAX_SNAPSHOTS).toBe(2000);
    let agora = T0;
    definirRelogioRetencaoFiscal(() => agora);

    for (let i = 0; i < RETENCAO_FISCAL_MAX_SNAPSHOTS; i++) {
      agora = T0 + i;
      retenirProgressoFiscal(snap(String(i), { batchId: `b-${i}`, empresaId: String(i) }), {
        marcadoFinalizado: true,
        agora,
      });
    }
    expect(tamanhoRetencaoProgressoFiscal()).toBe(RETENCAO_FISCAL_MAX_SNAPSHOTS);
    expect(obterSnapshotPorExecucao('0')).not.toBeNull();

    agora = T0 + RETENCAO_FISCAL_MAX_SNAPSHOTS;
    expect(
      retenirProgressoFiscal(snap('novo', { batchId: 'b-novo', empresaId: 'novo' }), {
        marcadoFinalizado: true,
        agora,
      })
    ).toBe(true);
    expect(tamanhoRetencaoProgressoFiscal()).toBe(RETENCAO_FISCAL_MAX_SNAPSHOTS);
    expect(obterSnapshotPorExecucao('0')).toBeNull();
    expect(obterSnapshotPorExecucao('novo')).not.toBeNull();
    expect(obterSnapshotPorLoteEmpresa('b-0', '0')).toBeNull();
  });

  it('6. integridade dos índices após remoção por TTL', () => {
    let agora = T0;
    definirRelogioRetencaoFiscal(() => agora);
    retenirProgressoFiscal(snap('55', { batchId: 'lote-idx', empresaId: '9' }), {
      marcadoFinalizado: true,
      agora: T0,
    });
    expect(obterSnapshotPorLoteEmpresa('lote-idx', '9')).not.toBeNull();
    agora = T0 + RETENCAO_FISCAL_TTL_MS + 1;
    expect(obterSnapshotPorLoteEmpresa('lote-idx', '9')).toBeNull();
    expect(listarSnapshotsPorLote('lote-idx')).toHaveLength(0);
  });

  it('7. atualização sem duplicidade', () => {
    retenirProgressoFiscal(snap('70', { emitidas: 1 }), { marcadoFinalizado: false });
    retenirProgressoFiscal(snap('70', { emitidas: 5 }), { marcadoFinalizado: true });
    expect(tamanhoRetencaoProgressoFiscal()).toBe(1);
    expect(obterSnapshotPorExecucao('70')!.qtd_notas_emitidas).toBe(5);
    expect(obterMetadadosRetencaoFiscal('70')?.finalizadoEm).not.toBeNull();
  });

  it('8–10. isolamento lotes / empresas / execuções da mesma empresa', () => {
    retenirProgressoFiscal(snap('801', { batchId: 'L-A', empresaId: '8', emitidas: 1 }), {
      marcadoFinalizado: true,
    });
    retenirProgressoFiscal(snap('802', { batchId: 'L-B', empresaId: '8', emitidas: 9 }), {
      marcadoFinalizado: true,
    });
    retenirProgressoFiscal(snap('901', { batchId: 'L-A', empresaId: '9', emitidas: 3 }), {
      marcadoFinalizado: true,
    });
    expect(listarSnapshotsPorLote('L-A')).toHaveLength(2);
    expect(listarSnapshotsPorLote('L-B')).toHaveLength(1);
    expect(obterSnapshotPorLoteEmpresa('L-A', '8')!.fiscal.inventario.totais.emitidas).toBe(1);
    expect(obterSnapshotPorLoteEmpresa('L-B', '8')!.fiscal.inventario.totais.emitidas).toBe(9);
    expect(obterSnapshotPorExecucao('801')!.empresa_id).toBe('8');
    expect(obterSnapshotPorExecucao('901')!.empresa_id).toBe('9');
  });

  it('11. imutabilidade — mutar retorno não altera store', () => {
    retenirProgressoFiscal(snap('im', { emitidas: 2 }), { marcadoFinalizado: true });
    const a = obterSnapshotPorExecucao('im')!;
    a.qtd_notas_emitidas = 999;
    a.fiscal.inventario.totais.emitidas = 999;
    const b = obterSnapshotPorExecucao('im')!;
    expect(b.qtd_notas_emitidas).toBe(2);
    expect(b.fiscal.inventario.totais.emitidas).toBe(2);
  });

  it('12. polling após expiração omite fiscal (sem 500 / sem inventar)', async () => {
    let agora = T0;
    definirRelogioRetencaoFiscal(() => agora);
    retenirProgressoFiscal(snap('p1', { batchId: 'lote-poll', empresaId: '3' }), {
      marcadoFinalizado: true,
      agora: T0,
    });
    let rows = await obterStatusBatch('lote-poll');
    expect(rows).toHaveLength(1);
    expect(rows[0].fiscal).toBeDefined();

    agora = T0 + RETENCAO_FISCAL_TTL_MS + 5;
    rows = await obterStatusBatch('lote-poll');
    expect(rows).toHaveLength(0);
  });

  it('13. execução ativa preservada perante evicção por limite', () => {
    let agora = T0;
    definirRelogioRetencaoFiscal(() => agora);

    retenirProgressoFiscal(snap('ativa', { batchId: 'lote-ativa', empresaId: 'ativa' }), {
      marcadoFinalizado: false,
      agora: T0,
    });

    for (let i = 0; i < RETENCAO_FISCAL_MAX_SNAPSHOTS - 1; i++) {
      agora = T0 + 1 + i;
      retenirProgressoFiscal(snap(`f-${i}`, { batchId: `bf-${i}`, empresaId: `f-${i}` }), {
        marcadoFinalizado: true,
        agora,
      });
    }
    expect(tamanhoRetencaoProgressoFiscal()).toBe(RETENCAO_FISCAL_MAX_SNAPSHOTS);

    agora = T0 + RETENCAO_FISCAL_MAX_SNAPSHOTS + 10;
    expect(
      retenirProgressoFiscal(snap('extra', { batchId: 'b-extra', empresaId: 'extra' }), {
        marcadoFinalizado: true,
        agora,
      })
    ).toBe(true);

    expect(obterSnapshotPorExecucao('ativa')).not.toBeNull();
    expect(obterMetadadosRetencaoFiscal('ativa')?.finalizadoEm).toBeNull();
    expect(tamanhoRetencaoProgressoFiscal()).toBe(RETENCAO_FISCAL_MAX_SNAPSHOTS);
  });

  it('13b. recusa inserção nova se só restam ativas no teto', () => {
    // Preenche teto só com ativas (sem finalizadoEm) — não pode evictar.
    for (let i = 0; i < RETENCAO_FISCAL_MAX_SNAPSHOTS; i++) {
      expect(
        retenirProgressoFiscal(snap(`a-${i}`, { batchId: `ba-${i}`, empresaId: `a-${i}` }), {
          marcadoFinalizado: false,
        })
      ).toBe(true);
    }
    expect(
      retenirProgressoFiscal(snap('bloqueado', { batchId: 'bx', empresaId: 'bx' }), {
        marcadoFinalizado: true,
      })
    ).toBe(false);
    expect(descartesRetencaoPorLimiteAtivas()).toBe(1);
    expect(obterSnapshotPorExecucao('bloqueado')).toBeNull();
    expect(tamanhoRetencaoProgressoFiscal()).toBe(RETENCAO_FISCAL_MAX_SNAPSHOTS);
  });

  it('14. ausência de dados sensíveis no snapshot retido', () => {
    retenirProgressoFiscal(snap('seg'), { marcadoFinalizado: true });
    const raw = JSON.stringify(obterSnapshotPorExecucao('seg'));
    expect(raw.toLowerCase()).not.toMatch(
      /senha|password|pfx|cookie|-----begin|<nfse|playwright|page\.|token/
    );
  });

  it('15. compatibilidade SSE legado', () => {
    const e: ExecutionEvent = {
      type: 'execution:counts',
      empresa_id: '1',
      qtd_emitidas: 1,
      qtd_recebidas: 0,
    };
    expect(e).not.toHaveProperty('fiscal');
    expect(e.type).toBe('execution:counts');
  });
});
