"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registrarClienteSSE = registrarClienteSSE;
exports.emitirEventoExecucao = emitirEventoExecucao;
const batchClients = new Map();
const PING_INTERVAL_MS = 15000;
function emitEvent(res, event, data) {
    try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }
    catch {
        /* client disconnected */
    }
}
function registrarClienteSSE(batchId, res) {
    let batch = batchClients.get(batchId);
    if (!batch) {
        batch = { clients: new Set() };
        batchClients.set(batchId, batch);
    }
    batch.clients.add(res);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.on('close', () => {
        batch?.clients.delete(res);
        if (batch && batch.clients.size === 0) {
            batchClients.delete(batchId);
        }
    });
    const pingInterval = setInterval(() => {
        if (res.writableEnded) {
            clearInterval(pingInterval);
            return;
        }
        try {
            res.write(': ping\n\n');
        }
        catch {
            clearInterval(pingInterval);
        }
    }, PING_INTERVAL_MS);
    res.on('close', () => clearInterval(pingInterval));
}
function emitirEventoExecucao(batchId, evento) {
    if (!batchId)
        return;
    const batch = batchClients.get(batchId);
    if (!batch)
        return;
    const eventType = evento.type.replace('execution:', '');
    for (const res of batch.clients) {
        if (!res.writableEnded) {
            emitEvent(res, eventType, evento);
        }
    }
}
//# sourceMappingURL=execution-events.service.js.map