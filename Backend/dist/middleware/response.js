"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.jsonSuccess = jsonSuccess;
exports.jsonCreated = jsonCreated;
exports.jsonError = jsonError;
/**
 * Resposta de sucesso padronizada.
 */
function jsonSuccess(res, data, status = 200) {
    const body = { success: true };
    if (data !== undefined)
        body.data = data;
    return res.status(status).json(body);
}
/**
 * Resposta de sucesso com mensagem (ex.: criação).
 */
function jsonCreated(res, data, message) {
    const body = { success: true };
    if (data !== undefined)
        body.data = data;
    if (message)
        body.message = message;
    return res.status(201).json(body);
}
/**
 * Resposta de erro padronizada.
 */
function jsonError(res, detail, status = 400, code) {
    const body = { success: false, detail };
    if (code)
        body.code = code;
    return res.status(status).json(body);
}
//# sourceMappingURL=response.js.map