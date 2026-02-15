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
exports.carregarCertificadoPorCnpj = carregarCertificadoPorCnpj;
/**
 * Loader de certificados para automação NFSe.
 * Carrega PFX do Supabase Storage e descriptografa a senha.
 */
const certificadosRepo = __importStar(require("../repositories/certificados"));
const supabase_1 = require("../config/supabase");
const env_1 = require("../config/env");
const crypto_1 = require("../infrastructure/crypto");
const logger_1 = require("../infrastructure/logger");
const logger = (0, logger_1.getLogger)('certificate-loader');
function limparCnpj(cnpj) {
    return cnpj.replace(/[.\/\-\s]/g, '').trim();
}
/**
 * Carrega certificado por CNPJ: baixa PFX do Storage e retorna buffer + senha.
 */
async function carregarCertificadoPorCnpj(cnpj) {
    const cnpjLimpo = limparCnpj(cnpj);
    if (cnpjLimpo.length !== 14) {
        throw new Error(`CNPJ inválido: ${cnpj}`);
    }
    const cert = await certificadosRepo.obterPorCnpj(cnpjLimpo);
    if (!cert) {
        throw new Error(`Certificado não encontrado para CNPJ ${cnpjLimpo}`);
    }
    if (!cert.arquivo?.trim()) {
        throw new Error(`Certificado para CNPJ ${cnpjLimpo} não possui arquivo PFX. Reimporte o certificado na tela de Empresas.`);
    }
    if (!cert.senhaCriptografada?.trim()) {
        throw new Error(`Certificado para CNPJ ${cnpjLimpo} não possui senha armazenada. ` +
            `Reimporte o certificado na tela de Empresas para salvar a senha.`);
    }
    const supabase = (0, supabase_1.getSupabaseClient)();
    const bucket = env_1.env.CERT_STORAGE_BUCKET || 'certificados';
    const { data: pfxBuffer, error } = await supabase.storage
        .from(bucket)
        .download(cert.arquivo);
    if (error || !pfxBuffer) {
        logger.error({ err: error, path: cert.arquivo }, 'Erro ao baixar certificado do Storage');
        throw new Error(`Falha ao baixar certificado: ${error?.message ?? 'Arquivo não encontrado'}`);
    }
    const arrayBuffer = await pfxBuffer.arrayBuffer();
    const pfx = Buffer.from(arrayBuffer);
    let passphrase;
    try {
        passphrase = (0, crypto_1.decryptPassword)(cert.senhaCriptografada);
    }
    catch (e) {
        logger.error({ err: e }, 'Erro ao descriptografar senha do certificado');
        throw new Error('Falha ao descriptografar senha. Verifique se CRYPTO_KEY/APP_CRED_KEY está configurada corretamente.');
    }
    return { pfx, passphrase };
}
//# sourceMappingURL=certificate-loader.js.map