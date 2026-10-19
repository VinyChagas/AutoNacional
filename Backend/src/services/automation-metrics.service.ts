/**
 * Persistência de métricas de execução no PostgreSQL (Prisma).
 * Alimenta o Painel de Rentabilidade (billing-summary).
 */
import { prisma } from '../db/client';
import { getLogger } from '../infrastructure/logger';

const logger = getLogger('automation-metrics');

export interface CriarBatchInput {
  batchId: string;
  competencia: string;
  contabilidadeId: number | null;
  totalEmpresas: number;
}

export interface PersistirExecutionInput {
  batchId: string;
  empresaId: number;
  empresaCnpj: string;
  contabilidadeId: number | null;
  competencia: string;
  status: 'OK' | 'ERRO';
  loginMetodo?: 'CERTIFICADO' | 'CREDENCIAL';
  qtdEmitidas: number;
  qtdRecebidas: number;
  qtdCanceladas: number;
  tempoExecucaoSegundos: number;
  erroResumo?: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
}

/**
 * Cria um batch de execução (ao clicar Iniciar).
 * Chamado pelo router POST /multiplas.
 * O id é o UUID gerado pela aplicação (mesmo usado no SSE/Socket.IO).
 */
export async function criarBatch(input: CriarBatchInput): Promise<void> {
  try {
    await prisma.automationExecutionBatch.create({
      data: {
        id: input.batchId,
        competencia: input.competencia,
        contabilidadeId: input.contabilidadeId,
        totalEmpresas: input.totalEmpresas,
        status: 'RUNNING',
      },
    });
  } catch (err) {
    logger.warn({ err, batchId: input.batchId }, 'Erro ao criar batch de execução');
  }
}

/**
 * Persiste a execução de 1 empresa (ao finalizar - OK ou ERRO).
 * Chamado pelo execution-service em execution:finished.
 * Usa UPSERT para evitar duplicatas (unique batch_id, empresa_id).
 */
export async function persistirExecution(input: PersistirExecutionInput): Promise<void> {
  try {
    await prisma.automationExecution.upsert({
      where: {
        batchId_empresaId: {
          batchId: input.batchId,
          empresaId: input.empresaId,
        },
      },
      create: {
        batchId: input.batchId,
        empresaId: input.empresaId,
        empresaCnpj: input.empresaCnpj,
        contabilidadeId: input.contabilidadeId,
        competencia: input.competencia,
        status: input.status,
        loginMetodo: input.loginMetodo ?? null,
        qtdEmitidas: input.qtdEmitidas,
        qtdRecebidas: input.qtdRecebidas,
        qtdCanceladas: input.qtdCanceladas,
        tempoExecucaoSegundos: input.tempoExecucaoSegundos,
        erroResumo: input.erroResumo ?? null,
        startedAt: input.startedAt,
        finishedAt: input.finishedAt,
      },
      update: {
        empresaCnpj: input.empresaCnpj,
        contabilidadeId: input.contabilidadeId,
        competencia: input.competencia,
        status: input.status,
        loginMetodo: input.loginMetodo ?? null,
        qtdEmitidas: input.qtdEmitidas,
        qtdRecebidas: input.qtdRecebidas,
        qtdCanceladas: input.qtdCanceladas,
        tempoExecucaoSegundos: input.tempoExecucaoSegundos,
        erroResumo: input.erroResumo ?? null,
        startedAt: input.startedAt,
        finishedAt: input.finishedAt,
      },
    });

    await maybeFinalizarBatch(input.batchId);
  } catch (err) {
    logger.warn(
      { err, batchId: input.batchId, empresaId: input.empresaId },
      'Erro ao persistir execução'
    );
  }
}

/**
 * Se todas as execuções do batch foram persistidas, marca batch como FINISHED.
 */
async function maybeFinalizarBatch(batchId: string): Promise<void> {
  try {
    const batch = await prisma.automationExecutionBatch.findUnique({
      where: { id: batchId },
      select: { totalEmpresas: true, status: true },
    });

    if (!batch) return;
    if (batch.status === 'FINISHED') return;

    const count = await prisma.automationExecution.count({
      where: { batchId },
    });

    if (count >= batch.totalEmpresas) {
      await prisma.automationExecutionBatch.update({
        where: { id: batchId },
        data: { status: 'FINISHED' },
      });
    }
  } catch {
    /* ignore */
  }
}
