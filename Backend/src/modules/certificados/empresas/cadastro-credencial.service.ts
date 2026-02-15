/**
 * Serviço de cadastro de empresa via credencial (CNPJ/CPF + senha).
 */
import { prisma } from '../../../db/client';
import { encrypt } from '../../../utils/crypto';

function normCnpj(cnpj: string): string {
  return cnpj.replace(/[.\/\-\s]/g, '').trim();
}

export type TipoCredencial = 'CNPJ_SENHA' | 'CPF_SENHA';

export interface CadastroCredencialInput {
  cnpj: string;
  razao_social?: string;
  senha: string;
  tipo?: TipoCredencial;
  usuario?: string;
  contabilidade_id?: number | null;
}

export interface CadastroCredencialResult {
  empresa: {
    id: number;
    cnpj: string;
    razao_social: string;
    regime: string | null;
    contabilidade_id: number | null;
  };
  has_cert: boolean;
  has_cred: boolean;
  cert_validade: string | null;
  cred_status: string | null;
}

export async function cadastrarPorCredencial(
  input: CadastroCredencialInput
): Promise<CadastroCredencialResult> {
  const cnpjLimpo = normCnpj(input.cnpj);
  if (cnpjLimpo.length !== 14) {
    throw new Error('CNPJ deve conter 14 dígitos');
  }
  if (!input.senha || !input.senha.trim()) {
    throw new Error('Senha é obrigatória');
  }

  const tipo: TipoCredencial = input.tipo || 'CNPJ_SENHA';
  const usuario = (input.usuario && normCnpj(input.usuario)) || cnpjLimpo;

  if (tipo === 'CNPJ_SENHA' && usuario.length !== 14) {
    throw new Error('Usuário (CNPJ) deve conter 14 dígitos');
  }
  if (tipo === 'CPF_SENHA' && usuario.length !== 11) {
    throw new Error('Usuário (CPF) deve conter 11 dígitos');
  }

  let empresa = await prisma.empresa.findUnique({
    where: { cnpj: cnpjLimpo },
  });

  if (!empresa) {
    const razao = (input.razao_social ?? '').trim();
    if (!razao || razao.length < 2) {
      throw new Error('razao_social é obrigatório quando a empresa não existe');
    }
    empresa = await prisma.empresa.create({
      data: {
        cnpj: cnpjLimpo,
        razaoSocial: razao,
        contabilidadeId: input.contabilidade_id ?? undefined,
      },
    });
  } else if (input.contabilidade_id != null && input.contabilidade_id > 0) {
    await prisma.empresa.update({
      where: { id: empresa.id },
      data: { contabilidadeId: input.contabilidade_id },
    });
    empresa = await prisma.empresa.findUniqueOrThrow({
      where: { id: empresa.id },
    });
  }

  const senhaCriptografada = encrypt(input.senha);

  const existing = await prisma.credencial.findUnique({
    where: { empresaId_tipo: { empresaId: empresa.id, tipo } },
  });

  if (existing) {
    await prisma.credencial.update({
      where: { id: existing.id },
      data: { usuario, senhaCriptografada },
    });
  } else {
    await prisma.credencial.create({
      data: {
        empresaId: empresa.id,
        tipo,
        usuario,
        senhaCriptografada,
      },
    });
  }

  const cnps = [normCnpj(empresa.cnpj)];
  const [certs, creds] = await Promise.all([
    prisma.certificado.findMany({
      where: { cnpj: { in: cnps } },
      select: { dataValidade: true },
    }),
    prisma.credencial.findMany({
      where: { empresaId: empresa.id },
      orderBy: [{ ultimoTesteEm: 'desc' }, { updatedAt: 'desc' }],
    }),
  ]);

  const certValidade = certs
    .map((c) => c.dataValidade)
    .filter(Boolean)
    .sort()
    .pop() as string | undefined;

  return {
    empresa: {
      id: empresa.id,
      cnpj: empresa.cnpj,
      razao_social: empresa.razaoSocial,
      regime: empresa.regime,
      contabilidade_id: empresa.contabilidadeId,
    },
    has_cert: certs.length > 0,
    has_cred: true,
    cert_validade: certValidade ?? null,
    cred_status: creds[0]?.status ?? null,
  };
}
