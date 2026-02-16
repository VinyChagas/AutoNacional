"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.wrapSuccess = wrapSuccess;
exports.wrapError = wrapError;
const response_1 = require("../middleware/response");
/**
 * Resposta de sucesso: { success: true, data }
 */
function wrapSuccess(res, data, status = 200) {
    return (0, response_1.jsonSuccess)(res, data, status);
}
/**
 * Resposta de erro: { success: false, detail } com status HTTP.
 */
function wrapError(res, status, detail) {
    return (0, response_1.jsonError)(res, detail, status);
}
//# sourceMappingURL=api-response.js.map