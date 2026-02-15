/**
 * Repositório de contabilidades.
 */
import { prisma } from '../db/client';
import type { Contabilidade } from '@prisma/client';

function limparCnpj(cnpj: string): string {
  return cnpj.replace(/[.\/\-\s]/g, '').trim();
}

export async function listarContabilidades(
  skip = 0,
  limit = 100
): Promise<Contabilidade[]> {
  return prisma.contabilidade.findMany({
    orderBy: { nomeContabilidade: 'asc' },
    skip,
    take: limit,
  });
}

export async function obterPorId(id: number): Promise<Contabilidade | null> {
  return prisma.contabilidade.findUnique({
    where: { id },
  });
}

export async function obterPorCnpj(cnpj: string): Promise<Contabilidade | null> {
  const cnpjLimpo = limparCnpj(cnpj);
  return prisma.contabilidade.findUnique({
    where: { cnpj: cnpjLimpo },
  });
}

export async function criar(data: {
  nomeContabilidade: string;
  cnpj: string;
  email?: string;
  telefone?: string;
  responsavel?: string;
}): Promise<Contabilidade> {
  const cnpjLimpo = limparCnpj(data.cnpj);
  return prisma.contabilidade.create({
    data: {
      nomeContabilidade: data.nomeContabilidade,
      cnpj: cnpjLimpo,
      email: data.email,
      telefone: data.telefone,
      responsavel: data.responsavel,
    },
  });
}

export async function atualizar(
  id: number,
  data: Partial<{
    nomeContabilidade: string;
    email: string;
    telefone: string;
    responsavel: string;
  }>
): Promise<Contabilidade | null> {
  try {
    return await prisma.contabilidade.update({
      where: { id },
      data,
    });
  } catch {
    return null;
  }
}

export async function deletar(id: number): Promise<boolean> {
  try {
    await prisma.contabilidade.delete({ where: { id } });
    return true;
  } catch {
    return false;
  }
}

/**
 * Conta certificados vinculados a uma contabilidade.
 */
export async function contarCertificados(contabilidadeId: number): Promise<number> {
  return prisma.certificado.count({
    where: { contabilidadeId },
  });
}

/**
 * Conta empresas vinculadas a uma contabilidade.
 */
export async function contarEmpresas(contabilidadeId: number): Promise<number> {
  return prisma.empresa.count({
    where: { contabilidadeId },
  });
}

/**
 * Total de empresas vinculadas (certificados + empresas) para uma contabilidade.
 */
export async function obterTotalVinculados(
  contabilidadeId: number
): Promise<number> {
  const [certs, empresas] = await Promise.all([
    contarCertificados(contabilidadeId),
    contarEmpresas(contabilidadeId),
  ]);
  return certs + empresas;
}

/**
 * Total de vinculados para múltiplas contabilidades (em batch).
 */
export async function obterTotalVinculadosPorIds(
  contabilidadeIds: number[]
): Promise<Record<number, number>> {
  if (contabilidadeIds.length === 0) return {};

  const [certCounts, empCounts] = await Promise.all([
    prisma.certificado.groupBy({
      by: ['contabilidadeId'],
      where: { contabilidadeId: { in: contabilidadeIds } },
      _count: { id: true },
    }),
    prisma.empresa.groupBy({
      by: ['contabilidadeId'],
      where: { contabilidadeId: { in: contabilidadeIds } },
      _count: { id: true },
    }),
  ]);

  const result: Record<number, number> = {};
  const allIds = new Set<number>();

  for (const row of certCounts) {
    if (row.contabilidadeId != null) {
      allIds.add(row.contabilidadeId);
      result[row.contabilidadeId] = (result[row.contabilidadeId] ?? 0) + row._count.id;
    }
  }
  for (const row of empCounts) {
    if (row.contabilidadeId != null) {
      allIds.add(row.contabilidadeId);
      result[row.contabilidadeId] =
        (result[row.contabilidadeId] ?? 0) + row._count.id;
    }
  }
  for (const id of allIds) {
    if (result[id] == null) result[id] = 0;
  }
  return result;
}
