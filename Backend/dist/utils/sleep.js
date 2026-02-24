"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sleep = sleep;
/**
 * Utilitário para delay assíncrono (setTimeout promissificado).
 * Usado no producer para espaçar o enfileiramento de execuções.
 */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
//# sourceMappingURL=sleep.js.map