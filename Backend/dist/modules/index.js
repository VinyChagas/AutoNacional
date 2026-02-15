"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.importsRouter = exports.certificadosRouter = exports.credenciaisRouter = exports.empresasRouter = void 0;
/**
 * Registro central de módulos.
 */
var empresas_1 = require("./certificados/empresas");
Object.defineProperty(exports, "empresasRouter", { enumerable: true, get: function () { return empresas_1.empresasRouter; } });
var credenciais_1 = require("./credenciais");
Object.defineProperty(exports, "credenciaisRouter", { enumerable: true, get: function () { return credenciais_1.credenciaisRouter; } });
var certificados_1 = require("./certificados");
Object.defineProperty(exports, "certificadosRouter", { enumerable: true, get: function () { return certificados_1.certificadosRouter; } });
var imports_1 = require("./imports");
Object.defineProperty(exports, "importsRouter", { enumerable: true, get: function () { return imports_1.importsRouter; } });
//# sourceMappingURL=index.js.map