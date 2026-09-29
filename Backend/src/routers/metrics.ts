/**
 * Router de métricas - billing summary para precificação/rentabilidade.
 * Consulta a view billing_monthly_summary no PostgreSQL via Prisma ($queryRaw).
 */
import { Router, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/client';
import { getLogger } from '../infrastructure/logger';

const logger = getLogger('metrics');
const router = Router();

export interface BillingSummaryResponse {
  competencia: string;
  contabilidade_id: number | null;
  empresas_processadas_total: number;
  empresas_ok: number;
  empresas_erro: number;
  nf_emitidas: number;
  nf_recebidas: number;
  nf_canceladas: number;
  total_notas: number;
  tempo_total_segundos?: number;
  tempo_medio_por_empresa_segundos?: number;
}

type BillingMonthlyRow = {
  competencia: string;
  contabilidade_id: number | null;
  empresas_processadas_total: number | null;
  empresas_ok: number | null;
  empresas_erro: number | null;
  nf_emitidas: number | null;
  nf_recebidas: number | null;
  nf_canceladas: number | null;
  total_notas: number | null;
  tempo_total_segundos: number | null;
  tempo_medio_por_empresa_segundos: number | Prisma.Decimal | null;
};

/**
 * GET /api/metrics/billing-summary?competencia=YYYY-MM&contabilidade_id=optional
 * Consulta PostgreSQL: view billing_monthly_summary.
 */
router.get('/billing-summary', async (req: Request, res: Response) => {
  try {
    const competencia = (req.query.competencia as string) || null;
    const contabilidadeIdParam = req.query.contabilidade_id as string | undefined;

    if (!competencia || !/^\d{4}-\d{2}$/.test(competencia)) {
      res.status(400).json({
        detail: 'competencia obrigatória no formato YYYY-MM (ex: 2026-01)',
      });
      return;
    }

    const contabilidadeId: number | null = contabilidadeIdParam
      ? parseInt(contabilidadeIdParam, 10)
      : null;

    if (contabilidadeIdParam && (isNaN(contabilidadeId!) || contabilidadeId! <= 0)) {
      res.status(400).json({
        detail: 'contabilidade_id deve ser um número inteiro positivo',
      });
      return;
    }

    let rows: BillingMonthlyRow[];
    try {
      if (contabilidadeId != null) {
        rows = await prisma.$queryRaw<BillingMonthlyRow[]>`
          SELECT *
          FROM billing_monthly_summary
          WHERE competencia = ${competencia}
            AND contabilidade_id = ${contabilidadeId}
        `;
      } else {
        rows = await prisma.$queryRaw<BillingMonthlyRow[]>`
          SELECT *
          FROM billing_monthly_summary
          WHERE competencia = ${competencia}
        `;
      }
    } catch (error) {
      logger.warn({ err: error, competencia }, 'Erro ao consultar billing_monthly_summary');
      return res.json(buildEmptyResponse(competencia, contabilidadeId));
    }

    if (!rows || rows.length === 0) {
      return res.json(buildEmptyResponse(competencia, contabilidadeId));
    }

    let empresas_processadas_total = 0;
    let empresas_ok = 0;
    let empresas_erro = 0;
    let nf_emitidas = 0;
    let nf_recebidas = 0;
    let nf_canceladas = 0;
    let tempo_total_segundos = 0;
    let tempo_sum_for_avg = 0;
    let count_for_avg = 0;

    for (const r of rows) {
      empresas_processadas_total += Number(r.empresas_processadas_total ?? 0);
      empresas_ok += Number(r.empresas_ok ?? 0);
      empresas_erro += Number(r.empresas_erro ?? 0);
      nf_emitidas += Number(r.nf_emitidas ?? 0);
      nf_recebidas += Number(r.nf_recebidas ?? 0);
      nf_canceladas += Number(r.nf_canceladas ?? 0);
      const t = Number(r.tempo_total_segundos ?? 0);
      tempo_total_segundos += t;
      const avg = r.tempo_medio_por_empresa_segundos;
      if (avg != null && Number(r.empresas_processadas_total ?? 0) > 0) {
        tempo_sum_for_avg += Number(avg) * Number(r.empresas_processadas_total ?? 0);
        count_for_avg += Number(r.empresas_processadas_total ?? 0);
      }
    }

    const total_notas = nf_emitidas + nf_recebidas;
    const tempo_medio_por_empresa_segundos =
      count_for_avg > 0 && tempo_sum_for_avg > 0
        ? Math.round((tempo_sum_for_avg / count_for_avg) * 100) / 100
        : empresas_processadas_total > 0 && tempo_total_segundos > 0
          ? Math.round((tempo_total_segundos / empresas_processadas_total) * 100) / 100
          : undefined;

    const response: BillingSummaryResponse = {
      competencia,
      contabilidade_id: contabilidadeId,
      empresas_processadas_total,
      empresas_ok,
      empresas_erro,
      nf_emitidas,
      nf_recebidas,
      nf_canceladas,
      total_notas,
      tempo_total_segundos:
        tempo_total_segundos > 0 ? Math.round(tempo_total_segundos * 100) / 100 : undefined,
      tempo_medio_por_empresa_segundos,
    };

    res.json(response);
  } catch (error) {
    logger.error({ err: error }, 'Erro ao obter billing summary');
    res.status(500).json({ detail: 'Erro ao obter resumo de cobrança' });
  }
});

function buildEmptyResponse(
  competencia: string,
  contabilidade_id: number | null
): BillingSummaryResponse {
  return {
    competencia,
    contabilidade_id,
    empresas_processadas_total: 0,
    empresas_ok: 0,
    empresas_erro: 0,
    nf_emitidas: 0,
    nf_recebidas: 0,
    nf_canceladas: 0,
    total_notas: 0,
  };
}

export default router;
