/**
 * Repositório de empresas.
 */
import { prisma } from '../db/client';
import type { Empresa } from '@prisma/client';

function limparCnpj(cnpj: string): string {
  return cnpj.replace(/[.\/\-]/g, '').trim();
}

export async function listarEmpresas(
  skip = 0,
  limit = 100
): Promise<Empresa[]> {
  return prisma.empresa.findMany({
    orderBy: { razaoSocial: 'asc' },
    skip,
    take: limit,
  });
}

export async function listarEmpresasPorContabilidade(
  contabilidadeId: number,
  skip = 0,
  limit = 100
): Promise<Empresa[]> {
  return prisma.empresa.findMany({
    where: { contabilidadeId },
    orderBy: { razaoSocial: 'asc' },
    skip,
    take: limit,
  });
}

export async function obterEmpresaPorId(
  empresaId: number
): Promise<Empresa | null> {
  return prisma.empresa.findUnique({
    where: { id: empresaId },
  });
}

export async function obterEmpresaPorCnpj(cnpj: string): Promise<Empresa | null> {
  const cnpjLimpo = limparCnpj(cnpj);
  return prisma.empresa.findUnique({
    where: { cnpj: cnpjLimpo },
  });
}

export async function criarEmpresa(data: {
  cnpj: string;
  razaoSocial: string;
  regime?: string;
  contabilidadeId?: number;
}): Promise<Empresa> {
  const cnpjLimpo = limparCnpj(data.cnpj);
  return prisma.empresa.create({
    data: {
      cnpj: cnpjLimpo,
      razaoSocial: data.razaoSocial,
      regime: data.regime,
      contabilidadeId: data.contabilidadeId,
    },
  });
}

export async function atualizarEmpresa(
  empresaId: number,
  data: Partial<
    Pick<Empresa, 'razaoSocial' | 'regime' | 'contabilidadeId'>
  >
): Promise<Empresa | null> {
  try {
    return await prisma.empresa.update({
      where: { id: empresaId },
      data,
    });
  } catch {
    return null;
  }
}

export async function deletarEmpresa(empresaId: number): Promise<boolean> {
  try {
    await prisma.empresa.delete({
      where: { id: empresaId },
    });
    return true;
  } catch {
    return false;
  }
}

export async function verificarCnpjTemCertificado(cnpj: string): Promise<boolean> {
  const cnpjLimpo = limparCnpj(cnpj);
  const count = await prisma.certificado.count({
    where: { cnpj: cnpjLimpo },
  });
  return count > 0;
}
