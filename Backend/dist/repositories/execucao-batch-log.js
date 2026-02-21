"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.criarExecucaoBatchLog = criarExecucaoBatchLog;
exports.existeBatchLog = existeBatchLog;
/**
 * Repositório para logs de lote de execução.
 */
const client_1 = require("../db/client");
async function criarExecucaoBatchLog(data) {
    const log = await client_1.prisma.execucaoBatchLog.create({
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
            itens: data.itens,
        },
    });
    return { id: log.id };
}
async function existeBatchLog(batchId) {
    const count = await client_1.prisma.execucaoBatchLog.count({
        where: { batchId },
    });
    return count > 0;
}
//# sourceMappingURL=execucao-batch-log.js.map