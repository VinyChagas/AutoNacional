/**
 * Serviço de validação em lote de certificados e credenciais.
 * Jobs em memória com progresso e suporte a cancelamento.
 */
import { prisma } from '../db/client';
import { getLogger } from '../infrastructure/logger';
import * as empresasRepo from '../modules/certificados/empresas/empresas.repo';
import * as credenciaisRepo from '../repositories/credenciais';
import type { EmpresaListagemParams } from '../modules/certificados/empresas/empresas.repo';

const logger = getLogger('validacoes-service');

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

export type JobStatus = 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELED';

export interface ValidationJob {
  id: string;
  status: JobStatus;
  progress: number;
  total: number;
  ok: number;
  errors: number;
  processed: number;
}

const jobs = new Map<string, ValidationJob>();

export interface StartPayload {
  targets: ('CERTIFICADO' | 'CREDENCIAL')[];
  scope: {
    mode: 'SELECTED' | 'FILTERED' | 'ALL';
    empresa_ids?: number[];
  };
  filters?: Record<string, unknown>;
  options?: {
    concurrency?: number;
    timeoutSeconds?: number;
    stopOnConsecutiveErrors?: number;
  };
}

export async function iniciarValidacao(payload: StartPayload): Promise<string> {
  const jobId = `val_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const empresaIds = await resolverEscopo(payload);
  const total = empresaIds.length;

  const job: ValidationJob = {
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
    } catch (err) {
      logger.error({ err, jobId }, 'Erro na validação');
      const j = jobs.get(jobId);
      if (j && j.status === 'RUNNING') {
        j.status = 'FAILED';
      }
    }
  });

  return jobId;
}

async function resolverEscopo(payload: StartPayload): Promise<number[]> {
  if (payload.scope.mode === 'SELECTED' && payload.scope.empresa_ids?.length) {
    return payload.scope.empresa_ids;
  }

  const filters = payload.filters ?? {};
  const sortVal = filters.sort;
  const sortWhitelist = ['cnpj', 'razao_social', 'contabilidade_nome', 'cert_validade', 'has_credenciais', 'status_geral'] as const;
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

async function executarValidacao(
  jobId: string,
  empresaIds: number[],
  targets: ('CERTIFICADO' | 'CREDENCIAL')[],
  options: { concurrency: number; timeoutSeconds: number; stopOnConsecutiveErrors: number }
): Promise<void> {
  const job = jobs.get(jobId);
  if (!job || job.status !== 'RUNNING') return;

  let consecErrors = 0;
  const total = empresaIds.length;
  job.total = total;

  for (let i = 0; i < total; i++) {
    const j = jobs.get(jobId);
    if (!j || j.status !== 'RUNNING') break;
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
        } else {
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
        } else {
          const senha = credenciaisRepo.descriptografarSenha(credFull);
          const resultado = await validarCredencialLogin(cnpj, senha, options.timeoutSeconds);
          if (resultado) {
            await credenciaisRepo.atualizarStatus(cred.id, 'OK');
            job.ok++;
          } else {
            await credenciaisRepo.atualizarStatus(cred.id, 'INVALIDA');
            job.errors++;
            consecErrors++;
            erroNeste = true;
          }
        }
      }

      if (!erroNeste) consecErrors = 0;
    } catch (err) {
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
async function validarCredencialLogin(
  cnpj: string,
  senha: string,
  _timeoutSeconds: number
): Promise<boolean> {
  if (!cnpj || !senha) return false;
  try {
    const { validarCredencialNfse } = await import('../automation/validar-credencial-nfse');
    return await validarCredencialNfse(cnpj, senha, _timeoutSeconds);
  } catch (err) {
    logger.debug({ err, cnpj }, 'Validar credencial NFSe indisponível - usando stub');
    return false;
  }
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
