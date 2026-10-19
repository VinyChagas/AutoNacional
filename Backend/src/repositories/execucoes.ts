/**
 * Repositório de execuções.
 */
import { prisma } from '../db/client';
import type { Execucao } from '@prisma/client';

export async function listarExecucoes(opts?: {
  skip?: number;
  limit?: number;
  status?: string;
  empresaId?: number;
}): Promise<Execucao[]> {
  const where: { status?: string; empresaId?: number } = {};
  if (opts?.status) where.status = opts.status;
  if (opts?.empresaId != null) where.empresaId = opts.empresaId;

  return prisma.execucao.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    skip: opts?.skip ?? 0,
    take: opts?.limit ?? 100,
  });
}

export async function obterPorId(id: number): Promise<Execucao | null> {
  return prisma.execucao.findUnique({
    where: { id },
  });
}

export async function obterUltimaPorEmpresa(empresaId: number): Promise<Execucao | null> {
  const list = await prisma.execucao.findMany({
    where: { empresaId },
    orderBy: { createdAt: 'desc' },
    take: 1,
  });
  return list[0] ?? null;
}

export async function criar(data: {
  empresaId: number;
  cnpj?: string;
  periodoInicio?: string;
  periodoFim?: string;
  tipo?: string;
}): Promise<Execucao> {
  return prisma.execucao.create({
    data: {
      empresaId: data.empresaId,
      cnpj: data.cnpj,
      periodoInicio: data.periodoInicio,
      periodoFim: data.periodoFim,
      tipo: data.tipo ?? 'ambas',
      status: 'pendente',
    },
  });
}

export async function atualizar(
  id: number,
  data: Partial<{
    status: string;
    etapaAtual: string;
    progresso: number;
    mensagem: string;
    dataInicio: Date;
    dataFim: Date;
    mensagemErro: string;
    qtdNotasEmitidas: number;
    qtdNotasRecebidas: number;
    resultadoFinal: string;
  }>
): Promise<Execucao | null> {
  try {
    return await prisma.execucao.update({
      where: { id },
      data,
    });
  } catch {
    return null;
  }
}
