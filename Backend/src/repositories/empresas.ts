/**
 * Repositório de empresas.
 */
import { prisma } from '../db/client';
import type { Empresa } from '@prisma/client';
import {
  documentosEquivalentes,
  limparDocumento,
  variantesDocumento,
} from '../utils/documento-certificado';
import { removerArquivosCertificado } from '../services/certificado-storage.service';
import { getLogger } from '../infrastructure/logger';

const logger = getLogger('empresas-repo');

function limparCnpj(cnpj: string): string {
  return limparDocumento(cnpj);
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

/** Empresa com relação contabilidade (para nome da pasta de downloads). */
export async function obterEmpresaComContabilidade(
  empresaId: number
): Promise<(Empresa & { contabilidade: { nomeContabilidade: string } | null }) | null> {
  return prisma.empresa.findUnique({
    where: { id: empresaId },
    include: { contabilidade: true },
  }) as Promise<(Empresa & { contabilidade: { nomeContabilidade: string } | null }) | null>;
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

/**
 * Exclui empresa + credenciais (cascade FK) + certificados (sem FK) + Storage.
 * Certificados são buscados por empresaId e por CNPJ equivalente (legado).
 */
export async function deletarEmpresa(empresaId: number): Promise<boolean> {
  const empresa = await prisma.empresa.findUnique({
    where: { id: empresaId },
    select: { id: true, cnpj: true },
  });
  if (!empresa) return false;

  const empresaIdStr = String(empresa.id);
  const variantes = variantesDocumento(empresa.cnpj);

  const certs = await prisma.certificado.findMany({
    where: {
      OR: [
        { empresaId: empresaIdStr },
        ...variantes.map((v) => ({ cnpj: v })),
        { cnpj: { contains: limparCnpj(empresa.cnpj) } },
      ],
    },
  });

  const certsFiltrados = certs.filter(
    (c) =>
      c.empresaId === empresaIdStr ||
      documentosEquivalentes(c.cnpj, empresa.cnpj)
  );
  const certIds = certsFiltrados.map((c) => c.id);
  const paths = certsFiltrados.map((c) => c.arquivo);

  try {
    await prisma.$transaction(async (tx) => {
      if (certIds.length > 0) {
        await tx.certificado.deleteMany({ where: { id: { in: certIds } } });
      }
      // Credenciais: onDelete Cascade na FK
      await tx.empresa.delete({ where: { id: empresaId } });
    });
  } catch (err) {
    logger.error(
      { err, empresaId, cnpjMasked: maskDoc(empresa.cnpj) },
      'Falha ao excluir empresa na transação'
    );
    return false;
  }

  const storage = await removerArquivosCertificado(paths);
  if (storage.failed.length > 0) {
    logger.error(
      {
        empresaId,
        failedCount: storage.failed.length,
        cnpjMasked: maskDoc(empresa.cnpj),
      },
      'Empresa excluída no banco, mas falhou limpeza parcial no Storage'
    );
  } else {
    logger.info(
      {
        empresaId,
        certsRemoved: certIds.length,
        cnpjMasked: maskDoc(empresa.cnpj),
      },
      'Empresa excluída com certificados e Storage'
    );
  }

  return true;
}

export async function verificarCnpjTemCertificado(cnpj: string): Promise<boolean> {
  const limpo = limparCnpj(cnpj);
  const variantes = variantesDocumento(limpo);
  const candidates = await prisma.certificado.findMany({
    where: {
      OR: [
        ...variantes.map((v) => ({ cnpj: v })),
        { cnpj: { contains: limpo } },
      ],
    },
    select: { cnpj: true },
  });
  return candidates.some((c) => documentosEquivalentes(c.cnpj, limpo));
}

function maskDoc(doc: string): string {
  const d = limparCnpj(doc);
  if (d.length < 6) return '***';
  return `${d.slice(0, 4)}***${d.slice(-2)}`;
}
