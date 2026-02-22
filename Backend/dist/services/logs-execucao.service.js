"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validarPayloadSalvarLog = validarPayloadSalvarLog;
exports.salvarLogExecucoesService = salvarLogExecucoesService;
/**
 * Service para persistência de logs de execução NFSe.
 * Usa Supabase (Postgres) - execucao_log_batch + execucao_log_item.
 *
 * Nota: Supabase JS não suporta transações nativamente.
 * Estratégia: insert header -> insert items. Se items falhar, deletamos o header (rollback lógico).
 */
const supabase_1 = require("../config/supabase");
const logger_1 = require("../infrastructure/logger");
const logger = (0, logger_1.getLogger)('logs-execucao');
function validarPayloadSalvarLog(body) {
    if (!body || typeof body !== 'object') {
        return { valid: false, error: 'Payload inválido' };
    }
    const b = body;
    if (!b.batch_id || typeof b.batch_id !== 'string' || !b.batch_id.trim()) {
        return { valid: false, error: 'batch_id é obrigatório' };
    }
    if (!b.contabilidade_id || (typeof b.contabilidade_id !== 'string' && typeof b.contabilidade_id !== 'number')) {
        return { valid: false, error: 'contabilidade_id é obrigatório' };
    }
    if (!b.competencia || typeof b.competencia !== 'string' || !b.competencia.trim()) {
        return { valid: false, error: 'competencia é obrigatória (formato YYYY-MM)' };
    }
    const competenciaMatch = /^\d{4}-\d{2}$/.exec(String(b.competencia));
    if (!competenciaMatch) {
        return { valid: false, error: 'competencia deve estar no formato YYYY-MM' };
    }
    if (!Array.isArray(b.itens)) {
        return { valid: false, error: 'itens é obrigatório e deve ser um array' };
    }
    const totais = b.totais;
    if (!totais || typeof totais !== 'object') {
        return { valid: false, error: 'totais é obrigatório' };
    }
    const payload = {
        batch_id: String(b.batch_id).trim(),
        contabilidade_id: String(b.contabilidade_id),
        competencia: String(b.competencia).trim(),
        dataInicio: b.dataInicio != null ? String(b.dataInicio) : null,
        dataFim: b.dataFim != null ? String(b.dataFim) : null,
        tipo: ['ambas', 'emitidas', 'recebidas'].includes(String(b.tipo)) ? b.tipo : 'ambas',
        headless: Boolean(b.headless),
        totais: {
            total_empresas: sanitizarInt(totais.total_empresas, 0),
            total_sucesso: sanitizarInt(totais.total_sucesso, 0),
            total_falha: sanitizarInt(totais.total_falha, 0),
            total_emitidas: sanitizarInt(totais.total_emitidas, 0),
            total_recebidas: sanitizarInt(totais.total_recebidas, 0),
            totais_por_resultado: (typeof totais.totais_por_resultado === 'object' && totais.totais_por_resultado !== null)
                ? totais.totais_por_resultado
                : {},
        },
        itens: b.itens.map((it) => sanitizarItem(it)),
    };
    return { valid: true, payload };
}
function sanitizarInt(v, defaultVal) {
    if (typeof v === 'number' && !isNaN(v))
        return Math.floor(v);
    if (typeof v === 'string') {
        const n = parseInt(v, 10);
        return isNaN(n) ? defaultVal : n;
    }
    return defaultVal;
}
function sanitizarItem(it) {
    const item = (it && typeof it === 'object' ? it : {});
    return {
        empresa_id: String(item.empresa_id ?? '').trim() || '0',
        cnpj: String(item.cnpj ?? '').trim() || '',
        nome_empresa: String(item.nome_empresa ?? '').trim() || '',
        tipo_autenticacao: ['certificado', 'credenciais'].includes(String(item.tipo_autenticacao))
            ? item.tipo_autenticacao
            : undefined,
        status_final: ['finalizado', 'falhou'].includes(String(item.status_final))
            ? item.status_final
            : 'falhou',
        qtd_emitidas: sanitizarInt(item.qtd_emitidas, 0),
        qtd_recebidas: sanitizarInt(item.qtd_recebidas, 0),
        resultado_final: item.resultado_final != null ? String(item.resultado_final) : undefined,
        started_at: item.started_at != null ? String(item.started_at) : undefined,
        finished_at: item.finished_at != null ? String(item.finished_at) : undefined,
        erro_msg: item.erro_msg != null ? String(item.erro_msg) : undefined,
    };
}
async function salvarLogExecucoesService(payload) {
    const supabase = (0, supabase_1.getSupabaseClient)();
    // 1. Verificar duplicidade
    const { data: existing } = await supabase
        .from('execucao_log_batch')
        .select('id')
        .eq('batch_id', payload.batch_id)
        .maybeSingle();
    if (existing) {
        return { conflict: true };
    }
    // 2. Insert header (execucao_log_batch)
    const contabilidadeId = payload.contabilidade_id ? parseInt(String(payload.contabilidade_id).replace(/\D/g, '') || '0', 10) : null;
    const { data: header, error: errHeader } = await supabase
        .from('execucao_log_batch')
        .insert({
        batch_id: payload.batch_id,
        contabilidade_id: contabilidadeId && contabilidadeId > 0 ? contabilidadeId : null,
        competencia: payload.competencia,
        data_inicio: payload.dataInicio || null,
        data_fim: payload.dataFim || null,
        tipo: payload.tipo,
        headless: payload.headless,
        total_empresas: payload.totais.total_empresas,
        total_sucesso: payload.totais.total_sucesso,
        total_falha: payload.totais.total_falha,
        total_emitidas: payload.totais.total_emitidas,
        total_recebidas: payload.totais.total_recebidas,
        totais_por_resultado: Object.keys(payload.totais.totais_por_resultado || {}).length > 0
            ? payload.totais.totais_por_resultado
            : null,
    })
        .select('id')
        .single();
    if (errHeader) {
        logger.error({ err: errHeader }, 'Erro ao inserir execucao_log_batch');
        throw errHeader;
    }
    const batchLogId = header?.id;
    if (!batchLogId) {
        throw new Error('Insert header retornou sem id');
    }
    // 3. Insert items (execucao_log_item)
    if (payload.itens.length > 0) {
        const rows = payload.itens.map((it) => ({
            batch_log_id: batchLogId,
            empresa_id: it.empresa_id,
            cnpj: it.cnpj,
            nome_empresa: it.nome_empresa,
            tipo_autenticacao: it.tipo_autenticacao || null,
            status_final: it.status_final,
            qtd_emitidas: it.qtd_emitidas,
            qtd_recebidas: it.qtd_recebidas,
            resultado_final: it.resultado_final || null,
            started_at: it.started_at || null,
            finished_at: it.finished_at || null,
            erro_msg: it.erro_msg || null,
        }));
        const { error: errItems } = await supabase.from('execucao_log_item').insert(rows);
        if (errItems) {
            logger.error({ err: errItems }, 'Erro ao inserir execucao_log_item - rollback lógico');
            // Rollback lógico: deletar header para manter consistência
            await supabase.from('execucao_log_batch').delete().eq('id', batchLogId);
            throw errItems;
        }
    }
    return { batchLogId };
}
//# sourceMappingURL=logs-execucao.service.js.map