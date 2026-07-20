"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.needsCredentialRevalidation = exports.isCertValido = exports.EMPRESA_SEGMENTS = void 0;
exports.isEmpresaSegment = isEmpresaSegment;
exports.parseEmpresaSegment = parseEmpresaSegment;
exports.matchesEmpresaSegment = matchesEmpresaSegment;
/**
 * Segmentos operacionais dos cards de resumo da tela de Empresas.
 * Matching alinhado ao EmpresaStatusService / summary.
 */
const empresa_status_1 = require("./empresa-status");
exports.EMPRESA_SEGMENTS = [
    'ALL',
    'CERT_EXPIRED',
    'CREDENTIAL_REVALIDATION_REQUIRED',
    'OPERATIONAL',
    'NOT_ELIGIBLE',
];
function isEmpresaSegment(value) {
    return exports.EMPRESA_SEGMENTS.includes(value);
}
function parseEmpresaSegment(raw) {
    if (!raw?.trim())
        return 'ALL';
    const normalized = raw.trim().toUpperCase();
    return isEmpresaSegment(normalized) ? normalized : 'ALL';
}
/** Reexport para consumidores que importavam de empresas-segment. */
var empresa_status_2 = require("./empresa-status");
Object.defineProperty(exports, "isCertValido", { enumerable: true, get: function () { return empresa_status_2.isCertValido; } });
Object.defineProperty(exports, "needsCredentialRevalidation", { enumerable: true, get: function () { return empresa_status_2.needsCredentialRevalidation; } });
/**
 * Segmento ativo dos cards. Deve produzir o mesmo universo contado no summary.
 */
function matchesEmpresaSegment(item, segment) {
    const snap = item.certificate_status != null && item.automation_eligibility != null
        ? {
            certificate_status: item.certificate_status,
            automation_eligibility: item.automation_eligibility,
            credential_requires_revalidation: (0, empresa_status_1.needsCredentialRevalidation)(item),
        }
        : (() => {
            const s = (0, empresa_status_1.computeOperationalSnapshot)(item);
            return {
                certificate_status: s.certificate_status,
                automation_eligibility: s.automation_eligibility,
                credential_requires_revalidation: s.credential_requires_revalidation,
            };
        })();
    switch (segment) {
        case 'ALL':
            return true;
        case 'CERT_EXPIRED':
            return snap.certificate_status === 'EXPIRED';
        case 'CREDENTIAL_REVALIDATION_REQUIRED':
            return snap.credential_requires_revalidation;
        case 'OPERATIONAL':
            return (0, empresa_status_1.isAutomationEligible)(snap.automation_eligibility);
        case 'NOT_ELIGIBLE':
            return snap.automation_eligibility === 'NOT_ELIGIBLE';
        default: {
            const _exhaustive = segment;
            return _exhaustive;
        }
    }
}
//# sourceMappingURL=empresas-segment.js.map