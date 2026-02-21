/**
 * Serviço de validação em lote de certificados e credenciais.
 * Suporta SSE para atualizações em tempo real.
 */
import { Response } from 'express';
import PQueue from 'p-queue';
import { getLogger } from '../infrastructure/logger';
import * as empresasRepo from '../modules/certificados/empresas/empresas.repo';
import * as credenciaisRepo from '../repositories/credenciais';
import * as settingsRepo from '../repositories/settings';
import { validarCredencialNfse } from '../automation/validar-credencial-nfse';
import type { EmpresaListagemParams } from '../modules/certificados/empresas/empresas.repo';

const logger = getLogger('validacoes-service');

async function obterLimiteConcorrencia(): Promise<number> {
  const config = await settingsRepo.obterConfiguracoes();
  if (config) {
    let limite = config.defaultConcurrentBrowsers ?? 3;
    if (config.maxConcurrentBrowsers && limite > config.maxConcurrentBrowsers) {
      limite = config.maxConcurrentBrowsers;
    }
    return limite;
  }
  return 3;
}

function normCnpj(cnpj: string): string {
  return cnpj.replace(/[.\/\-\s]/g, '').trim();
}

function parseDataValidade(val: string | null): Date | null {
  if (!val?.trim()) return null;
  const m = val.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const d = new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

export type JobStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELED';

export interface ValidationProgressItem {
  empresa_id: number;
  cnpj?: string;
  razao_social?: string;
  step: 'cert' | 'cred';
  status: string;
  message?: string;
  updated_at?: string;
  cred_status?: string;
  cert_status?: string;
  status_geral?: string;
}

export interface ValidationJob {
  id: string;
  status: JobStatus;
  progress: number;
  total: number;
  ok: number;
  invalidas: number;
  erros: number;
  processed: number;
  items: ValidationProgressItem[];
  clients: Set<Response>;
  isRunning: boolean;
}

export interface IniciarPayload {
  empresa_ids: number[];
  validar_certificados: boolean;
  validar_credenciais: boolean;
  headless?: boolean;
}

const jobs = new Map<string, ValidationJob>();

const PING_INTERVAL_MS = 15000;

function emitEvent(res: Response, event: string, data: object): void {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    /* client disconnected */
  }
}

export function registrarClienteSSE(jobId: string, res: Response): void {
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
    } catch {
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

function broadcastProgress(jobId: string, item: ValidationProgressItem): void {
  const job = jobs.get(jobId);
  if (!job) return;
  job.items.push(item);
  for (const res of job.clients) {
    if (!res.writableEnded) {
      emitEvent(res, 'progress', item);
    }
  }
}

function broadcastDone(jobId: string): void {
  const job = jobs.get(jobId);
  if (!job) return;
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

export async function iniciarValidacao(payload: IniciarPayload): Promise<string> {
  const jobId = `val_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const empresaIds = payload.empresa_ids ?? [];
  const total = empresaIds.length;

  if (total === 0) {
    throw new Error('Nenhuma empresa para validar');
  }

  const job: ValidationJob = {
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
    if (!j) return;
    j.status = 'RUNNING';
    j.isRunning = true;

    try {
      await executarValidacao(jobId, empresaIds, { validarCert, validarCred, headless });
    } catch (err) {
      logger.error({ err, jobId }, 'Erro na validação');
      const j2 = jobs.get(jobId);
      if (j2?.status === 'RUNNING') {
        j2.status = 'FAILED';
      }
    } finally {
      const j2 = jobs.get(jobId);
      if (j2) {
        j2.isRunning = false;
        if (j2.status === 'RUNNING') j2.status = 'DONE';
      }
      broadcastDone(jobId);
    }
  });

  return jobId;
}

async function executarValidacao(
  jobId: string,
  empresaIds: number[],
  opts: { validarCert: boolean; validarCred: boolean; headless: boolean }
): Promise<void> {
  const job = jobs.get(jobId);
  if (!job || job.status !== 'RUNNING') return;

  const total = empresaIds.length;
  job.total = total;

  const concurrency = await obterLimiteConcorrencia();
  const queue = new PQueue({ concurrency });

  const processarEmpresa = async (empresaId: number): Promise<void> => {
    const j = jobs.get(jobId);
    if (!j || j.status !== 'RUNNING') return;

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
        job.progress = Math.round((job.processed / total) * 100);
        return;
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
        if (ok) job.ok++;
        else job.erros++;

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
        } else {
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
        } else {
          const senha = credenciaisRepo.descriptografarSenha(credFull);
          const documentoLogin = (cred.usuario || credFull.usuario || cnpj).replace(/\D/g, '');
          logger.info({ empresaId, docLen: documentoLogin.length, headless: opts.headless }, 'Iniciando validação Playwright');
          const resultado = await validarCredencialNfse(documentoLogin, senha, {
            timeoutSeconds: 60,
            headless: opts.headless,
          });
          logger.info({ empresaId, status: resultado.status }, 'Validação Playwright concluída');

          await credenciaisRepo.atualizarStatus(
            cred.id,
            resultado.status,
            resultado.message
          );

          if (resultado.ok) {
            job.ok++;
          } else if (resultado.status === 'INVALIDA') {
            job.invalidas++;
          } else {
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
    } catch (err) {
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
  };

  for (const empresaId of empresaIds) {
    queue.add(() => processarEmpresa(empresaId));
  }
  await queue.onIdle();

  const j = jobs.get(jobId);
  if (j?.status === 'RUNNING') {
    j.status = 'DONE';
  }
}

function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

export function obterJob(jobId: string): ValidationJob | undefined {
  return jobs.get(jobId);
}

export function cancelarJob(jobId: string): boolean {
  const job = jobs.get(jobId);
  if (!job || job.status !== 'RUNNING') return false;
  job.status = 'CANCELED';
  return true;
}

// Compatibilidade com API antiga (payload diferente)
export interface StartPayloadLegacy {
  targets: ('CERTIFICADO' | 'CREDENCIAL')[];
  scope: { mode: 'SELECTED' | 'FILTERED' | 'ALL'; empresa_ids?: number[] };
  filters?: Record<string, unknown>;
}

export async function iniciarValidacaoLegacy(payload: StartPayloadLegacy): Promise<string> {
  const empresaIds = await resolverEscopoLegacy(payload);
  return iniciarValidacao({
    empresa_ids: empresaIds,
    validar_certificados: payload.targets.includes('CERTIFICADO'),
    validar_credenciais: payload.targets.includes('CREDENCIAL'),
    headless: true,
  });
}

async function resolverEscopoLegacy(payload: StartPayloadLegacy): Promise<number[]> {
  if (payload.scope.mode === 'SELECTED' && payload.scope.empresa_ids?.length) {
    return payload.scope.empresa_ids;
  }
  const filters = payload.filters ?? {};
  const sortWhitelist = ['cnpj', 'razao_social', 'contabilidade_nome', 'cert_validade', 'has_credenciais', 'status_geral'] as const;
  const sortVal = filters.sort;
  const sort = typeof sortVal === 'string' && sortWhitelist.includes(sortVal as (typeof sortWhitelist)[number])
    ? (sortVal as EmpresaListagemParams['sort'])
    : undefined;

  const params: EmpresaListagemParams = {
    search: filters.search as string | undefined,
    contabilidade_id: filters.contabilidade_id as number | undefined,
    has_cert: filters.has_cert as boolean | undefined,
    has_cred: filters.has_cred as boolean | undefined,
    sem_cert: filters.sem_cert as boolean | undefined,
    sem_cred: filters.sem_cred as boolean | undefined,
    sem_metodo: filters.sem_metodo as boolean | undefined,
    page: 1,
    limit: 5000,
    sort,
    order: (filters.order as 'asc' | 'desc') ?? 'asc',
  };

  const result = await empresasRepo.listarComAgregados(params);
  return result.items.map((i) => i.id);
}
