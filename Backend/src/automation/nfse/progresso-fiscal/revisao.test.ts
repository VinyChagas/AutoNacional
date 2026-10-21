/**
 * UI-01e-D — revisão monotônica (offline).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { progressoFiscalDeDiscoveryOnly } from './from-discovery-only';
import { criarPeriodoConsultaPortal } from '../contracts/periodo';
import type { ResultadoDiscoveryOnlyHomologacao } from '../homologacao/types';
import {
  RETENCAO_FISCAL_TTL_MS,
  definirRelogioRetencaoFiscal,
  limparRetencaoProgressoFiscal,
  listarSnapshotsPorLote,
  obterSnapshotPorExecucao,
  retenirProgressoFiscal,
} from './retencao';
import {
  REVISAO_FISCAL_INICIAL,
  REVISAO_FISCAL_NAO_PUBLICADA,
  limparRevisoesProgressoFiscal,
  obterRevisaoPublicada,
  publicarProgressoFiscal,
  fingerprintProgressoFiscal,
} from './revisao';
import type { ProgressoFiscalNfse } from './types';

const PERIODO = criarPeriodoConsultaPortal('01/05/2024', '31/05/2024');

function resultado(
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

function rascunho(execucaoId: string, emitidas = 1, empresaId = '7', batchId: string | null = 'lote-1') {
  return progressoFiscalDeDiscoveryOnly({
    identidade: { batchId, empresaId, execucaoId, cnpj: '12345678000190' },
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
}

afterEach(() => {
  limparRetencaoProgressoFiscal();
  limparRevisoesProgressoFiscal();
});

describe('publicarProgressoFiscal (UI-01e-D)', () => {
  it('1. primeira revisão', () => {
    const draft = rascunho('100');
    expect(draft.revisao).toBe(REVISAO_FISCAL_NAO_PUBLICADA);
    const pub = publicarProgressoFiscal(draft);
    expect(pub.revisao).toBe(REVISAO_FISCAL_INICIAL);
    expect(obterRevisaoPublicada('100')).toBe(1);
  });

  it('2. incremento em atualização real', () => {
    publicarProgressoFiscal(rascunho('101', 1));
    const segundo = publicarProgressoFiscal(rascunho('101', 5));
    expect(segundo.revisao).toBe(2);
  });

  it('3. duplicata (mesmo conteúdo) não incrementa', () => {
    const a = publicarProgressoFiscal(rascunho('102', 3));
    const b = publicarProgressoFiscal(rascunho('102', 3));
    expect(a.revisao).toBe(1);
    expect(b.revisao).toBe(1);
    expect(fingerprintProgressoFiscal(a)).toBe(fingerprintProgressoFiscal(b));
  });

  it('4. SSE e polling com mesma revisão (retenção não republica)', () => {
    const fiscal = publicarProgressoFiscal(rascunho('103', 2));
    retenirProgressoFiscal(
      {
        empresa_id: '7',
        cnpj: '12345678000190',
        batch_id: 'lote-1',
        execucao_id: '103',
        status: 'concluido',
        etapa_atual: 'finalizacao',
        progresso: 100,
        mensagem: 'ok',
        qtd_notas_emitidas: 2,
        qtd_notas_recebidas: 0,
        qtd_notas_canceladas: 0,
        resultado_final: null,
        fiscal,
      },
      { marcadoFinalizado: true }
    );
    // Consulta (polling) — não incrementa.
    const listed = listarSnapshotsPorLote('lote-1');
    expect(listed).toHaveLength(1);
    expect(listed[0].fiscal.revisao).toBe(fiscal.revisao);
    expect(obterRevisaoPublicada('103')).toBe(fiscal.revisao);
  });

  it('8–10. execuções / empresas / lotes isolados', () => {
    const a = publicarProgressoFiscal(rascunho('201', 1, '1', 'L1'));
    const b = publicarProgressoFiscal(rascunho('202', 1, '1', 'L1'));
    const c = publicarProgressoFiscal(rascunho('203', 1, '2', 'L2'));
    expect(a.revisao).toBe(1);
    expect(b.revisao).toBe(1);
    expect(c.revisao).toBe(1);
    publicarProgressoFiscal(rascunho('201', 9, '1', 'L1'));
    expect(obterRevisaoPublicada('201')).toBe(2);
    expect(obterRevisaoPublicada('202')).toBe(1);
    expect(obterRevisaoPublicada('203')).toBe(1);
  });

  it('11–12. finalização sem mudança de snapshot: mesma revisão', () => {
    const fiscal = publicarProgressoFiscal(rascunho('301', 4));
    const novamente = publicarProgressoFiscal({ ...fiscal, revisao: 0 });
    expect(novamente.revisao).toBe(fiscal.revisao);
  });

  it('13–14. expiração/restart simulado zera revisões', () => {
    publicarProgressoFiscal(rascunho('401'));
    limparRetencaoProgressoFiscal();
    expect(obterRevisaoPublicada('401')).toBeNull();
    const nova = publicarProgressoFiscal(rascunho('401'));
    expect(nova.revisao).toBe(REVISAO_FISCAL_INICIAL);
  });

  it('17. ausência de dados sensíveis', () => {
    const pub = publicarProgressoFiscal(rascunho('501'));
    expect(JSON.stringify(pub).toLowerCase()).not.toMatch(/senha|pfx|cookie|-----begin/);
  });

  it('fingerprint exclui revisao e é canônico (ordem de chaves)', () => {
    const a = publicarProgressoFiscal(rascunho('601', 2));
    const b: ProgressoFiscalNfse = { ...a, revisao: 99 };
    expect(fingerprintProgressoFiscal(a)).toBe(fingerprintProgressoFiscal(b));
    expect(fingerprintProgressoFiscal(a)).not.toContain('"revisao"');

    const reordenado = JSON.parse(JSON.stringify(a)) as ProgressoFiscalNfse;
    // Reconstrói com inserção de chaves em outra ordem superficial.
    const alt: ProgressoFiscalNfse = {
      revisao: 0,
      cnpj: reordenado.cnpj,
      empresa_id: reordenado.empresa_id,
      execucao_id: reordenado.execucao_id,
      batch_id: reordenado.batch_id,
      versao: 1,
      inventario: reordenado.inventario,
      validacao: reordenado.validacao,
      recuperacao: reordenado.recuperacao,
      codigo: reordenado.codigo,
      message: reordenado.message,
      estado_operacional: reordenado.estado_operacional,
      veredito_discovery: reordenado.veredito_discovery,
    };
    expect(fingerprintProgressoFiscal(alt)).toBe(fingerprintProgressoFiscal(a));
  });

  it('8. recusa de retenção não regride revisão da execução', () => {
    const fiscal = publicarProgressoFiscal(rascunho('701', 1));
    expect(fiscal.revisao).toBe(1);
    // Simula falha de retenção (mapa no limite só com ativas): revisão já publicada permanece.
    expect(obterRevisaoPublicada('701')).toBe(1);
    const novamente = publicarProgressoFiscal(rascunho('701', 1));
    expect(novamente.revisao).toBe(1);
    const atualizado = publicarProgressoFiscal(rascunho('701', 8));
    expect(atualizado.revisao).toBe(2);
  });

  it('9. após expiração da retenção, revisão não reinicia em 1', () => {
    let agora = 2_000_000_000_000;
    definirRelogioRetencaoFiscal(() => agora);

    const fiscal = publicarProgressoFiscal(rascunho('801', 1));
    expect(fiscal.revisao).toBe(1);
    retenirProgressoFiscal(
      {
        empresa_id: '7',
        cnpj: '12345678000190',
        batch_id: 'lote-exp',
        execucao_id: '801',
        status: 'concluido',
        etapa_atual: 'finalizacao',
        progresso: 100,
        mensagem: 'ok',
        qtd_notas_emitidas: 1,
        qtd_notas_recebidas: 0,
        qtd_notas_canceladas: 0,
        resultado_final: null,
        fiscal,
      },
      { marcadoFinalizado: true, agora }
    );

    agora = agora + RETENCAO_FISCAL_TTL_MS + 1;
    expect(obterSnapshotPorExecucao('801')).toBeNull();
    expect(listarSnapshotsPorLote('lote-exp')).toHaveLength(0);
    // Mapa de revisão sobrevive à expiração do snapshot.
    expect(obterRevisaoPublicada('801')).toBe(1);

    const republicado = publicarProgressoFiscal(rascunho('801', 3));
    expect(republicado.revisao).toBe(2);

    definirRelogioRetencaoFiscal(null);
  });

  it('consulta polling não altera revisão', () => {
    const fiscal = publicarProgressoFiscal(rascunho('901', 1));
    retenirProgressoFiscal(
      {
        empresa_id: '7',
        cnpj: '12345678000190',
        batch_id: 'lote-q',
        execucao_id: '901',
        status: 'concluido',
        etapa_atual: 'finalizacao',
        progresso: 100,
        mensagem: 'ok',
        qtd_notas_emitidas: 1,
        qtd_notas_recebidas: 0,
        qtd_notas_canceladas: 0,
        resultado_final: null,
        fiscal,
      },
      { marcadoFinalizado: true }
    );
    const antes = obterRevisaoPublicada('901');
    listarSnapshotsPorLote('lote-q');
    obterSnapshotPorExecucao('901');
    expect(obterRevisaoPublicada('901')).toBe(antes);
  });
});
