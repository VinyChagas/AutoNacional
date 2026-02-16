/**
 * Serviço de importação em lote de certificados (Preview + Confirmar).
 */
import { prisma } from '../../db/client';
import { getSupabaseClient } from '../../config/supabase';
import { env } from '../../config/env';
import { parseCertificado } from '../../utils/certificado.parser';
import { encryptPassword } from '../../infrastructure/crypto';
import * as certRepo from '../../repositories/certificados';
import {
  createSession,
  getSessionFiles,
  destroySession,
  type StoredCertFile,
} from './import-session.store';

function normCnpj(cnpj: string): string {
  return cnpj.replace(/[.\/\-\s]/g, '').trim();
}

function gerarStoragePath(cnpj: string, contabilidadeId?: number | null): string {
  const cn = normCnpj(cnpj);
  const ts = Date.now();
  if (contabilidadeId != null && contabilidadeId > 0) {
    return `contabilidade/${contabilidadeId}/empresa/${cn}/certs/${ts}.pfx`;
  }
  return `empresa/${cn}/certs/${ts}.pfx`;
}

export type AcaoCert = 'IMPORTAR' | 'ERRO' | 'DUPLICADO';

export interface PreviewItemCert {
  indice: number;
  cnpj: string;
  razao_social: string;
  data_validade: string | null;
  existe_empresa: boolean;
  existe_certificado: boolean;
  acao: AcaoCert;
  erro?: string;
}

export interface PreviewCertificadosResult {
  session_id: string;
  items: PreviewItemCert[];
}

export async function previewCertificados(
  files: Express.Multer.File[],
  senha: string
): Promise<PreviewCertificadosResult> {
  if (!senha?.trim()) {
    throw new Error('Senha é obrigatória');
  }
  const validFiles = files?.filter((f) => f?.buffer?.length) ?? [];
  if (validFiles.length === 0) {
    throw new Error('Nenhum arquivo .pfx ou .p12 enviado');
  }

  const sessionId = createSession(validFiles);
  const items: PreviewItemCert[] = [];

  for (let i = 0; i < validFiles.length; i++) {
    try {
      const parsed = parseCertificado(validFiles[i].buffer, senha);
      const cnpjLimpo = normCnpj(parsed.cnpj);
      const [existeEmpresa, existingCert] = await Promise.all([
        prisma.empresa.findUnique({ where: { cnpj: cnpjLimpo } }),
        certRepo.obterPorCnpj(cnpjLimpo),
      ]);
      const existeCertificado = !!existingCert;
      const acao: AcaoCert = existeCertificado ? 'DUPLICADO' : 'IMPORTAR';
      items.push({
        indice: i,
        cnpj: parsed.cnpj,
        razao_social: parsed.razao_social,
        data_validade: parsed.data_validade,
        existe_empresa: !!existeEmpresa,
        existe_certificado: existeCertificado,
        acao,
        ...(existeCertificado && { erro: 'CNPJ já possui certificado cadastrado' }),
      });
    } catch (e) {
      items.push({
        indice: i,
        cnpj: '',
        razao_social: '',
        data_validade: null,
        existe_empresa: false,
        existe_certificado: false,
        acao: 'ERRO',
        erro: (e as Error).message,
      });
    }
  }

  return { session_id: sessionId, items };
}

export interface ConfirmarItemCert {
  indice: number;
}

export interface ConfirmarCertificadosInput {
  session_id: string;
  senha: string;
  itens: ConfirmarItemCert[];
  contabilidade_id?: number | null;
}

export interface ConfirmarCertificadosResult {
  importados: number;
  erros: { indice: number; mensagem: string }[];
}

export async function confirmarCertificados(
  input: ConfirmarCertificadosInput
): Promise<ConfirmarCertificadosResult> {
  const { session_id, senha, itens, contabilidade_id } = input;
  if (!senha?.trim()) {
    throw new Error('Senha é obrigatória no confirmar');
  }
  const indices = new Set(itens.map((x) => x.indice));

  let files: StoredCertFile[];
  try {
    files = getSessionFiles(session_id);
  } catch (e) {
    throw new Error((e as Error).message);
  }

  const supabase = getSupabaseClient();
  const bucket = env.CERT_STORAGE_BUCKET || 'certificados';
  const erros: { indice: number; mensagem: string }[] = [];
  let importados = 0;

  for (let i = 0; i < files.length; i++) {
    if (!indices.has(i)) continue;
    try {
      const parsed = parseCertificado(files[i].buffer, senha);
      const cnpjLimpo = normCnpj(parsed.cnpj);

      let empresa = await prisma.empresa.findUnique({ where: { cnpj: cnpjLimpo } });
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
        empresa = await prisma.empresa.findUniqueOrThrow({ where: { id: empresa.id } });
      }

      const storagePath = gerarStoragePath(cnpjLimpo, contabilidade_id);
      const { error: uploadError } = await supabase.storage
        .from(bucket)
        .upload(storagePath, files[i].buffer, {
          upsert: true,
          contentType: 'application/x-pkcs12',
        });
      if (uploadError) {
        erros.push({ indice: i, mensagem: `Upload: ${uploadError.message}` });
        continue;
      }

      const senhaCriptografada = encryptPassword(senha);
      const existingCert = await certRepo.obterPorCnpj(cnpjLimpo);
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
      importados++;
    } catch (e) {
      erros.push({ indice: i, mensagem: (e as Error).message });
    }
  }

  destroySession(session_id);
  return { importados, erros };
}
