/**
 * Persistência de logs de execução NFSe via Prisma.
 * Tabelas: execucao_log_batch + execucao_log_item.
 *
 * Estratégia: insert header -> insert items.
 * Se items falhar, deletamos o header (rollback lógico), preservando o comportamento anterior.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../db/client';
import { getLogger } from '../infrastructure/logger';

const logger = getLogger('logs-execucao');

export interface LogItemPayload {
  empresa_id: string;
  cnpj: string;
  nome_empresa: string;
  tipo_autenticacao?: 'certificado' | 'credenciais';
  status_final: 'finalizado' | 'falhou';
  qtd_emitidas: number;
  qtd_recebidas: number;
  resultado_final?: string;
  started_at?: string;
  finished_at?: string;
  erro_msg?: string;
}

export interface PayloadSalvarLog {
  batch_id: string;
  contabilidade_id: string;
  competencia: string;
  dataInicio: string | null;
  dataFim: string | null;
  tipo: 'ambas' | 'emitidas' | 'recebidas';
  headless: boolean;
  totais: {
    total_empresas: number;
    total_sucesso: number;
    total_falha: number;
    total_emitidas: number;
    total_recebidas: number;
    totais_por_resultado: Record<string, number>;
  };
  itens: LogItemPayload[];
}

export interface ValidacaoResult {
  valid: boolean;
  error?: string;
  payload?: PayloadSalvarLog;
}

export function validarPayloadSalvarLog(body: unknown): ValidacaoResult {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Payload inválido' };
  }

  const b = body as Record<string, unknown>;

  if (!b.batch_id || typeof b.batch_id !== 'string' || !b.batch_id.trim()) {
    return { valid: false, error: 'batch_id é obrigatório' };
  }

  if (!b.contabilidade_id || (typeof b.contabilidade_id !== 'string' && typeof b.contabilidade_id !== 'number')) {
    return { valid: false, error: 'contabilidade_id é obrigatório' };
  }

  if (!b.competencia || typeof b.competencia !== 'string' || !b.competencia.trim()) {
    return { valid: false, error: 'competencia é obrigatória (formato YYYY-MM)' };
  }

  const competenciaMatch = /^\d{4}-\d{2}$/.exec(String(b.competencia));
  if (!competenciaMatch) {
    return { valid: false, error: 'competencia deve estar no formato YYYY-MM' };
  }

  if (!Array.isArray(b.itens)) {
    return { valid: false, error: 'itens é obrigatório e deve ser um array' };
  }

  const totais = b.totais as Record<string, unknown> | undefined;
  if (!totais || typeof totais !== 'object') {
    return { valid: false, error: 'totais é obrigatório' };
  }

  const payload: PayloadSalvarLog = {
    batch_id: String(b.batch_id).trim(),
    contabilidade_id: String(b.contabilidade_id),
    competencia: String(b.competencia).trim(),
    dataInicio: b.dataInicio != null ? String(b.dataInicio) : null,
    dataFim: b.dataFim != null ? String(b.dataFim) : null,
    tipo: ['ambas', 'emitidas', 'recebidas'].includes(String(b.tipo)) ? (b.tipo as PayloadSalvarLog['tipo']) : 'ambas',
    headless: Boolean(b.headless),
    totais: {
      total_empresas: sanitizarInt(totais.total_empresas, 0),
      total_sucesso: sanitizarInt(totais.total_sucesso, 0),
      total_falha: sanitizarInt(totais.total_falha, 0),
      total_emitidas: sanitizarInt(totais.total_emitidas, 0),
      total_recebidas: sanitizarInt(totais.total_recebidas, 0),
      totais_por_resultado: (typeof totais.totais_por_resultado === 'object' && totais.totais_por_resultado !== null)
        ? totais.totais_por_resultado as Record<string, number>
        : {},
    },
    itens: (b.itens as unknown[]).map((it: unknown) => sanitizarItem(it)),
  };

  return { valid: true, payload };
}

function sanitizarInt(v: unknown, defaultVal: number): number {
  if (typeof v === 'number' && !isNaN(v)) return Math.floor(v);
  if (typeof v === 'string') {
    const n = parseInt(v, 10);
    return isNaN(n) ? defaultVal : n;
  }
  return defaultVal;
}

function sanitizarItem(it: unknown): LogItemPayload {
  const item = (it && typeof it === 'object' ? it : {}) as Record<string, unknown>;
  return {
    empresa_id: String(item.empresa_id ?? '').trim() || '0',
    cnpj: String(item.cnpj ?? '').trim() || '',
    nome_empresa: String(item.nome_empresa ?? '').trim() || '',
    tipo_autenticacao: ['certificado', 'credenciais'].includes(String(item.tipo_autenticacao))
      ? (item.tipo_autenticacao as 'certificado' | 'credenciais')
      : undefined,
    status_final: ['finalizado', 'falhou'].includes(String(item.status_final))
      ? (item.status_final as 'finalizado' | 'falhou')
      : 'falhou',
    qtd_emitidas: sanitizarInt(item.qtd_emitidas, 0),
    qtd_recebidas: sanitizarInt(item.qtd_recebidas, 0),
    resultado_final: item.resultado_final != null ? String(item.resultado_final) : undefined,
    started_at: item.started_at != null ? String(item.started_at) : undefined,
    finished_at: item.finished_at != null ? String(item.finished_at) : undefined,
    erro_msg: item.erro_msg != null ? String(item.erro_msg) : undefined,
  };
}

function parseOptionalDate(value?: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function salvarLogExecucoesService(payload: PayloadSalvarLog): Promise<{
  batchLogId?: number;
  conflict?: boolean;
}> {
  // 1. Verificar duplicidade
  const existing = await prisma.execucaoLogBatch.findUnique({
    where: { batchId: payload.batch_id },
    select: { id: true },
  });

  if (existing) {
    return { conflict: true };
  }

  // 2. Insert header (execucao_log_batch)
  const contabilidadeId = payload.contabilidade_id
    ? parseInt(String(payload.contabilidade_id).replace(/\D/g, '') || '0', 10)
    : null;

  let batchLogId: number;
  try {
    const header = await prisma.execucaoLogBatch.create({
      data: {
        batchId: payload.batch_id,
        contabilidadeId: contabilidadeId && contabilidadeId > 0 ? contabilidadeId : null,
        competencia: payload.competencia,
        dataInicio: payload.dataInicio || null,
        dataFim: payload.dataFim || null,
        tipo: payload.tipo,
        headless: payload.headless,
        totalEmpresas: payload.totais.total_empresas,
        totalSucesso: payload.totais.total_sucesso,
        totalFalha: payload.totais.total_falha,
        totalEmitidas: payload.totais.total_emitidas,
        totalRecebidas: payload.totais.total_recebidas,
        totaisPorResultado:
          Object.keys(payload.totais.totais_por_resultado || {}).length > 0
            ? payload.totais.totais_por_resultado
            : Prisma.DbNull,
      },
      select: { id: true },
    });
    batchLogId = header.id;
  } catch (errHeader) {
    logger.error({ err: errHeader }, 'Erro ao inserir execucao_log_batch');
    throw errHeader;
  }

  // 3. Insert items (execucao_log_item)
  if (payload.itens.length > 0) {
    try {
      await prisma.execucaoLogItem.createMany({
        data: payload.itens.map((it) => ({
          batchLogId,
          empresaId: it.empresa_id,
          cnpj: it.cnpj,
          nomeEmpresa: it.nome_empresa,
          tipoAutenticacao: it.tipo_autenticacao || null,
          statusFinal: it.status_final,
          qtdEmitidas: it.qtd_emitidas,
          qtdRecebidas: it.qtd_recebidas,
          resultadoFinal: it.resultado_final || null,
          startedAt: parseOptionalDate(it.started_at),
          finishedAt: parseOptionalDate(it.finished_at),
          erroMsg: it.erro_msg || null,
        })),
      });
    } catch (errItems) {
      logger.error({ err: errItems }, 'Erro ao inserir execucao_log_item - rollback lógico');
      await prisma.execucaoLogBatch.delete({ where: { id: batchLogId } });
      throw errItems;
    }
  }

  return { batchLogId };
}
