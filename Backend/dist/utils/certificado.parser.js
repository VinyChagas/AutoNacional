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
exports.parseCertificado = parseCertificado;
/**
 * Parser de certificados digitais ICP-Brasil (.pfx/.p12).
 * Extrai CNPJ, razão social, data de validade, serial e thumbprint.
 */
const forge = __importStar(require("node-forge"));
const logger_1 = require("../infrastructure/logger");
const logger = (0, logger_1.getLogger)('certificado-parser');
function extrairCnpjDoTexto(texto) {
    if (!texto || !texto.trim())
        return null;
    const limpo = texto.replace(/\D/g, '');
    if (limpo.length === 14 && limpo !== '00000000000000')
        return limpo;
    const match = texto.match(/(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})|\b(\d{14})\b/);
    if (match) {
        const cnpj = (match[1] || match[2] || '').replace(/\D/g, '');
        if (cnpj.length === 14)
            return cnpj;
    }
    return null;
}
function formatarCnpj(cnpj) {
    return cnpj.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
}
/**
 * Extrai informações completas do certificado PFX/P12.
 * @throws Error se senha incorreta ou certificado inválido
 */
function parseCertificado(conteudoPfx, senha) {
    if (!conteudoPfx?.length) {
        throw new Error('Arquivo do certificado vazio ou inválido');
    }
    if (!senha || !senha.trim()) {
        throw new Error('Senha do certificado é obrigatória');
    }
    try {
        const p12Asn1 = forge.asn1.fromDer(conteudoPfx.toString('binary'));
        const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, senha);
        const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
        const certBag = certBags[forge.pki.oids.certBag]?.[0];
        if (!certBag?.cert) {
            throw new Error('Certificado não encontrado no arquivo PKCS12');
        }
        const cert = certBag.cert;
        let razao_social = '';
        let cnpj = null;
        const subject = cert.subject.attributes;
        for (const attr of subject) {
            if (attr.shortName === 'CN') {
                const cnVal = attr.value;
                if (cnVal.includes(':')) {
                    const [nome, parteCnpj] = cnVal.split(':', 2);
                    razao_social = nome.trim();
                    cnpj = extrairCnpjDoTexto(parteCnpj?.trim() || '') || extrairCnpjDoTexto(cnVal);
                }
                else {
                    razao_social = cnVal;
                    cnpj = extrairCnpjDoTexto(cnVal);
                }
                if (cnpj)
                    break;
            }
        }
        if (!cnpj) {
            for (const attr of subject) {
                if (attr.shortName === 'OU') {
                    cnpj = extrairCnpjDoTexto(attr.value);
                    if (cnpj)
                        break;
                }
            }
        }
        if (!cnpj) {
            for (const attr of subject) {
                const cnpjExtraido = extrairCnpjDoTexto(attr.value);
                if (cnpjExtraido) {
                    cnpj = cnpjExtraido;
                    if (!razao_social && attr.shortName === 'CN')
                        razao_social = attr.value;
                    break;
                }
            }
        }
        if (!cnpj || cnpj.length !== 14) {
            throw new Error('Não foi possível extrair o CNPJ do certificado. Verifique se é um certificado ICP-Brasil válido.');
        }
        const validity = cert.validity;
        const data_validade = validity.notAfter
            ? `${String(validity.notAfter.getDate()).padStart(2, '0')}/${String(validity.notAfter.getMonth() + 1).padStart(2, '0')}/${validity.notAfter.getFullYear()}`
            : null;
        const serial = cert.serialNumber || null;
        let thumbprint = null;
        try {
            const certDer = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
            const md = forge.md.sha1.create();
            md.update(certDer, 'raw');
            thumbprint = md.digest().toHex().toUpperCase();
        }
        catch {
            // thumbprint opcional
        }
        return {
            cnpj,
            cnpj_formatado: formatarCnpj(cnpj),
            razao_social: razao_social || `Empresa ${formatarCnpj(cnpj)}`,
            data_validade,
            serial,
            thumbprint,
        };
    }
    catch (e) {
        const msg = e.message?.toLowerCase() || '';
        if (msg.includes('password') || msg.includes('mac') || msg.includes('decrypt')) {
            throw new Error('Senha do certificado incorreta');
        }
        logger.error({ err: e }, 'Erro ao parsear certificado');
        throw e;
    }
}
//# sourceMappingURL=certificado.parser.js.map