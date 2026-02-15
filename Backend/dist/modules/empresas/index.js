"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.empresasRouter = void 0;
/**
 * Módulo Empresas - CRUD e listagem com agregados.
 */
const express_1 = require("express");
const empresas_routes_1 = __importDefault(require("./empresas.routes"));
const empresas_1 = __importDefault(require("../../routers/empresas"));
const router = (0, express_1.Router)();
exports.empresasRouter = router;
router.use(empresas_routes_1.default);
router.use(empresas_1.default);
//# sourceMappingURL=index.js.map