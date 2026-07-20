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
exports.EMPRESA_EXPORT_REPORTS = void 0;
exports.isEmpresaExportReport = isEmpresaExportReport;
exports.parseEmpresaExportReport = parseEmpresaExportReport;
exports.filterEmpresasForReport = filterEmpresasForReport;
exports.assertExportRowHasNoSecrets = assertExportRowHasNoSecrets;
exports.toExportRow = toExportRow;
exports.buildExportResumo = buildExportResumo;
exports.buildExportFilename = buildExportFilename;
exports.buildEmpresasWorkbookBuffer = buildEmpresasWorkbookBuffer;
/**
 * Exportação Excel de empresas — reutiliza EmpresaAgregada / status unificado.
 * Nunca inclui senha, caminho privado de certificado ou dados criptografados.
 */
const XLSX = __importStar(require("xlsx"));
exports.EMPRESA_EXPORT_REPORTS = [
    'NOT_ELIGIBLE',
    'ALL_PENDING',
    'FILTERED',
];
function isEmpresaExportReport(value) {
    return exports.EMPRESA_EXPORT_REPORTS.includes(value);
}
function parseEmpresaExportReport(raw) {
    if (!raw?.trim())
        return null;
    const normalized = raw.trim().toUpperCase();
    return isEmpresaExportReport(normalized) ? normalized : null;
}
/** Filtra o conjunto já listado conforme o tipo de relatório. */
function filterEmpresasForReport(items, report) {
    switch (report) {
        case 'NOT_ELIGIBLE':
            return items.filter((i) => i.automation_eligibility === 'NOT_ELIGIBLE');
        case 'ALL_PENDING':
            return items.filter((i) => (i.issue_codes && i.issue_codes.length > 0) ||
                i.automation_eligibility !== 'ELIGIBLE');
        case 'FILTERED':
            return items;
        default: {
            const _exhaustive = report;
            return _exhaustive;
        }
    }
}
const FORBIDDEN_KEYS = [
    'senha',
    'password',
    'arquivo',
    'encrypted',
    'criptograf',
    'pfx',
    'private',
];
function assertExportRowHasNoSecrets(row) {
    const serialized = JSON.stringify(row).toLowerCase();
    for (const key of FORBIDDEN_KEYS) {
        // Apenas garantir que não há campos com esses nomes no objeto
        void key;
    }
    const keys = Object.keys(row).map((k) => k.toLowerCase());
    for (const forbidden of FORBIDDEN_KEYS) {
        if (keys.some((k) => k.includes(forbidden))) {
            throw new Error(`Coluna proibida na exportação: contém "${forbidden}"`);
        }
    }
    // sanitized payload não deve parecer base64 longo de senha — só validação estrutural
    if (serialized.includes('"senha"') || serialized.includes('"password"')) {
        throw new Error('Payload de exportação contém chave de segredo');
    }
}
function simNao(v) {
    return v ? 'Sim' : 'Não';
}
function aptaLabel(eligibility) {
    switch (eligibility) {
        case 'ELIGIBLE':
            return 'Sim';
        case 'ELIGIBLE_WITH_WARNING':
            return 'Sim (com pendência)';
        case 'NOT_ELIGIBLE':
            return 'Não';
        default:
            return eligibility;
    }
}
function metodoLabel(item) {
    if (item.certificate_status === 'VALID' || item.certificate_status === 'EXPIRING_SOON') {
        return 'CERTIFICADO';
    }
    if (item.credential_status === 'VALID') {
        return 'CREDENCIAL';
    }
    return 'Nenhum';
}
function toExportRow(item, generatedAt) {
    const row = {
        cnpj_cpf: item.cnpj,
        razao_social: item.razao_social,
        contabilidade: item.contabilidade_nome ?? '',
        apta_para_automacao: aptaLabel(item.automation_eligibility),
        situacao_geral: item.status_geral,
        motivos: (item.issue_messages ?? []).join('; '),
        acao_recomendada: item.recommended_action ?? '',
        possui_certificado: simNao(item.has_certificado),
        validade_certificado: item.cert_validade ?? '',
        status_certificado: item.certificate_status,
        dias_validade: item.certificate_days_delta != null ? String(item.certificate_days_delta) : '',
        possui_credencial: simNao(item.has_credenciais),
        status_credencial: item.credential_status,
        ultimo_teste: item.cred_ultimo_teste_em ?? '',
        mensagem_ultima_validacao: item.cred_ultima_mensagem ?? '',
        metodo_utilizavel: metodoLabel(item),
        data_geracao: generatedAt.toISOString(),
    };
    assertExportRowHasNoSecrets(row);
    return row;
}
const EMPRESAS_HEADERS = [
    { key: 'cnpj_cpf', label: 'CNPJ/CPF' },
    { key: 'razao_social', label: 'Razão social' },
    { key: 'contabilidade', label: 'Contabilidade' },
    { key: 'apta_para_automacao', label: 'Apta para automação' },
    { key: 'situacao_geral', label: 'Situação geral' },
    { key: 'motivos', label: 'Motivos' },
    { key: 'acao_recomendada', label: 'Ação recomendada' },
    { key: 'possui_certificado', label: 'Possui certificado' },
    { key: 'validade_certificado', label: 'Validade do certificado' },
    { key: 'status_certificado', label: 'Status do certificado' },
    { key: 'dias_validade', label: 'Dias para vencer / dias vencido' },
    { key: 'possui_credencial', label: 'Possui credencial' },
    { key: 'status_credencial', label: 'Status da credencial' },
    { key: 'ultimo_teste', label: 'Último teste' },
    { key: 'mensagem_ultima_validacao', label: 'Mensagem da última validação' },
    { key: 'metodo_utilizavel', label: 'Método atualmente utilizável' },
    { key: 'data_geracao', label: 'Data de geração do relatório' },
];
function buildExportResumo(items) {
    const por_contabilidade = {};
    let certificados_vencidos = 0;
    let certificados_vencendo = 0;
    let senhas_invalidas = 0;
    let credenciais_nunca_testadas = 0;
    let falhas_tecnicas_validacao = 0;
    let empresas_sem_metodo = 0;
    for (const i of items) {
        const contab = i.contabilidade_nome?.trim() || '(Sem contabilidade)';
        por_contabilidade[contab] = (por_contabilidade[contab] ?? 0) + 1;
        if (i.certificate_status === 'EXPIRED')
            certificados_vencidos++;
        if (i.certificate_status === 'EXPIRING_SOON')
            certificados_vencendo++;
        if (i.credential_revalidation_reason === 'INVALID_PASSWORD')
            senhas_invalidas++;
        if (i.credential_revalidation_reason === 'NOT_TESTED')
            credenciais_nunca_testadas++;
        if (i.credential_revalidation_reason === 'VALIDATION_ERROR') {
            falhas_tecnicas_validacao++;
        }
        if (!i.has_certificado && !i.has_credenciais)
            empresas_sem_metodo++;
    }
    return {
        total_exportado: items.length,
        certificados_vencidos,
        certificados_vencendo,
        senhas_invalidas,
        credenciais_nunca_testadas,
        falhas_tecnicas_validacao,
        empresas_sem_metodo,
        por_contabilidade,
    };
}
function buildExportFilename(report, at = new Date()) {
    const y = at.getFullYear();
    const m = String(at.getMonth() + 1).padStart(2, '0');
    const d = String(at.getDate()).padStart(2, '0');
    const hh = String(at.getHours()).padStart(2, '0');
    const mm = String(at.getMinutes()).padStart(2, '0');
    const prefix = report === 'NOT_ELIGIBLE'
        ? 'empresas_nao_aptas'
        : report === 'ALL_PENDING'
            ? 'empresas_pendencias'
            : 'empresas_filtradas';
    return `${prefix}_${y}-${m}-${d}_${hh}${mm}.xlsx`;
}
function buildEmpresasWorkbookBuffer(items, generatedAt = new Date()) {
    const rows = items.map((i) => toExportRow(i, generatedAt));
    const sheetEmpresasData = [
        EMPRESAS_HEADERS.map((h) => h.label),
        ...rows.map((r) => EMPRESAS_HEADERS.map((h) => r[h.key])),
    ];
    const resumo = buildExportResumo(items);
    const sheetResumoData = [
        ['Métrica', 'Valor'],
        ['Total exportado', resumo.total_exportado],
        ['Certificados vencidos', resumo.certificados_vencidos],
        ['Certificados vencendo', resumo.certificados_vencendo],
        ['Senhas inválidas', resumo.senhas_invalidas],
        ['Credenciais nunca testadas', resumo.credenciais_nunca_testadas],
        ['Falhas técnicas de validação', resumo.falhas_tecnicas_validacao],
        ['Empresas sem método', resumo.empresas_sem_metodo],
        [],
        ['Contabilidade', 'Quantidade'],
        ...Object.entries(resumo.por_contabilidade)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([nome, qtd]) => [nome, qtd]),
    ];
    const wb = XLSX.utils.book_new();
    const wsEmpresas = XLSX.utils.aoa_to_sheet(sheetEmpresasData);
    const wsResumo = XLSX.utils.aoa_to_sheet(sheetResumoData);
    XLSX.utils.book_append_sheet(wb, wsEmpresas, 'Empresas');
    XLSX.utils.book_append_sheet(wb, wsResumo, 'Resumo');
    const out = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    return Buffer.isBuffer(out) ? out : Buffer.from(out);
}
//# sourceMappingURL=empresas-export.js.map