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
exports.registrarClienteSSE = registrarClienteSSE;
exports.iniciarValidacao = iniciarValidacao;
exports.obterJob = obterJob;
exports.cancelarJob = cancelarJob;
exports.iniciarValidacaoLegacy = iniciarValidacaoLegacy;
const logger_1 = require("../infrastructure/logger");
const empresasRepo = __importStar(require("../modules/certificados/empresas/empresas.repo"));
const credenciaisRepo = __importStar(require("../repositories/credenciais"));
const validar_credencial_nfse_1 = require("../automation/validar-credencial-nfse");
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
const PING_INTERVAL_MS = 15000;
function emitEvent(res, event, data) {
    try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }
    catch {
        /* client disconnected */
    }
}
function registrarClienteSSE(jobId, res) {
    let job = jobs.get(jobId);
    if (!job) {
        job = {
            id: jobId,
            status: 'PENDING',
            progress: 0,
            total: 0,
            ok: 0,
            invalidas: 0,
            erros: 0,
            processed: 0,
            items: [],
            clients: new Set(),
            isRunning: false,
        };
        jobs.set(jobId, job);
    }
    job.clients.add(res);
    res.on('close', () => {
        job?.clients.delete(res);
    });
    const pingInterval = setInterval(() => {
        if (res.writableEnded) {
            clearInterval(pingInterval);
            return;
        }
        try {
            res.write(`: ping\n\n`);
        }
        catch {
            clearInterval(pingInterval);
        }
    }, PING_INTERVAL_MS);
    res.on('close', () => clearInterval(pingInterval));
    if (job.items.length > 0) {
        for (const item of job.items) {
            emitEvent(res, 'progress', item);
        }
    }
    if (job.status === 'DONE' || job.status === 'FAILED') {
        emitEvent(res, 'done', {
            job_id: jobId,
            totals: { ok: job.ok, invalidas: job.invalidas, erros: job.erros },
        });
        res.end();
    }
}
function broadcastProgress(jobId, item) {
    const job = jobs.get(jobId);
    if (!job)
        return;
    job.items.push(item);
    for (const res of job.clients) {
        if (!res.writableEnded) {
            emitEvent(res, 'progress', item);
        }
    }
}
function broadcastDone(jobId) {
    const job = jobs.get(jobId);
    if (!job)
        return;
    const payload = {
        job_id: jobId,
        totals: { ok: job.ok, invalidas: job.invalidas, erros: job.erros },
    };
    for (const res of job.clients) {
        if (!res.writableEnded) {
            emitEvent(res, 'done', payload);
            res.end();
        }
    }
    job.clients.clear();
}
async function iniciarValidacao(payload) {
    const jobId = `val_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const empresaIds = payload.empresa_ids ?? [];
    const total = empresaIds.length;
    if (total === 0) {
        throw new Error('Nenhuma empresa para validar');
    }
    const job = {
        id: jobId,
        status: 'PENDING',
        progress: 0,
        total,
        ok: 0,
        invalidas: 0,
        erros: 0,
        processed: 0,
        items: [],
        clients: new Set(),
        isRunning: false,
    };
    jobs.set(jobId, job);
    const validarCert = Boolean(payload.validar_certificados);
    const validarCred = Boolean(payload.validar_credenciais);
    const headless = payload.headless !== false;
    setImmediate(async () => {
        const j = jobs.get(jobId);
        if (!j)
            return;
        j.status = 'RUNNING';
        j.isRunning = true;
        try {
            await executarValidacao(jobId, empresaIds, { validarCert, validarCred, headless });
        }
        catch (err) {
            logger.error({ err, jobId }, 'Erro na validação');
            const j2 = jobs.get(jobId);
            if (j2?.status === 'RUNNING') {
                j2.status = 'FAILED';
            }
        }
        finally {
            const j2 = jobs.get(jobId);
            if (j2) {
                j2.isRunning = false;
                if (j2.status === 'RUNNING')
                    j2.status = 'DONE';
            }
            broadcastDone(jobId);
        }
    });
    return jobId;
}
async function executarValidacao(jobId, empresaIds, opts) {
    const job = jobs.get(jobId);
    if (!job || job.status !== 'RUNNING')
        return;
    const total = empresaIds.length;
    job.total = total;
    for (let i = 0; i < total; i++) {
        const j = jobs.get(jobId);
        if (!j || j.status !== 'RUNNING')
            break;
        const empresaId = empresaIds[i];
        try {
            const detalhes = await empresasRepo.obterPorIdComDetalhes(empresaId);
            if (!detalhes) {
                broadcastProgress(jobId, {
                    empresa_id: empresaId,
                    step: 'cert',
                    status: 'ERRO',
                    message: 'Empresa não encontrada',
                    updated_at: new Date().toISOString(),
                });
                job.processed++;
                job.erros++;
                continue;
            }
            const cnpj = normCnpj(detalhes.empresa.cnpj);
            const razaoSocial = detalhes.empresa.razao_social;
            if (opts.validarCert && detalhes.certificados_digitais?.length) {
                const cert = detalhes.certificados_digitais[0];
                const dt = parseDataValidade(cert.data_validade);
                const hoje = new Date();
                hoje.setHours(0, 0, 0, 0);
                const certStatus = !dt ? 'ERRO_CERT' : dt < hoje ? 'VENCIDO' : dt <= addDays(hoje, 30) ? 'VENCENDO' : 'VALIDO';
                const ok = dt && dt >= hoje;
                if (ok)
                    job.ok++;
                else
                    job.erros++;
                broadcastProgress(jobId, {
                    empresa_id: empresaId,
                    cnpj,
                    razao_social: razaoSocial,
                    step: 'cert',
                    status: ok ? 'OK' : 'VENCIDO',
                    message: ok ? 'Certificado válido' : 'Certificado vencido',
                    updated_at: new Date().toISOString(),
                    cert_status: certStatus,
                });
            }
            if (opts.validarCred) {
                if (!detalhes.credenciais?.length) {
                    broadcastProgress(jobId, {
                        empresa_id: empresaId,
                        cnpj,
                        razao_social: razaoSocial,
                        step: 'cred',
                        status: 'ERRO_VALIDACAO',
                        message: 'Empresa sem credenciais cadastradas',
                        updated_at: new Date().toISOString(),
                    });
                }
                else {
                    const cred = detalhes.credenciais[0];
                    const credFull = await credenciaisRepo.obterPorId(cred.id);
                    broadcastProgress(jobId, {
                        empresa_id: empresaId,
                        cnpj,
                        razao_social: razaoSocial,
                        step: 'cred',
                        status: 'TESTANDO',
                        message: 'Validando...',
                        updated_at: new Date().toISOString(),
                    });
                    if (!credFull) {
                        logger.warn({ empresaId }, 'Credencial não encontrada para empresa');
                        broadcastProgress(jobId, {
                            empresa_id: empresaId,
                            cnpj,
                            razao_social: razaoSocial,
                            step: 'cred',
                            status: 'ERRO_VALIDACAO',
                            message: 'Credencial não encontrada',
                            updated_at: new Date().toISOString(),
                        });
                        job.erros++;
                    }
                    else {
                        const senha = credenciaisRepo.descriptografarSenha(credFull);
                        const documentoLogin = (cred.usuario || credFull.usuario || cnpj).replace(/\D/g, '');
                        logger.info({ empresaId, docLen: documentoLogin.length, headless: opts.headless }, 'Iniciando validação Playwright');
                        const resultado = await (0, validar_credencial_nfse_1.validarCredencialNfse)(documentoLogin, senha, {
                            timeoutSeconds: 60,
                            headless: opts.headless,
                        });
                        logger.info({ empresaId, status: resultado.status }, 'Validação Playwright concluída');
                        await credenciaisRepo.atualizarStatus(cred.id, resultado.status, resultado.message);
                        if (resultado.ok) {
                            job.ok++;
                        }
                        else if (resultado.status === 'INVALIDA') {
                            job.invalidas++;
                        }
                        else {
                            job.erros++;
                        }
                        broadcastProgress(jobId, {
                            empresa_id: empresaId,
                            cnpj,
                            razao_social: razaoSocial,
                            step: 'cred',
                            status: resultado.status,
                            message: resultado.message,
                            updated_at: new Date().toISOString(),
                            cred_status: resultado.status,
                        });
                    }
                }
            }
        }
        catch (err) {
            logger.warn({ err, empresaId, jobId }, 'Erro ao validar empresa');
            broadcastProgress(jobId, {
                empresa_id: empresaId,
                step: 'cred',
                status: 'ERRO_VALIDACAO',
                message: err instanceof Error ? err.message : 'Erro inesperado',
                updated_at: new Date().toISOString(),
            });
            job.erros++;
        }
        job.processed++;
        job.progress = Math.round((job.processed / total) * 100);
    }
    const j = jobs.get(jobId);
    if (j?.status === 'RUNNING') {
        j.status = 'DONE';
    }
}
function addDays(d, days) {
    const r = new Date(d);
    r.setDate(r.getDate() + days);
    return r;
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
async function iniciarValidacaoLegacy(payload) {
    const empresaIds = await resolverEscopoLegacy(payload);
    return iniciarValidacao({
        empresa_ids: empresaIds,
        validar_certificados: payload.targets.includes('CERTIFICADO'),
        validar_credenciais: payload.targets.includes('CREDENCIAL'),
        headless: true,
    });
}
async function resolverEscopoLegacy(payload) {
    if (payload.scope.mode === 'SELECTED' && payload.scope.empresa_ids?.length) {
        return payload.scope.empresa_ids;
    }
    const filters = payload.filters ?? {};
    const sortWhitelist = ['cnpj', 'razao_social', 'contabilidade_nome', 'cert_validade', 'has_credenciais', 'status_geral'];
    const sortVal = filters.sort;
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
//# sourceMappingURL=validacoes-service.js.map