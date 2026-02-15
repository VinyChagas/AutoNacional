/**
 * Repositório de metadados de certificados digitais.
 * Apenas metadados - upload/download de .pfx vem na Fase 5.
 */
import { prisma } from '../db/client';
import type { Certificado } from '@prisma/client';

function limparCnpj(cnpj: string): string {
  return cnpj.replace(/[.\/\-\s]/g, '').trim();
}

export async function listarCertificados(): Promise<Certificado[]> {
  return prisma.certificado.findMany({
    orderBy: { dataCadastro: 'desc' },
  });
}

export async function obterPorCnpj(cnpj: string): Promise<Certificado | null> {
  const cnpjLimpo = limparCnpj(cnpj);
  return prisma.certificado.findFirst({
    where: { cnpj: cnpjLimpo },
  });
}

export async function obterPorId(id: number): Promise<Certificado | null> {
  return prisma.certificado.findUnique({
    where: { id },
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
  data: Partial<Pick<Certificado, 'arquivo' | 'senhaCriptografada' | 'dataValidade' | 'contabilidadeId'>>
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

export async function deletarPorCnpj(cnpj: string): Promise<boolean> {
  const cnpjLimpo = limparCnpj(cnpj);
  const cert = await obterPorCnpj(cnpjLimpo);
  if (!cert) return false;
  return deletar(cert.id);
}
