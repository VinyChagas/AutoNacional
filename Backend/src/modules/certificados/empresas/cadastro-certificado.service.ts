/**
 * Serviço de cadastro de empresa via certificado digital.
 */
import { prisma } from '../../../db/client';
import { getSupabaseClient } from '../../../config/supabase';
import { env } from '../../../config/env';
import { parseCertificado } from '../../../utils/certificado.parser';
import { encryptPassword } from '../../../infrastructure/crypto';
import * as certRepo from '../../../repositories/certificados';
import { getLogger } from '../../../infrastructure/logger';

const logger = getLogger('cadastro-certificado');

function normCnpj(cnpj: string): string {
  return cnpj.replace(/[.\/\-\s]/g, '').trim();
}

/**
 * Gera path padronizado no Storage.
 * contabilidade/{id}/empresa/{cnpj}/certs/{timestamp}.pfx ou empresa/{cnpj}/certs/{timestamp}.pfx
 */
function gerarStoragePath(
  cnpj: string,
  contabilidadeId?: number | null
): string {
  const cn = normCnpj(cnpj);
  const ts = Date.now();
  if (contabilidadeId != null && contabilidadeId > 0) {
    return `contabilidade/${contabilidadeId}/empresa/${cn}/certs/${ts}.pfx`;
  }
  return `empresa/${cn}/certs/${ts}.pfx`;
}

export interface CadastroCertificadoInput {
  buffer: Buffer;
  senha: string;
  contabilidade_id?: number | null;
}

export interface CadastroCertificadoResult {
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

export async function cadastrarPorCertificado(
  input: CadastroCertificadoInput
): Promise<CadastroCertificadoResult> {
  const { buffer, senha, contabilidade_id } = input;

  const parsed = parseCertificado(buffer, senha);

  const cnpjLimpo = normCnpj(parsed.cnpj);

  let empresa = await prisma.empresa.findUnique({
    where: { cnpj: cnpjLimpo },
  });

  if (!empresa) {
    empresa = await prisma.empresa.create({
      data: {
        cnpj: cnpjLimpo,
        razaoSocial: parsed.razao_social,
        contabilidadeId: contabilidade_id ?? undefined,
      },
    });
  } else if (contabilidade_id != null && contabilidade_id > 0) {
    await prisma.empresa.update({
      where: { id: empresa.id },
      data: { contabilidadeId: contabilidade_id },
    });
    empresa = await prisma.empresa.findUniqueOrThrow({
      where: { id: empresa.id },
    });
  }

  const storagePath = gerarStoragePath(cnpjLimpo, contabilidade_id);

  const supabase = getSupabaseClient();
  const bucket = env.CERT_STORAGE_BUCKET || 'certificados';

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(storagePath, buffer, {
      upsert: true,
      contentType: 'application/x-pkcs12',
    });

  if (uploadError) {
    logger.error({ err: uploadError }, 'Erro ao fazer upload do certificado');
    throw new Error(`Falha ao fazer upload no Storage: ${uploadError.message}`);
  }

  const existingCert = await certRepo.obterPorCnpj(cnpjLimpo);

  const senhaCriptografada = encryptPassword(senha);
  if (existingCert) {
    await prisma.certificado.update({
      where: { id: existingCert.id },
      data: {
        arquivo: storagePath,
        senhaCriptografada,
        dataValidade: parsed.data_validade ?? undefined,
        empresaId: String(empresa.id),
        contabilidadeId: contabilidade_id ?? undefined,
      },
    });
  } else {
    await prisma.certificado.create({
      data: {
        cnpj: cnpjLimpo,
        arquivo: storagePath,
        senhaCriptografada,
        dataValidade: parsed.data_validade ?? undefined,
        empresaId: String(empresa.id),
        contabilidadeId: contabilidade_id ?? undefined,
      },
    });
  }

  const [creds] = await Promise.all([
    prisma.credencial.findMany({
      where: { empresaId: empresa.id },
      orderBy: [{ ultimoTesteEm: 'desc' }, { updatedAt: 'desc' }],
    }),
  ]);

  return {
    empresa: {
      id: empresa.id,
      cnpj: empresa.cnpj,
      razao_social: empresa.razaoSocial,
      regime: empresa.regime,
      contabilidade_id: empresa.contabilidadeId,
    },
    has_cert: true,
    has_cred: creds.length > 0,
    cert_validade: parsed.data_validade,
    cred_status: creds[0]?.status ?? null,
  };
}
