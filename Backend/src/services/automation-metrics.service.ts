/**
 * Serviço de persistência de métricas de execução no Supabase.
 * Alimenta o Painel de Rentabilidade (billing-summary).
 *
 * Usa SUPABASE_SERVICE_ROLE_KEY - nunca expor no frontend.
 */
import { getLogger } from '../infrastructure/logger';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '../infrastructure/config';

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

function isSupabaseConfigured(): boolean {
  return Boolean(
    SUPABASE_URL &&
      SUPABASE_URL.length > 0 &&
      SUPABASE_SERVICE_ROLE_KEY &&
      SUPABASE_SERVICE_ROLE_KEY.length > 0
  );
}

/**
 * Cria um batch de execução (ao clicar Iniciar).
 * Chamado pelo router POST /multiplas.
 */
export async function criarBatch(input: CriarBatchInput): Promise<void> {
  if (!isSupabaseConfigured()) {
    logger.debug('Supabase não configurado - skip criarBatch');
    return;
  }
  try {
    const { getSupabaseClient } = await import('../config/supabase');
    const supabase = getSupabaseClient();

    const { error } = await supabase.from('automation_execution_batches').insert({
      id: input.batchId,
      competencia: input.competencia,
      contabilidade_id: input.contabilidadeId,
      total_empresas: input.totalEmpresas,
      status: 'RUNNING',
    });

    if (error) {
      logger.warn({ err: error, batchId: input.batchId }, 'Erro ao criar batch de execução');
    }
  } catch (err) {
    logger.warn({ err, batchId: input.batchId }, 'Erro ao criar batch (Supabase)');
  }
}

/**
 * Persiste a execução de 1 empresa (ao finalizar - OK ou ERRO).
 * Chamado pelo execution-service em execution:finished.
 * Usa UPSERT para evitar duplicatas (unique batch_id, empresa_id).
 */
export async function persistirExecution(input: PersistirExecutionInput): Promise<void> {
  if (!isSupabaseConfigured()) {
    logger.debug('Supabase não configurado - skip persistirExecution');
    return;
  }
  try {
    const { getSupabaseClient } = await import('../config/supabase');
    const supabase = getSupabaseClient();

    const row = {
      batch_id: input.batchId,
      empresa_id: input.empresaId,
      empresa_cnpj: input.empresaCnpj,
      contabilidade_id: input.contabilidadeId,
      competencia: input.competencia,
      status: input.status,
      login_metodo: input.loginMetodo ?? null,
      qtd_emitidas: input.qtdEmitidas,
      qtd_recebidas: input.qtdRecebidas,
      qtd_canceladas: input.qtdCanceladas,
      tempo_execucao_segundos: input.tempoExecucaoSegundos,
      erro_resumo: input.erroResumo ?? null,
      started_at: input.startedAt?.toISOString() ?? null,
      finished_at: input.finishedAt?.toISOString() ?? null,
    };

    const { error } = await supabase.from('automation_executions').upsert(row, {
      onConflict: 'batch_id,empresa_id',
    });

    if (error) {
      logger.warn(
        { err: error, batchId: input.batchId, empresaId: input.empresaId },
        'Erro ao persistir execução'
      );
      return;
    }

    await maybeFinalizarBatch(input.batchId);
  } catch (err) {
    logger.warn(
      { err, batchId: input.batchId, empresaId: input.empresaId },
      'Erro ao persistir execução (Supabase)'
    );
  }
}

/**
 * Se todas as execuções do batch foram persistidas, marca batch como FINISHED.
 */
async function maybeFinalizarBatch(batchId: string): Promise<void> {
  try {
    const { getSupabaseClient } = await import('../config/supabase');
    const supabase = getSupabaseClient();

    const { data: batch, error: errBatch } = await supabase
      .from('automation_execution_batches')
      .select('total_empresas, status')
      .eq('id', batchId)
      .single();

    if (errBatch || !batch) return;

    if (batch.status === 'FINISHED') return;

    const { count, error: errCount } = await supabase
      .from('automation_executions')
      .select('*', { count: 'exact', head: true })
      .eq('batch_id', batchId);

    if (errCount || count == null) return;

    if (count >= batch.total_empresas) {
      await supabase
        .from('automation_execution_batches')
        .update({ status: 'FINISHED' })
        .eq('id', batchId);
    }
  } catch {
    /* ignore */
  }
}
