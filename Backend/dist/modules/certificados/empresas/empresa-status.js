"use strict";
/**
 * EmpresaStatusService — fonte única de verdade para status operacional.
 * Usado por listagem, summary, segmentos, execução e (futuro) exportação.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DIAS_REVALIDAR_CRED = exports.DIAS_EXPIRING_SOON = void 0;
exports.computeCertificateStatus = computeCertificateStatus;
exports.normalizeCredentialStatus = normalizeCredentialStatus;
exports.computeCredentialRevalidation = computeCredentialRevalidation;
exports.computeOperationalSnapshot = computeOperationalSnapshot;
exports.isCertValido = isCertValido;
exports.needsCredentialRevalidation = needsCredentialRevalidation;
exports.isAutomationEligible = isAutomationEligible;
exports.DIAS_EXPIRING_SOON = 30;
exports.DIAS_REVALIDAR_CRED = 7;
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
function startOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
}
function toDate(value) {
    if (value == null)
        return null;
    if (value instanceof Date)
        return isNaN(value.getTime()) ? null : value;
    const parsed = parseDataValidade(value) ?? new Date(value);
    return isNaN(parsed.getTime()) ? null : parsed;
}
function computeCertificateStatus(hasCert, certValidade, now = new Date()) {
    if (!hasCert)
        return { status: 'MISSING', daysDelta: null };
    if (!certValidade?.trim())
        return { status: 'ERROR', daysDelta: null };
    const dt = parseDataValidade(certValidade);
    if (!dt)
        return { status: 'ERROR', daysDelta: null };
    const hoje = startOfDay(now);
    const validade = startOfDay(dt);
    const msPerDay = 24 * 60 * 60 * 1000;
    const daysDelta = Math.round((validade.getTime() - hoje.getTime()) / msPerDay);
    if (daysDelta < 0)
        return { status: 'EXPIRED', daysDelta };
    if (daysDelta <= exports.DIAS_EXPIRING_SOON)
        return { status: 'EXPIRING_SOON', daysDelta };
    return { status: 'VALID', daysDelta };
}
function normalizeCredentialStatus(hasCred, credStatus) {
    if (!hasCred)
        return 'MISSING';
    const s = (credStatus ?? '').toUpperCase().replace(/\s/g, '_');
    switch (s) {
        case 'OK':
        case 'VALIDA':
        case 'VALIDO':
            return 'VALID';
        case 'INVALIDA':
        case 'INVALIDO':
        case 'SENHA_INCORRETA':
            return 'INVALID';
        case 'ERRO_VALIDACAO':
            return 'VALIDATION_ERROR';
        case 'INATIVA':
            return 'INACTIVE';
        case 'TESTANDO':
            return 'TESTING';
        case 'NAO_TESTADO':
        case 'SEM_CREDENCIAIS':
            return 'NOT_TESTED';
        default:
            return 'NOT_TESTED';
    }
}
function computeCredentialRevalidation(credentialStatus, ultimoTeste, now = new Date()) {
    if (credentialStatus === 'MISSING') {
        return { requires: false, reason: null };
    }
    if (credentialStatus === 'NOT_TESTED') {
        return { requires: true, reason: 'NOT_TESTED' };
    }
    if (credentialStatus === 'INVALID') {
        return { requires: true, reason: 'INVALID_PASSWORD' };
    }
    if (credentialStatus === 'VALIDATION_ERROR') {
        return { requires: true, reason: 'VALIDATION_ERROR' };
    }
    if (credentialStatus === 'INACTIVE') {
        return { requires: true, reason: 'INACTIVE' };
    }
    if (credentialStatus === 'TESTING') {
        return { requires: false, reason: null };
    }
    // VALID
    const dt = toDate(ultimoTeste);
    if (!dt) {
        return { requires: true, reason: 'STALE_TEST' };
    }
    const hoje = startOfDay(now);
    const teste = startOfDay(dt);
    const dias = Math.floor((hoje.getTime() - teste.getTime()) / (1000 * 60 * 60 * 24));
    if (dias > exports.DIAS_REVALIDAR_CRED) {
        return { requires: true, reason: 'STALE_TEST' };
    }
    return { requires: false, reason: null };
}
/** Credencial utilizável agora para automação (senha OK, mesmo se teste antigo). */
function isCredentialUsable(status) {
    return status === 'VALID';
}
/** Certificado utilizável agora (válido ou vencendo). */
function isCertificateUsable(status) {
    return status === 'VALID' || status === 'EXPIRING_SOON';
}
function mapDisplayStatus(eligibility, certificateStatus) {
    if (eligibility === 'ELIGIBLE')
        return 'OPERACIONAL';
    if (eligibility === 'NOT_ELIGIBLE')
        return 'INOPERANTE';
    // ELIGIBLE_WITH_WARNING
    if (certificateStatus === 'EXPIRING_SOON')
        return 'ATENCAO';
    return 'PARCIAL';
}
function buildRecommendedAction(eligibility, certificateStatus, revalidationReason) {
    if (eligibility === 'ELIGIBLE')
        return null;
    if (certificateStatus === 'EXPIRED')
        return 'Renovar certificado digital';
    if (certificateStatus === 'EXPIRING_SOON')
        return 'Renovar certificado em breve';
    if (certificateStatus === 'ERROR')
        return 'Verificar arquivo do certificado';
    if (certificateStatus === 'MISSING' && eligibility === 'NOT_ELIGIBLE') {
        return 'Cadastrar certificado ou credencial válida';
    }
    switch (revalidationReason) {
        case 'INVALID_PASSWORD':
            return 'Corrigir senha da credencial';
        case 'NOT_TESTED':
            return 'Validar credencial';
        case 'STALE_TEST':
            return 'Revalidar credencial';
        case 'VALIDATION_ERROR':
            return 'Revalidar credencial (erro técnico)';
        case 'INACTIVE':
            return 'Reativar credencial';
        default:
            return eligibility === 'NOT_ELIGIBLE'
                ? 'Cadastrar método de login válido'
                : 'Revisar pendências';
    }
}
/**
 * Calcula o snapshot operacional completo (regra única).
 */
function computeOperationalSnapshot(input) {
    const now = input.now ?? new Date();
    const { status: certificate_status, daysDelta: certificate_days_delta } = computeCertificateStatus(input.has_certificado, input.cert_validade, now);
    const credential_status = normalizeCredentialStatus(input.has_credenciais, input.cred_status);
    const revalidation = computeCredentialRevalidation(credential_status, input.cred_ultimo_teste_em, now);
    const certUsable = isCertificateUsable(certificate_status);
    const credUsable = isCredentialUsable(credential_status);
    const issue_codes = [];
    const issue_messages = [];
    if (certificate_status === 'MISSING') {
        issue_codes.push('CERT_MISSING');
        issue_messages.push('Sem certificado digital');
    }
    else if (certificate_status === 'EXPIRED') {
        issue_codes.push('CERT_EXPIRED');
        issue_messages.push('Certificado vencido');
    }
    else if (certificate_status === 'EXPIRING_SOON') {
        issue_codes.push('CERT_EXPIRING_SOON');
        const dias = certificate_days_delta ?? 0;
        issue_messages.push(dias === 0
            ? 'Certificado vence hoje'
            : `Certificado vence em ${dias} dia${dias === 1 ? '' : 's'}`);
    }
    else if (certificate_status === 'ERROR') {
        issue_codes.push('CERT_ERROR');
        issue_messages.push('Erro na validade do certificado');
    }
    if (revalidation.requires && revalidation.reason) {
        issue_codes.push(`CRED_${revalidation.reason}`);
        switch (revalidation.reason) {
            case 'NOT_TESTED':
                issue_messages.push('Credencial nunca testada');
                break;
            case 'STALE_TEST':
                issue_messages.push('Credencial com teste antigo (>7 dias)');
                break;
            case 'INVALID_PASSWORD':
                issue_messages.push(input.cred_ultima_mensagem?.trim() || 'Senha da credencial inválida');
                break;
            case 'VALIDATION_ERROR':
                issue_messages.push('Erro técnico na validação da credencial');
                break;
            case 'INACTIVE':
                issue_messages.push('Credencial inativa');
                break;
        }
    }
    else if (credential_status === 'MISSING' && !certUsable) {
        issue_codes.push('CRED_MISSING');
        issue_messages.push('Sem credenciais');
    }
    let automation_eligibility;
    if (certificate_status === 'VALID') {
        automation_eligibility = revalidation.requires
            ? 'ELIGIBLE_WITH_WARNING'
            : 'ELIGIBLE';
    }
    else if (certificate_status === 'EXPIRING_SOON') {
        automation_eligibility = 'ELIGIBLE_WITH_WARNING';
    }
    else if (certificate_status === 'ERROR' && credUsable) {
        automation_eligibility = 'ELIGIBLE_WITH_WARNING';
    }
    else if ((certificate_status === 'EXPIRED' ||
        certificate_status === 'MISSING' ||
        certificate_status === 'ERROR') &&
        credUsable) {
        // Ausente/vencido + credencial válida = apta (com pendência do certificado)
        automation_eligibility =
            certificate_status === 'EXPIRED' || certificate_status === 'MISSING'
                ? 'ELIGIBLE'
                : 'ELIGIBLE_WITH_WARNING';
        // Se credencial também precisa revalidar (teste antigo), alerta
        if (revalidation.requires) {
            automation_eligibility = 'ELIGIBLE_WITH_WARNING';
        }
    }
    else if (!certUsable && !credUsable) {
        automation_eligibility = 'NOT_ELIGIBLE';
    }
    else {
        automation_eligibility = 'NOT_ELIGIBLE';
    }
    // Cert válido sem pendências extras → limpar issues de "sem cred" se só isso
    if (automation_eligibility === 'ELIGIBLE' && certificate_status === 'VALID') {
        // mantém issues de cred se revalidation — mas ELIGIBLE puro não tem
    }
    const status_geral = mapDisplayStatus(automation_eligibility, certificate_status);
    const recommended_action = buildRecommendedAction(automation_eligibility, certificate_status, revalidation.reason);
    let status_geral_motivo;
    if (automation_eligibility === 'ELIGIBLE') {
        status_geral_motivo =
            certUsable && credUsable
                ? 'Certificado válido e credenciais OK'
                : certUsable
                    ? 'Certificado válido'
                    : 'Credenciais OK';
    }
    else if (issue_messages.length > 0) {
        status_geral_motivo = issue_messages[0];
    }
    else {
        status_geral_motivo = 'Verificar status';
    }
    let login_metodo = null;
    if (certUsable)
        login_metodo = 'CERTIFICADO';
    else if (credUsable)
        login_metodo = 'CREDENCIAL';
    return {
        certificate_status,
        credential_status,
        credential_requires_revalidation: revalidation.requires,
        credential_revalidation_reason: revalidation.reason,
        automation_eligibility,
        issue_codes,
        issue_messages,
        recommended_action,
        certificate_days_delta,
        status_geral,
        status_geral_motivo,
        login_metodo,
    };
}
/** Compat: certificado ainda não vencido (VALID ou EXPIRING_SOON). */
function isCertValido(hasCert, certValidade) {
    const { status } = computeCertificateStatus(hasCert, certValidade);
    return status === 'VALID' || status === 'EXPIRING_SOON';
}
function needsCredentialRevalidation(input) {
    const status = normalizeCredentialStatus(input.has_credenciais, input.cred_status);
    return computeCredentialRevalidation(status, input.cred_ultimo_teste_em, input.now).requires;
}
function isAutomationEligible(eligibility) {
    return eligibility === 'ELIGIBLE' || eligibility === 'ELIGIBLE_WITH_WARNING';
}
//# sourceMappingURL=empresa-status.js.map