"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.salvarLogExecucoes = salvarLogExecucoes;
const logger_1 = require("../infrastructure/logger");
const logs_execucao_service_1 = require("../services/logs-execucao.service");
const logger = (0, logger_1.getLogger)('logs-controller');
async function salvarLogExecucoes(req, res) {
    try {
        const validation = (0, logs_execucao_service_1.validarPayloadSalvarLog)(req.body);
        if (!validation.valid) {
            res.status(400).json({ detail: validation.error });
            return;
        }
        const payload = validation.payload;
        const result = await (0, logs_execucao_service_1.salvarLogExecucoesService)(payload);
        if (result.conflict) {
            res.status(409).json({ detail: 'Log já existe para este batch_id' });
            return;
        }
        res.status(201).json({
            success: true,
            batch_log_id: result.batchLogId,
            saved: true,
        });
    }
    catch (error) {
        logger.error({ err: error }, 'Erro ao salvar log de execuções');
        res.status(500).json({ detail: 'Erro ao salvar log de execuções' });
    }
}
//# sourceMappingURL=logs.controller.js.map