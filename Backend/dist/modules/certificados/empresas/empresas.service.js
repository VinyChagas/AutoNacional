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
exports.parseListarParams = parseListarParams;
exports.validarFiltrosConflitantes = validarFiltrosConflitantes;
exports.listarEmpresas = listarEmpresas;
exports.obterEmpresaPorId = obterEmpresaPorId;
exports.obterSummary = obterSummary;
/**
 * Serviço de empresas - regras de negócio e parse de parâmetros.
 */
const repo = __importStar(require("./empresas.repo"));
const SORT_WHITELIST = [
    'cnpj',
    'razao_social',
    'contabilidade_nome',
    'cert_validade',
    'has_credenciais',
    'status_geral',
];
function parseListarParams(query) {
    const contabilidadeId = query.contabilidade_id
        ? parseInt(query.contabilidade_id, 10)
        : undefined;
    const hasCert = query.has_cert === 'true' ? true : query.has_cert === 'false' ? false : undefined;
    const hasCred = query.has_cred === 'true' ? true : query.has_cred === 'false' ? false : undefined;
    const semCert = query.sem_cert === 'true';
    const semCred = query.sem_cred === 'true';
    const semMetodo = query.sem_metodo === 'true';
    const page = query.page ? parseInt(query.page, 10) : 1;
    const limit = query.limit ? parseInt(query.limit, 10) : 20;
    const sortRaw = query.sort?.trim()?.toLowerCase();
    const sort = sortRaw && SORT_WHITELIST.includes(sortRaw)
        ? sortRaw
        : undefined;
    const orderRaw = (query.order ?? '').toLowerCase();
    const order = orderRaw === 'asc' || orderRaw === 'desc' ? orderRaw : 'asc';
    return {
        search: query.search?.trim() || undefined,
        contabilidade_id: !isNaN(contabilidadeId) && contabilidadeId > 0 ? contabilidadeId : undefined,
        has_cert: hasCert,
        has_cred: hasCred,
        sem_cert: semCert,
        sem_cred: semCred,
        sem_metodo: semMetodo,
        page: isNaN(page) ? 1 : page,
        limit: isNaN(limit) ? 20 : limit,
        sort,
        order,
    };
}
function validarFiltrosConflitantes(params) {
    if (params.has_cert === true && params.sem_cert) {
        return 'Não é possível filtrar por "com certificado" e "sem certificado" ao mesmo tempo';
    }
    if (params.has_cred === true && params.sem_cred) {
        return 'Não é possível filtrar por "com credenciais" e "sem credenciais" ao mesmo tempo';
    }
    if (params.has_cert === false && params.sem_cert)
        return null;
    if (params.has_cred === false && params.sem_cred)
        return null;
    return null;
}
async function listarEmpresas(params) {
    return repo.listarComAgregados(params);
}
async function obterEmpresaPorId(id) {
    return repo.obterPorIdComDetalhes(id);
}
async function obterSummary(params) {
    return repo.obterSummary(params);
}
//# sourceMappingURL=empresas.service.js.map