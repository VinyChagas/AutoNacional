/**
 * Repositório para logs de lote de execução.
 */
import { prisma } from '../db/client';

export interface ExecucaoBatchLogCreate {
  batchId: string;
  contabilidadeId?: number | null;
  competencia: string;
  dataInicio: string;
  dataFim: string;
  tipo: string;
  headless: boolean;
  totalEmpresas: number;
  totalSucesso: number;
  totalFalha: number;
  totalEmitidas: number;
  totalRecebidas: number;
  totaisPorResultado?: Record<string, number>;
  itens: unknown[];
}

export async function criarExecucaoBatchLog(
  data: ExecucaoBatchLogCreate
): Promise<{ id: number }> {
  const log = await prisma.execucaoBatchLog.create({
    data: {
      batchId: data.batchId,
      contabilidadeId: data.contabilidadeId ?? undefined,
      competencia: data.competencia,
      dataInicio: data.dataInicio,
      dataFim: data.dataFim,
      tipo: data.tipo,
      headless: data.headless,
      totalEmpresas: data.totalEmpresas,
      totalSucesso: data.totalSucesso,
      totalFalha: data.totalFalha,
      totalEmitidas: data.totalEmitidas,
      totalRecebidas: data.totalRecebidas,
      totaisPorResultado: data.totaisPorResultado ?? undefined,
      itens: data.itens as object,
    },
  });
  return { id: log.id };
}

export async function existeBatchLog(batchId: string): Promise<boolean> {
  const count = await prisma.execucaoBatchLog.count({
    where: { batchId },
  });
  return count > 0;
}
