"use strict";
/**
 * Segmentos operacionais dos cards de resumo da tela de Empresas.
 * Fonte única para parse, validação e matching — alinhado ao summary.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EMPRESA_SEGMENTS = void 0;
exports.isEmpresaSegment = isEmpresaSegment;
exports.parseEmpresaSegment = parseEmpresaSegment;
exports.isCertValido = isCertValido;
exports.needsCredentialRevalidation = needsCredentialRevalidation;
exports.matchesEmpresaSegment = matchesEmpresaSegment;
exports.EMPRESA_SEGMENTS = [
    'ALL',
    'CERT_EXPIRED',
    'CREDENTIAL_REVALIDATION_REQUIRED',
    'OPERATIONAL',
    'NOT_ELIGIBLE',
];
const DIAS_REVALIDAR_CRED = 7;
function isEmpresaSegment(value) {
    return exports.EMPRESA_SEGMENTS.includes(value);
}
function parseEmpresaSegment(raw) {
    if (!raw?.trim())
        return 'ALL';
    const normalized = raw.trim().toUpperCase();
    return isEmpresaSegment(normalized) ? normalized : 'ALL';
}
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
function isCertValido(hasCert, certValidade) {
    if (!hasCert)
        return false;
    const dt = parseDataValidade(certValidade);
    if (!dt)
        return false;
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    return dt >= hoje;
}
/**
 * Mesma regra do KPI "Credenciais para Validar" em obterSummary.
 */
function needsCredentialRevalidation(input) {
    if (!input.has_credenciais)
        return false;
    const status = (input.cred_status ?? '').toUpperCase();
    if (status === 'NAO_TESTADO' ||
        status === 'INVALIDA' ||
        status === 'ERRO_VALIDACAO') {
        return true;
    }
    const ultimo = input.cred_ultimo_teste_em;
    if (!ultimo)
        return false;
    const dt = ultimo instanceof Date ? ultimo : new Date(ultimo);
    if (isNaN(dt.getTime()))
        return false;
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const limite = new Date(hoje.getTime() - DIAS_REVALIDAR_CRED * 24 * 60 * 60 * 1000);
    return dt < limite;
}
/**
 * Segmento ativo dos cards. Deve produzir o mesmo universo contado no summary.
 */
function matchesEmpresaSegment(item, segment) {
    switch (segment) {
        case 'ALL':
            return true;
        case 'CERT_EXPIRED':
            return item.has_certificado && !isCertValido(true, item.cert_validade);
        case 'CREDENTIAL_REVALIDATION_REQUIRED':
            return needsCredentialRevalidation(item);
        case 'OPERATIONAL':
            return item.status_geral === 'OPERACIONAL';
        case 'NOT_ELIGIBLE':
            return item.status_geral !== 'OPERACIONAL';
        default: {
            const _exhaustive = segment;
            return _exhaustive;
        }
    }
}
//# sourceMappingURL=empresas-segment.js.map