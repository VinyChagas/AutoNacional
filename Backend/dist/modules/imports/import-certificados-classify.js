"use strict";
/**
 * Classificação de itens do preview de importação de certificados.
 * Funções puras — testáveis sem banco/Storage.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseDataValidade = parseDataValidade;
exports.isCertificadoVencido = isCertificadoVencido;
exports.diffDiasValidade = diffDiasValidade;
exports.isExactDuplicate = isExactDuplicate;
exports.classifyIncomingCertificate = classifyIncomingCertificate;
exports.defaultConfirmAction = defaultConfirmAction;
exports.toLegacyAcao = toLegacyAcao;
function parseDataValidade(val) {
    if (!val?.trim())
        return null;
    const m = val.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
        const d = new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
        return isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
}
function isCertificadoVencido(validUntil, now = new Date()) {
    const dt = parseDataValidade(validUntil);
    if (!dt)
        return false;
    const hoje = new Date(now);
    hoje.setHours(0, 0, 0, 0);
    const val = new Date(dt);
    val.setHours(0, 0, 0, 0);
    return val.getTime() < hoje.getTime();
}
/** Diferença em dias: incoming - existing (positivo = incoming vence depois). */
function diffDiasValidade(incomingValidUntil, existingValidUntil) {
    const a = parseDataValidade(incomingValidUntil);
    const b = parseDataValidade(existingValidUntil);
    if (!a || !b)
        return null;
    const ms = 24 * 60 * 60 * 1000;
    return Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / ms);
}
function startOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
}
function isExactDuplicate(incoming, existing) {
    const tin = (incoming.thumbprint ?? '').trim().toUpperCase();
    const tex = (existing.thumbprint ?? '').trim().toUpperCase();
    if (tin && tex && tin === tex)
        return true;
    const sin = (incoming.serial ?? '').trim().toUpperCase().replace(/^0+/, '');
    const sex = (existing.serial ?? '').trim().toUpperCase().replace(/^0+/, '');
    if (sin && sex && sin === sex)
        return true;
    return false;
}
/**
 * Classifica o certificado enviado em relação ao existente (se houver).
 */
function classifyIncomingCertificate(input) {
    const now = input.now ?? new Date();
    if (input.documentMismatch) {
        return {
            action: 'DOCUMENT_MISMATCH',
            can_confirm: false,
            message: 'Documento do certificado não corresponde à empresa',
            days_delta: null,
        };
    }
    const incomingExpired = isCertificadoVencido(input.incoming.valid_until, now);
    if (!input.existing) {
        if (incomingExpired) {
            return {
                action: 'EXPIRED_CERTIFICATE',
                can_confirm: false,
                message: 'Certificado enviado já está vencido',
                days_delta: null,
            };
        }
        return {
            action: 'NEW',
            can_confirm: true,
            message: 'Novo certificado — será cadastrado',
            days_delta: null,
        };
    }
    if (isExactDuplicate(input.incoming, input.existing)) {
        return {
            action: 'EXACT_DUPLICATE',
            can_confirm: false,
            message: 'Certificado idêntico ao já cadastrado (mesmo thumbprint/serial)',
            days_delta: 0,
        };
    }
    if (incomingExpired) {
        return {
            action: 'EXPIRED_CERTIFICATE',
            can_confirm: false,
            message: 'Certificado enviado já está vencido',
            days_delta: diffDiasValidade(input.incoming.valid_until, input.existing.valid_until),
        };
    }
    const days = diffDiasValidade(input.incoming.valid_until, input.existing.valid_until);
    if (days != null && days <= 0) {
        return {
            action: 'OLDER_CERTIFICATE',
            can_confirm: false,
            message: days === 0
                ? 'Novo certificado tem a mesma validade do atual'
                : `Novo certificado vence ${Math.abs(days)} dia(s) antes do atual`,
            days_delta: days,
        };
    }
    return {
        action: 'UPDATE_AVAILABLE',
        can_confirm: true,
        message: days != null
            ? `Novo certificado possui validade superior (+${days} dia(s))`
            : 'Novo certificado pode substituir o atual',
        days_delta: days,
    };
}
/** Mapeia ação de preview para ação de confirmação padrão. */
function defaultConfirmAction(previewAction) {
    switch (previewAction) {
        case 'NEW':
            return 'CREATE';
        case 'UPDATE_AVAILABLE':
            return 'REPLACE_EXISTING';
        default:
            return 'SKIP';
    }
}
/** Ações legadas mantidas no campo `acao` para compatibilidade. */
function toLegacyAcao(action) {
    switch (action) {
        case 'NEW':
            return 'IMPORTAR';
        case 'UPDATE_AVAILABLE':
            return 'UPDATE_AVAILABLE';
        case 'EXACT_DUPLICATE':
            return 'DUPLICADO';
        case 'OLDER_CERTIFICATE':
            return 'OLDER_CERTIFICATE';
        case 'EXPIRED_CERTIFICATE':
            return 'EXPIRED_CERTIFICATE';
        case 'INVALID_FILE':
        case 'DOCUMENT_MISMATCH':
        case 'ERROR':
            return 'ERRO';
        default: {
            const _e = action;
            return _e;
        }
    }
}
//# sourceMappingURL=import-certificados-classify.js.map