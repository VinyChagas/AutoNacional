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
exports.parsePlanilhaCredenciais = parsePlanilhaCredenciais;
/**
 * Parser de planilhas (xlsx, csv) para importação de credenciais.
 * Estrutura fixa - Linha 2 = cabeçalhos:
 *   Coluna A (0) = Razão Social
 *   Coluna B (1) = Tipo de Login
 *   Coluna C (2) = CNPJ ou CPF
 *   Coluna D (3) = Senha
 *   Coluna E (4) = Regime Tributário
 */
const XLSX = __importStar(require("xlsx"));
const documento_utils_1 = require("./documento.utils");
const HEADERS_ESPERADOS = [
    'razao social',
    'tipo de login',
    'cnpj ou cpf',
    'senha',
    'regime tributario',
];
function normalizarHeader(h) {
    return String(h ?? '')
        .toLowerCase()
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/[áàâã]/g, 'a')
        .replace(/[éèê]/g, 'e')
        .replace(/[íìî]/g, 'i')
        .replace(/[óòôõ]/g, 'o')
        .replace(/[úùû]/g, 'u')
        .replace(/ç/g, 'c');
}
function validarCabecalhos(headers) {
    if (!headers || headers.length < 5)
        return false;
    const h0 = normalizarHeader(String(headers[0] ?? ''));
    const h1 = normalizarHeader(String(headers[1] ?? ''));
    const h2 = normalizarHeader(String(headers[2] ?? ''));
    const h3 = normalizarHeader(String(headers[3] ?? ''));
    const h4 = normalizarHeader(String(headers[4] ?? ''));
    return ((h0.includes('razao') && h0.includes('social')) &&
        (h1.includes('tipo') && h1.includes('login')) &&
        (h2.includes('cnpj') || h2.includes('cpf')) &&
        h3.includes('senha') &&
        (h4.includes('regime') || h4.includes('tributari')));
}
const COLS = {
    razao_social: 0,
    tipo_login: 1,
    cnpj_ou_cpf: 2,
    senha: 3,
    regime: 4,
};
/**
 * Parse de buffer (xlsx ou csv) para linhas de credencial.
 * Linha 1 = opcional, Linha 2 = cabeçalhos obrigatórios, Linha 3+ = dados.
 */
function parsePlanilhaCredenciais(buffer) {
    const workbook = XLSX.read(buffer, { type: 'buffer', raw: false });
    const primeira = workbook.SheetNames[0];
    if (!primeira)
        return [];
    const sheet = workbook.Sheets[primeira];
    const data = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: '',
        blankrows: false,
    });
    if (!data.length)
        return [];
    // Linha 2 (índice 1) = cabeçalhos obrigatórios
    if (data.length < 2) {
        throw new Error('Modelo de planilha inválido. Utilize o modelo oficial.');
    }
    const headerRowIndex = 1;
    const headers = (data[headerRowIndex] ?? []).map((c) => String(c ?? ''));
    if (!validarCabecalhos(headers)) {
        throw new Error('Modelo de planilha inválido. Utilize o modelo oficial.');
    }
    const dataStartIndex = headerRowIndex + 1;
    const resultado = [];
    for (let i = dataStartIndex; i < data.length; i++) {
        const row = data[i] ?? [];
        const cnpjOuCpf = (0, documento_utils_1.normalizarDocumento)(String(row[COLS.cnpj_ou_cpf] ?? ''));
        const tipoRaw = String(row[COLS.tipo_login] ?? 'CNPJ').toUpperCase().trim();
        const tipo = tipoRaw.includes('CPF') ? 'CPF' : 'CNPJ';
        const razao = String(row[COLS.razao_social] ?? '').trim();
        const senha = String(row[COLS.senha] ?? '').trim();
        const regime = String(row[COLS.regime] ?? '').trim() || undefined;
        if (!cnpjOuCpf && !senha && !razao)
            continue;
        resultado.push({
            razao_social: razao || `Empresa ${cnpjOuCpf || `Linha ${i + 1}`}`,
            tipo_login: tipo,
            cnpj_ou_cpf: cnpjOuCpf,
            senha,
            regime,
            linha: i + 1,
            indice: resultado.length,
        });
    }
    return resultado;
}
//# sourceMappingURL=planilha.parser.js.map