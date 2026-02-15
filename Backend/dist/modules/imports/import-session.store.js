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
exports.createSession = createSession;
exports.getSessionFiles = getSessionFiles;
exports.destroySession = destroySession;
exports.cleanupExpired = cleanupExpired;
/**
 * Armazenamento temporário de arquivos de certificados para o fluxo Preview + Confirmar.
 * Mantém em disco para sobreviver entre requests.
 */
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto_1 = require("crypto");
const BASE = path.join(process.cwd(), 'temp', 'import-sessions');
const TTL_MS = 60 * 60 * 1000; // 1 hora
function sessionDir(sessionId) {
    return path.join(BASE, sessionId);
}
function ensureBase() {
    if (!fs.existsSync(BASE)) {
        fs.mkdirSync(BASE, { recursive: true });
    }
}
function isExpired(dir) {
    try {
        const stat = fs.statSync(dir);
        return Date.now() - stat.mtimeMs > TTL_MS;
    }
    catch {
        return true;
    }
}
function createSession(files) {
    ensureBase();
    const sessionId = (0, crypto_1.randomUUID)();
    const dir = sessionDir(sessionId);
    fs.mkdirSync(dir, { recursive: true });
    files.forEach((f, i) => {
        if (f.buffer?.length) {
            const ext = (f.originalname || '').toLowerCase().endsWith('.p12') ? '.p12' : '.pfx';
            fs.writeFileSync(path.join(dir, `${i}${ext}`), f.buffer);
        }
    });
    return sessionId;
}
function getSessionFiles(sessionId) {
    const dir = sessionDir(sessionId);
    if (!fs.existsSync(dir)) {
        throw new Error('Sessão de importação expirada ou inválida');
    }
    if (isExpired(dir)) {
        destroySession(sessionId);
        throw new Error('Sessão de importação expirada');
    }
    const files = [];
    const entries = fs.readdirSync(dir).sort((a, b) => {
        const na = parseInt(a.replace(/\D/g, ''), 10);
        const nb = parseInt(b.replace(/\D/g, ''), 10);
        return na - nb;
    });
    for (const e of entries) {
        if (e.endsWith('.pfx') || e.endsWith('.p12')) {
            const fp = path.join(dir, e);
            const buffer = fs.readFileSync(fp);
            files.push({ buffer, originalName: e });
        }
    }
    return files;
}
function destroySession(sessionId) {
    const dir = sessionDir(sessionId);
    try {
        if (fs.existsSync(dir)) {
            fs.rmSync(dir, { recursive: true });
        }
    }
    catch {
        // ignorar
    }
}
/**
 * Remove sessões expiradas.
 */
function cleanupExpired() {
    try {
        if (!fs.existsSync(BASE))
            return;
        for (const name of fs.readdirSync(BASE)) {
            const dir = path.join(BASE, name);
            if (isExpired(dir)) {
                try {
                    fs.rmSync(dir, { recursive: true });
                }
                catch {
                    // ignorar
                }
            }
        }
    }
    catch {
        // ignorar
    }
}
//# sourceMappingURL=import-session.store.js.map