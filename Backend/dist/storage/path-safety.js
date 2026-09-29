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
exports.resolveSafeCertificatePath = resolveSafeCertificatePath;
exports.resolveSafeCertificatePathPosix = resolveSafeCertificatePathPosix;
exports.assertResolvedInsideBase = assertResolvedInsideBase;
exports.assertResolvedInsidePosixBase = assertResolvedInsidePosixBase;
const path = __importStar(require("path"));
const certificate_storage_1 = require("./certificate-storage");
function resolveSafeCertificatePathWith(pathApi, baseDir, relativePath) {
    if (typeof relativePath !== 'string' || !relativePath.trim()) {
        throw new certificate_storage_1.UnsafeCertificatePathError();
    }
    const trimmed = relativePath.trim();
    if (trimmed.includes('\0')) {
        throw new certificate_storage_1.UnsafeCertificatePathError();
    }
    const posix = trimmed.replace(/\\/g, '/');
    if (pathApi.isAbsolute(trimmed) ||
        pathApi.isAbsolute(posix) ||
        posix.startsWith('/') ||
        posix.startsWith('//') ||
        /^[a-zA-Z]:/.test(posix) ||
        trimmed.startsWith('\\')) {
        throw new certificate_storage_1.UnsafeCertificatePathError();
    }
    const segments = posix.split('/');
    if (segments.some((seg) => seg === '..')) {
        throw new certificate_storage_1.UnsafeCertificatePathError();
    }
    const meaningful = segments.filter((seg) => seg !== '' && seg !== '.');
    if (meaningful.length === 0) {
        throw new certificate_storage_1.UnsafeCertificatePathError();
    }
    const baseResolved = pathApi.resolve(baseDir);
    const candidate = pathApi.resolve(baseResolved, meaningful.join('/'));
    if (candidate === baseResolved) {
        throw new certificate_storage_1.UnsafeCertificatePathError();
    }
    const relative = pathApi.relative(baseResolved, candidate);
    if (relative.startsWith('..') ||
        pathApi.isAbsolute(relative) ||
        relative.split('/').includes('..')) {
        throw new certificate_storage_1.UnsafeCertificatePathError();
    }
    const prefix = baseResolved.endsWith('/')
        ? baseResolved
        : baseResolved + '/';
    if (!candidate.startsWith(prefix)) {
        throw new certificate_storage_1.UnsafeCertificatePathError();
    }
    return candidate;
}
/**
 * Normaliza e valida um path relativo de certificado (filesystem local).
 * Rejeita absoluto, `..`, null bytes e escape da pasta base.
 * Retorna o path absoluto resolvido — uso interno apenas; não logar/devolver.
 */
function resolveSafeCertificatePath(baseDir, relativePath) {
    return resolveSafeCertificatePathWith(path, baseDir, relativePath);
}
/**
 * Variante POSIX para paths remotos (SFTP/Linux).
 */
function resolveSafeCertificatePathPosix(baseDir, relativePath) {
    return resolveSafeCertificatePathWith(path.posix, baseDir, relativePath);
}
async function assertResolvedInsideBase(baseDir, candidate) {
    const fs = await Promise.resolve().then(() => __importStar(require('fs/promises')));
    const baseResolved = path.resolve(baseDir);
    let realBase;
    try {
        realBase = await fs.realpath(baseResolved);
    }
    catch {
        throw new certificate_storage_1.UnsafeCertificatePathError();
    }
    const relativeFromBase = path.relative(baseResolved, path.resolve(candidate));
    if (relativeFromBase.startsWith('..') ||
        path.isAbsolute(relativeFromBase) ||
        relativeFromBase.split(path.sep).includes('..')) {
        throw new certificate_storage_1.UnsafeCertificatePathError();
    }
    const candidateOnReal = path.resolve(realBase, relativeFromBase);
    const prefix = realBase.endsWith(path.sep) ? realBase : realBase + path.sep;
    if (candidateOnReal !== realBase && !candidateOnReal.startsWith(prefix)) {
        throw new certificate_storage_1.UnsafeCertificatePathError();
    }
    try {
        const realCandidate = await fs.realpath(candidateOnReal);
        if (realCandidate !== realBase && !realCandidate.startsWith(prefix)) {
            throw new certificate_storage_1.UnsafeCertificatePathError();
        }
        return realCandidate;
    }
    catch (err) {
        if (err instanceof certificate_storage_1.UnsafeCertificatePathError)
            throw err;
        const code = err.code;
        if (code === 'ENOENT') {
            return candidateOnReal;
        }
        throw new certificate_storage_1.UnsafeCertificatePathError();
    }
}
/**
 * Valida que o path remoto resolvido permanece dentro da base POSIX (SFTP).
 */
function assertResolvedInsidePosixBase(baseDir, candidate) {
    const baseResolved = path.posix.resolve(baseDir);
    const candidateResolved = path.posix.resolve(candidate);
    const relativeFromBase = path.posix.relative(baseResolved, candidateResolved);
    if (relativeFromBase.startsWith('..') ||
        path.posix.isAbsolute(relativeFromBase) ||
        relativeFromBase.split('/').includes('..')) {
        throw new certificate_storage_1.UnsafeCertificatePathError();
    }
    const prefix = baseResolved.endsWith('/')
        ? baseResolved
        : baseResolved + '/';
    if (candidateResolved !== baseResolved &&
        !candidateResolved.startsWith(prefix)) {
        throw new certificate_storage_1.UnsafeCertificatePathError();
    }
    return candidateResolved;
}
//# sourceMappingURL=path-safety.js.map