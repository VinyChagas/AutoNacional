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
exports.resolveStoragePath = resolveStoragePath;
/**
 * Resolve paths de armazenamento.
 * Pastas comuns do usuário (Desktop, Documents, Downloads) quando sozinhas
 * são resolvidas para o diretório home, evitando Backend/Desktop.
 */
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const HOME_SUBFOLDERS = new Set([
    'desktop', 'documentos', 'documents', 'downloads',
    'imagens', 'pictures', 'images', 'videos', 'musicas', 'music',
    'áreadetrabalho', // Área de Trabalho (pt-BR, sem espaços)
]);
function resolveStoragePath(raw) {
    const trimmed = raw.trim();
    if (!trimmed)
        return trimmed;
    if (path.isAbsolute(trimmed))
        return trimmed;
    const single = trimmed.replace(/[/\\]/g, '').replace(/\s/g, '').toLowerCase();
    if (HOME_SUBFOLDERS.has(single)) {
        return path.join(os.homedir(), trimmed.split(/[/\\]/)[0]);
    }
    return path.resolve(trimmed);
}
//# sourceMappingURL=path-resolve.js.map