/**
 * Repositório de credenciais.
 * Suporta descriptografia de credenciais em formato CBC (iv:data) ou GCM (iv:authTag:data).
 */
import { prisma } from '../db/client';
import { encryptPassword, decryptPassword } from '../infrastructure/crypto';
import { decrypt as decryptGcm } from '../utils/crypto';
import type { Credencial } from '@prisma/client';

export type TipoCredencial = 'CNPJ_SENHA' | 'CPF_SENHA';

export async function listarPorEmpresa(empresaId: number): Promise<Credencial[]> {
  return prisma.credencial.findMany({
    where: { empresaId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function obterPorId(credencialId: number): Promise<Credencial | null> {
  return prisma.credencial.findUnique({
    where: { id: credencialId },
  });
}

export async function criarOuAtualizar(
  empresaId: number,
  tipo: TipoCredencial,
  usuario: string,
  senha: string
): Promise<Credencial> {
  const senhaCriptografada = encryptPassword(senha);
  const usuarioLimpo = usuario.replace(/[.\/\-\s]/g, '');

  const existing = await prisma.credencial.findUnique({
    where: { empresaId_tipo: { empresaId, tipo } },
  });

  if (existing) {
    return prisma.credencial.update({
      where: { id: existing.id },
      data: { usuario: usuarioLimpo, senhaCriptografada },
    });
  }

  return prisma.credencial.create({
    data: {
      empresaId,
      tipo,
      usuario: usuarioLimpo,
      senhaCriptografada,
    },
  });
}

export async function atualizarStatus(
  credencialId: number,
  status: string
): Promise<Credencial | null> {
  try {
    return await prisma.credencial.update({
      where: { id: credencialId },
      data: { status, ultimoTesteEm: new Date() },
    });
  } catch {
    return null;
  }
}

export async function atualizarCredencial(
  credencialId: number,
  senha: string
): Promise<Credencial | null> {
  try {
    const senhaCriptografada = encryptPassword(senha);
    return await prisma.credencial.update({
      where: { id: credencialId },
      data: { senhaCriptografada },
    });
  } catch {
    return null;
  }
}

export async function deletarCredencial(credencialId: number): Promise<boolean> {
  try {
    await prisma.credencial.delete({ where: { id: credencialId } });
    return true;
  } catch {
    return false;
  }
}

export function descriptografarSenha(credencial: Credencial): string {
  const enc = credencial.senhaCriptografada;
  if (!enc?.trim()) return '';
  const parts = enc.split(':');
  if (parts.length === 3) {
    return decryptGcm(enc);
  }
  return decryptPassword(enc);
}
