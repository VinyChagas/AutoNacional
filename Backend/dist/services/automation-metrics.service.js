"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.criarBatch = criarBatch;
exports.persistirExecution = persistirExecution;
/**
 * Serviço de persistência de métricas de execução no Supabase.
 * Alimenta o Painel de Rentabilidade (billing-summary).
 *
 * Usa SUPABASE_SERVICE_ROLE_KEY - nunca expor no frontend.
 */
const logger_1 = require("../infrastructure/logger");
const config_1 = require("../infrastructure/config");
const logger = (0, logger_1.getLogger)('automation-metrics');
function isSupabaseConfigured() {
    return Boolean(config_1.SUPABASE_URL &&
        config_1.SUPABASE_URL.length > 0 &&
        config_1.SUPABASE_SERVICE_ROLE_KEY &&
        config_1.SUPABASE_SERVICE_ROLE_KEY.length > 0);
}
/**
 * Cria um batch de execução (ao clicar Iniciar).
 * Chamado pelo router POST /multiplas.
 */
async function criarBatch(input) {
    if (!isSupabaseConfigured()) {
        logger.debug('Supabase não configurado - skip criarBatch');
        return;
    }
    try {
        const { getSupabaseClient } = await Promise.resolve().then(() => __importStar(require('../config/supabase')));
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
    }
    catch (err) {
        logger.warn({ err, batchId: input.batchId }, 'Erro ao criar batch (Supabase)');
    }
}
/**
 * Persiste a execução de 1 empresa (ao finalizar - OK ou ERRO).
 * Chamado pelo execution-service em execution:finished.
 * Usa UPSERT para evitar duplicatas (unique batch_id, empresa_id).
 */
async function persistirExecution(input) {
    if (!isSupabaseConfigured()) {
        logger.debug('Supabase não configurado - skip persistirExecution');
        return;
    }
    try {
        const { getSupabaseClient } = await Promise.resolve().then(() => __importStar(require('../config/supabase')));
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
            logger.warn({ err: error, batchId: input.batchId, empresaId: input.empresaId }, 'Erro ao persistir execução');
            return;
        }
        await maybeFinalizarBatch(input.batchId);
    }
    catch (err) {
        logger.warn({ err, batchId: input.batchId, empresaId: input.empresaId }, 'Erro ao persistir execução (Supabase)');
    }
}
/**
 * Se todas as execuções do batch foram persistidas, marca batch como FINISHED.
 */
async function maybeFinalizarBatch(batchId) {
    try {
        const { getSupabaseClient } = await Promise.resolve().then(() => __importStar(require('../config/supabase')));
        const supabase = getSupabaseClient();
        const { data: batch, error: errBatch } = await supabase
            .from('automation_execution_batches')
            .select('total_empresas, status')
            .eq('id', batchId)
            .single();
        if (errBatch || !batch)
            return;
        if (batch.status === 'FINISHED')
            return;
        const { count, error: errCount } = await supabase
            .from('automation_executions')
            .select('*', { count: 'exact', head: true })
            .eq('batch_id', batchId);
        if (errCount || count == null)
            return;
        if (count >= batch.total_empresas) {
            await supabase
                .from('automation_execution_batches')
                .update({ status: 'FINISHED' })
                .eq('id', batchId);
        }
    }
    catch {
        /* ignore */
    }
}
//# sourceMappingURL=automation-metrics.service.js.map