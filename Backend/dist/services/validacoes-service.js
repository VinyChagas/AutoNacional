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
exports.iniciarValidacao = iniciarValidacao;
exports.obterJob = obterJob;
exports.cancelarJob = cancelarJob;
const logger_1 = require("../infrastructure/logger");
const empresasRepo = __importStar(require("../modules/certificados/empresas/empresas.repo"));
const credenciaisRepo = __importStar(require("../repositories/credenciais"));
const logger = (0, logger_1.getLogger)('validacoes-service');
function normCnpj(cnpj) {
    return cnpj.replace(/[.\/\-\s]/g, '').trim();
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
const jobs = new Map();
async function iniciarValidacao(payload) {
    const jobId = `val_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const empresaIds = await resolverEscopo(payload);
    const total = empresaIds.length;
    const job = {
        id: jobId,
        status: 'RUNNING',
        progress: 0,
        total,
        ok: 0,
        errors: 0,
        processed: 0,
    };
    jobs.set(jobId, job);
    const concurrency = payload.options?.concurrency ?? 2;
    const timeoutSeconds = payload.options?.timeoutSeconds ?? 60;
    const stopOnConsecutiveErrors = payload.options?.stopOnConsecutiveErrors ?? 5;
    setImmediate(async () => {
        try {
            await executarValidacao(jobId, empresaIds, payload.targets, {
                concurrency,
                timeoutSeconds,
                stopOnConsecutiveErrors,
            });
        }
        catch (err) {
            logger.error({ err, jobId }, 'Erro na validação');
            const j = jobs.get(jobId);
            if (j && j.status === 'RUNNING') {
                j.status = 'FAILED';
            }
        }
    });
    return jobId;
}
async function resolverEscopo(payload) {
    if (payload.scope.mode === 'SELECTED' && payload.scope.empresa_ids?.length) {
        return payload.scope.empresa_ids;
    }
    const filters = payload.filters ?? {};
    const sortVal = filters.sort;
    const sortWhitelist = ['cnpj', 'razao_social', 'contabilidade_nome', 'cert_validade', 'has_credenciais', 'status_geral'];
    const sort = typeof sortVal === 'string' && sortWhitelist.includes(sortVal)
        ? sortVal
        : undefined;
    const params = {
        search: filters.search,
        contabilidade_id: filters.contabilidade_id,
        has_cert: filters.has_cert,
        has_cred: filters.has_cred,
        sem_cert: filters.sem_cert,
        sem_cred: filters.sem_cred,
        sem_metodo: filters.sem_metodo,
        page: 1,
        limit: 5000,
        sort,
        order: filters.order ?? 'asc',
    };
    const result = await empresasRepo.listarComAgregados(params);
    return result.items.map((i) => i.id);
}
async function executarValidacao(jobId, empresaIds, targets, options) {
    const job = jobs.get(jobId);
    if (!job || job.status !== 'RUNNING')
        return;
    let consecErrors = 0;
    const total = empresaIds.length;
    job.total = total;
    for (let i = 0; i < total; i++) {
        const j = jobs.get(jobId);
        if (!j || j.status !== 'RUNNING')
            break;
        if (consecErrors >= options.stopOnConsecutiveErrors) {
            j.status = 'FAILED';
            logger.warn({ jobId, consecErrors }, 'Parando após erros consecutivos');
            break;
        }
        const empresaId = empresaIds[i];
        let erroNeste = false;
        try {
            const detalhes = await empresasRepo.obterPorIdComDetalhes(empresaId);
            if (!detalhes) {
                job.processed++;
                job.errors++;
                consecErrors++;
                erroNeste = true;
                continue;
            }
            const cnpj = normCnpj(detalhes.empresa.cnpj);
            if (targets.includes('CERTIFICADO') && detalhes.certificados_digitais?.length) {
                const cert = detalhes.certificados_digitais[0];
                const dt = parseDataValidade(cert.data_validade);
                const hoje = new Date();
                hoje.setHours(0, 0, 0, 0);
                if (dt && dt >= hoje) {
                    job.ok++;
                    consecErrors = 0;
                }
                else {
                    job.errors++;
                    consecErrors++;
                    erroNeste = true;
                }
            }
            if (targets.includes('CREDENCIAL') && detalhes.credenciais?.length) {
                const cred = detalhes.credenciais[0];
                const credFull = await credenciaisRepo.obterPorId(cred.id);
                if (!credFull) {
                    job.errors++;
                    consecErrors++;
                    erroNeste = true;
                }
                else {
                    const senha = credenciaisRepo.descriptografarSenha(credFull);
                    const resultado = await validarCredencialLogin(cnpj, senha, options.timeoutSeconds);
                    if (resultado) {
                        await credenciaisRepo.atualizarStatus(cred.id, 'OK');
                        job.ok++;
                    }
                    else {
                        await credenciaisRepo.atualizarStatus(cred.id, 'INVALIDA');
                        job.errors++;
                        consecErrors++;
                        erroNeste = true;
                    }
                }
            }
            if (!erroNeste)
                consecErrors = 0;
        }
        catch (err) {
            logger.warn({ err, empresaId, jobId }, 'Erro ao validar empresa');
            job.errors++;
            consecErrors++;
        }
        job.processed++;
        job.progress = Math.round((job.processed / total) * 100);
    }
    const j = jobs.get(jobId);
    if (j && j.status === 'RUNNING') {
        j.status = 'DONE';
    }
}
/**
 * Valida credencial via login no portal NFSe (CNPJ + senha).
 * Stub: por enquanto apenas verifica se há credencial; expansão futura com Playwright.
 */
async function validarCredencialLogin(cnpj, senha, _timeoutSeconds) {
    if (!cnpj || !senha)
        return false;
    try {
        const { validarCredencialNfse } = await Promise.resolve().then(() => __importStar(require('../automation/validar-credencial-nfse')));
        return await validarCredencialNfse(cnpj, senha, _timeoutSeconds);
    }
    catch (err) {
        logger.debug({ err, cnpj }, 'Validar credencial NFSe indisponível - usando stub');
        return false;
    }
}
function obterJob(jobId) {
    return jobs.get(jobId);
}
function cancelarJob(jobId) {
    const job = jobs.get(jobId);
    if (!job || job.status !== 'RUNNING')
        return false;
    job.status = 'CANCELED';
    return true;
}
//# sourceMappingURL=validacoes-service.js.map