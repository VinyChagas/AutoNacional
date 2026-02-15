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
/**
 * Router do módulo Imports (Preview + Confirmar).
 */
const express_1 = require("express");
const error_handler_1 = require("../../middleware/error-handler");
const upload_1 = require("../../middleware/upload");
const controller = __importStar(require("./imports.controller"));
const router = (0, express_1.Router)();
// Certificados em lote
router.post('/certificados/preview', (0, upload_1.uploadArray)('files', 50), (0, error_handler_1.asyncHandler)(controller.previewCertificados));
router.post('/certificados/confirmar', (0, error_handler_1.asyncHandler)(controller.confirmarCertificados));
// Credenciais via planilha
router.post('/credenciais/preview', (0, upload_1.uploadSingle)('arquivo'), (0, error_handler_1.asyncHandler)(controller.previewCredenciais));
router.post('/credenciais/confirmar', (0, error_handler_1.asyncHandler)(controller.confirmarCredenciais));
router.get('/health', (_req, res) => {
    res.json({ success: true, module: 'imports' });
});
exports.default = router;
//# sourceMappingURL=router.js.map