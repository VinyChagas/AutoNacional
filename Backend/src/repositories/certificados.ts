/**
 * Repositório de metadados de certificados digitais.
 */
import { prisma } from '../db/client';
import type { Certificado } from '@prisma/client';
import {
  documentosEquivalentes,
  limparDocumento,
  variantesDocumento,
} from '../utils/documento-certificado';
import { removerArquivosCertificado } from '../services/certificado-storage.service';
import { getLogger } from '../infrastructure/logger';

const logger = getLogger('certificados-repo');

function limparCnpj(cnpj: string): string {
  return limparDocumento(cnpj);
}

export async function listarCertificados(): Promise<Certificado[]> {
  return prisma.certificado.findMany({
    orderBy: { dataCadastro: 'desc' },
  });
}

/**
 * Lista todos os certificados cujo CNPJ/CPF é equivalente ao documento informado.
 * Cobre formatação, CPF com/sem pad e múltiplos registros (sem unique no schema).
 */
export async function listarPorCnpjNormalizado(cnpj: string): Promise<Certificado[]> {
  const limpo = limparCnpj(cnpj);
  if (!limpo) return [];

  const variantes = variantesDocumento(limpo);
  const candidates = await prisma.certificado.findMany({
    where: {
      OR: [
        ...variantes.map((v) => ({ cnpj: v })),
        // Legado: CNPJ formatado contendo os dígitos
        { cnpj: { contains: limpo } },
        ...(limpo.length === 14 && limpo.startsWith('000')
          ? [{ cnpj: { contains: limpo.slice(3) } }]
          : []),
      ],
    },
    orderBy: { dataCadastro: 'desc' },
  });

  return candidates.filter((c) => documentosEquivalentes(c.cnpj, limpo));
}

export async function obterPorCnpj(cnpj: string): Promise<Certificado | null> {
  const list = await listarPorCnpjNormalizado(cnpj);
  return list[0] ?? null;
}

export async function existeCertificadoAtivoParaCnpj(cnpj: string): Promise<boolean> {
  const list = await listarPorCnpjNormalizado(cnpj);
  return list.length > 0;
}

export async function obterPorId(id: number): Promise<Certificado | null> {
  return prisma.certificado.findUnique({
    where: { id },
  });
}

export async function listarPorEmpresaId(empresaId: number | string): Promise<Certificado[]> {
  const idStr = String(empresaId);
  return prisma.certificado.findMany({
    where: { empresaId: idStr },
    orderBy: { dataCadastro: 'desc' },
  });
}

export async function criar(data: {
  cnpj: string;
  arquivo?: string;
  senhaCriptografada?: string;
  dataValidade?: string;
  empresaId?: string;
  contabilidadeId?: number;
}): Promise<Certificado> {
  const cnpjLimpo = limparCnpj(data.cnpj);
  return prisma.certificado.create({
    data: {
      cnpj: cnpjLimpo,
      arquivo: data.arquivo,
      senhaCriptografada: data.senhaCriptografada,
      dataValidade: data.dataValidade,
      empresaId: data.empresaId,
      contabilidadeId: data.contabilidadeId,
    },
  });
}

export async function atualizar(
  id: number,
  data: Partial<
    Pick<Certificado, 'arquivo' | 'senhaCriptografada' | 'dataValidade' | 'contabilidadeId'>
  >
): Promise<Certificado | null> {
  try {
    return await prisma.certificado.update({
      where: { id },
      data,
    });
  } catch {
    return null;
  }
}

export async function deletar(id: number): Promise<boolean> {
  try {
    await prisma.certificado.delete({ where: { id } });
    return true;
  } catch {
    return false;
  }
}

export interface RemoverCertificadosResult {
  deletedCount: number;
  certificadoIds: number[];
  storage: {
    attempted: string[];
    removed: string[];
    failed: Array<{ path: string; error: string }>;
  };
}

/**
 * Remove TODOS os certificados equivalentes ao CNPJ/CPF + arquivos no Storage.
 * Empresa e credenciais não são tocadas.
 */
export async function removerTodosPorCnpj(
  cnpj: string
): Promise<RemoverCertificadosResult | null> {
  const certs = await listarPorCnpjNormalizado(cnpj);
  if (certs.length === 0) return null;

  const ids = certs.map((c) => c.id);
  const paths = certs.map((c) => c.arquivo);

  await prisma.certificado.deleteMany({
    where: { id: { in: ids } },
  });

  const storage = await removerArquivosCertificado(paths);

  logger.info(
    {
      deletedCount: ids.length,
      certificadoIds: ids,
      storageFailed: storage.failed.length,
      cnpjMasked: maskDoc(cnpj),
    },
    'Certificados removidos por CNPJ'
  );

  return {
    deletedCount: ids.length,
    certificadoIds: ids,
    storage: {
      attempted: storage.attempted,
      removed: storage.removed,
      failed: storage.failed,
    },
  };
}

/** @deprecated Use removerTodosPorCnpj — mantido para compatibilidade. */
export async function deletarPorCnpj(cnpj: string): Promise<boolean> {
  const result = await removerTodosPorCnpj(cnpj);
  return result != null && result.deletedCount > 0;
}

function maskDoc(doc: string): string {
  const d = limparCnpj(doc);
  if (d.length < 6) return '***';
  return `${d.slice(0, 4)}***${d.slice(-2)}`;
}
