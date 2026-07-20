/**
 * Serviço de importação em lote de certificados (Preview + Confirmar).
 * Classifica NEW / UPDATE_AVAILABLE / EXACT_DUPLICATE / etc. e exige ação explícita.
 */
import { prisma } from '../../db/client';
import { getSupabaseClient } from '../../config/supabase';
import { env } from '../../config/env';
import { parseCertificado } from '../../utils/certificado.parser';
import { encryptPassword, decryptPassword } from '../../infrastructure/crypto';
import * as certRepo from '../../repositories/certificados';
import { removerArquivosCertificado } from '../../services/certificado-storage.service';
import { getLogger } from '../../infrastructure/logger';
import {
  createSession,
  getSessionFiles,
  destroySession,
  saveSessionMeta,
  loadSessionMeta,
  markIndicesProcessed,
  type StoredCertFile,
  type SessionPreviewMetaItem,
} from './import-session.store';
import {
  classifyIncomingCertificate,
  defaultConfirmAction,
  toLegacyAcao,
  type ConfirmCertAction,
  type PreviewCertAction,
  type CertIdentity,
} from './import-certificados-classify';

const logger = getLogger('import-certificados');

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

async function baixarArquivoCertificado(
  arquivo: string | null | undefined
): Promise<Buffer | null> {
  if (!arquivo?.trim()) return null;
  try {
    const supabase = getSupabaseClient();
    const bucket = env.CERT_STORAGE_BUCKET || 'certificados';
    const { data, error } = await supabase.storage.from(bucket).download(arquivo.trim());
    if (error || !data) {
      logger.warn(
        { path: arquivo, err: error?.message },
        'Falha ao baixar certificado existente para comparação'
      );
      return null;
    }
    const ab = await data.arrayBuffer();
    return Buffer.from(ab);
  } catch (err) {
    logger.warn({ err, path: arquivo }, 'Exceção ao baixar certificado existente');
    return null;
  }
}

async function identityDoCertificadoExistente(
  cert: {
    arquivo: string | null;
    senhaCriptografada: string | null;
    dataValidade: string | null;
  }
): Promise<CertIdentity> {
  const base: CertIdentity = {
    valid_until: cert.dataValidade,
    thumbprint: null,
    serial: null,
  };
  if (!cert.arquivo || !cert.senhaCriptografada) return base;

  const buf = await baixarArquivoCertificado(cert.arquivo);
  if (!buf) return base;

  try {
    const senha = decryptPassword(cert.senhaCriptografada);
    const parsed = parseCertificado(buf, senha);
    return {
      valid_until: parsed.data_validade ?? cert.dataValidade,
      thumbprint: parsed.thumbprint,
      serial: parsed.serial,
    };
  } catch (err) {
    logger.warn({ err }, 'Não foi possível parsear certificado existente');
    return base;
  }
}

export interface PreviewItemCert {
  indice: number;
  cnpj: string;
  razao_social: string;
  data_validade: string | null;
  existe_empresa: boolean;
  existe_certificado: boolean;
  /** Classificação nova (preferir). */
  action: PreviewCertAction;
  can_confirm: boolean;
  default_confirm_action: ConfirmCertAction;
  message: string;
  days_delta: number | null;
  existing_cert_id: number | null;
  existing_valid_until: string | null;
  thumbprint: string | null;
  serial: string | null;
  /** Legado — compatibilidade com FE antigo. */
  acao:
    | 'IMPORTAR'
    | 'ERRO'
    | 'DUPLICADO'
    | 'UPDATE_AVAILABLE'
    | 'OLDER_CERTIFICATE'
    | 'EXPIRED_CERTIFICATE';
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
  const metaPreview: SessionPreviewMetaItem[] = [];

  for (let i = 0; i < validFiles.length; i++) {
    try {
      const parsed = parseCertificado(validFiles[i].buffer, senha);
      const cnpjLimpo = normCnpj(parsed.cnpj);
      const [existeEmpresa, existingCert] = await Promise.all([
        prisma.empresa.findUnique({ where: { cnpj: cnpjLimpo } }),
        certRepo.obterPorCnpj(cnpjLimpo),
      ]);

      const incoming: CertIdentity = {
        valid_until: parsed.data_validade,
        thumbprint: parsed.thumbprint,
        serial: parsed.serial,
      };

      let existingIdentity: CertIdentity | null = null;
      if (existingCert) {
        existingIdentity = await identityDoCertificadoExistente(existingCert);
      }

      const classified = classifyIncomingCertificate({
        incoming,
        existing: existingIdentity,
      });

      const item: PreviewItemCert = {
        indice: i,
        cnpj: parsed.cnpj,
        razao_social: parsed.razao_social,
        data_validade: parsed.data_validade,
        existe_empresa: !!existeEmpresa,
        existe_certificado: !!existingCert,
        action: classified.action,
        can_confirm: classified.can_confirm,
        default_confirm_action: defaultConfirmAction(classified.action),
        message: classified.message,
        days_delta: classified.days_delta,
        existing_cert_id: existingCert?.id ?? null,
        existing_valid_until: existingIdentity?.valid_until ?? existingCert?.dataValidade ?? null,
        thumbprint: parsed.thumbprint,
        serial: parsed.serial,
        acao: toLegacyAcao(classified.action),
        ...(classified.can_confirm ? {} : { erro: classified.message }),
      };
      items.push(item);
      metaPreview.push({
        indice: i,
        action: classified.action,
        can_confirm: classified.can_confirm,
        cnpj: cnpjLimpo,
        existing_cert_id: existingCert?.id ?? null,
        existing_arquivo: existingCert?.arquivo ?? null,
        incoming_thumbprint: parsed.thumbprint,
        incoming_serial: parsed.serial,
        incoming_valid_until: parsed.data_validade,
        existing_valid_until: existingIdentity?.valid_until ?? existingCert?.dataValidade ?? null,
        days_delta: classified.days_delta,
        message: classified.message,
      });
    } catch (e) {
      const msg = (e as Error).message || 'Arquivo inválido';
      const action: PreviewCertAction =
        /senha|password|mac|invalid|pfx|p12|pkcs/i.test(msg)
          ? 'INVALID_FILE'
          : 'ERROR';
      items.push({
        indice: i,
        cnpj: '',
        razao_social: '',
        data_validade: null,
        existe_empresa: false,
        existe_certificado: false,
        action,
        can_confirm: false,
        default_confirm_action: 'SKIP',
        message: msg,
        days_delta: null,
        existing_cert_id: null,
        existing_valid_until: null,
        thumbprint: null,
        serial: null,
        acao: 'ERRO',
        erro: msg,
      });
      metaPreview.push({
        indice: i,
        action,
        can_confirm: false,
        cnpj: '',
        existing_cert_id: null,
        existing_arquivo: null,
        incoming_thumbprint: null,
        incoming_serial: null,
        incoming_valid_until: null,
        existing_valid_until: null,
        days_delta: null,
        message: msg,
      });
    }
  }

  saveSessionMeta(sessionId, { preview: metaPreview, processed: [] });
  return { session_id: sessionId, items };
}

export interface ConfirmarItemCert {
  indice: number;
  /** Ação explícita: CREATE | REPLACE_EXISTING | SKIP. Obrigatória. */
  action: ConfirmCertAction;
}

export interface ConfirmarCertificadosInput {
  session_id: string;
  senha: string;
  itens: ConfirmarItemCert[];
  contabilidade_id?: number | null;
}

export interface ConfirmarCertificadosResult {
  importados: number;
  atualizados: number;
  ignorados: number;
  erros: { indice: number; mensagem: string }[];
}

function parseConfirmAction(raw: unknown): ConfirmCertAction | null {
  if (raw === 'CREATE' || raw === 'REPLACE_EXISTING' || raw === 'SKIP') return raw;
  // Compat: itens só com indice → trata como CREATE (legado)
  if (raw == null || raw === undefined) return null;
  return null;
}

export async function confirmarCertificados(
  input: ConfirmarCertificadosInput
): Promise<ConfirmarCertificadosResult> {
  const { session_id, senha, itens, contabilidade_id } = input;
  if (!senha?.trim()) {
    throw new Error('Senha é obrigatória no confirmar');
  }

  let files: StoredCertFile[];
  try {
    files = getSessionFiles(session_id);
  } catch (e) {
    throw new Error((e as Error).message);
  }

  const meta = loadSessionMeta(session_id);
  const processed = new Set(meta.processed);
  const erros: { indice: number; mensagem: string }[] = [];
  let importados = 0;
  let atualizados = 0;
  let ignorados = 0;
  const newlyProcessed: number[] = [];

  for (const item of itens) {
    const i = item.indice;
    if (i < 0 || i >= files.length) {
      erros.push({ indice: i, mensagem: 'Índice inválido' });
      continue;
    }

    const action = item.action;
    if (action === 'SKIP') {
      ignorados++;
      newlyProcessed.push(i);
      continue;
    }

    if (processed.has(i)) {
      // Idempotente: já processado nesta sessão
      if (action === 'CREATE') importados++;
      else if (action === 'REPLACE_EXISTING') atualizados++;
      continue;
    }

    try {
      const result = await processarItemConfirmado({
        file: files[i],
        senha,
        action,
        contabilidade_id,
        previewMeta: meta.preview.find((p) => p.indice === i) ?? null,
      });
      if (result === 'created') importados++;
      else if (result === 'replaced') atualizados++;
      newlyProcessed.push(i);
    } catch (e) {
      erros.push({ indice: i, mensagem: (e as Error).message });
    }
  }

  if (newlyProcessed.length > 0) {
    markIndicesProcessed(session_id, newlyProcessed);
  }

  const metaAfter = loadSessionMeta(session_id);
  if (metaAfter.processed.length >= files.length) {
    destroySession(session_id);
  }

  return { importados, atualizados, ignorados, erros };
}

async function processarItemConfirmado(opts: {
  file: StoredCertFile;
  senha: string;
  action: ConfirmCertAction;
  contabilidade_id?: number | null;
  previewMeta: SessionPreviewMetaItem | null;
}): Promise<'created' | 'replaced'> {
  const { file, senha, action, contabilidade_id } = opts;
  const parsed = parseCertificado(file.buffer, senha);
  const cnpjLimpo = normCnpj(parsed.cnpj);

  const incoming: CertIdentity = {
    valid_until: parsed.data_validade,
    thumbprint: parsed.thumbprint,
    serial: parsed.serial,
  };

  const existingCert = await certRepo.obterPorCnpj(cnpjLimpo);
  let existingIdentity: CertIdentity | null = null;
  if (existingCert) {
    existingIdentity = await identityDoCertificadoExistente(existingCert);
  }

  const classified = classifyIncomingCertificate({
    incoming,
    existing: existingIdentity,
  });

  if (action === 'CREATE') {
    if (existingCert) {
      throw new Error(
        'CNPJ já possui certificado. Use REPLACE_EXISTING para atualizar explicitamente.'
      );
    }
    if (!classified.can_confirm || classified.action !== 'NEW') {
      throw new Error(classified.message || 'Certificado não pode ser cadastrado');
    }
    await criarCertificadoNovo({
      buffer: file.buffer,
      senha,
      parsed,
      cnpjLimpo,
      contabilidade_id,
    });
    return 'created';
  }

  if (action === 'REPLACE_EXISTING') {
    if (!existingCert) {
      throw new Error(
        'Não há certificado existente para substituir. Use CREATE para cadastrar.'
      );
    }
    if (classified.action === 'EXACT_DUPLICATE') {
      throw new Error('Certificado idêntico ao cadastrado — substituição desnecessária');
    }
    if (classified.action === 'EXPIRED_CERTIFICATE') {
      throw new Error('Certificado enviado já está vencido — substituição bloqueada');
    }
    if (classified.action !== 'UPDATE_AVAILABLE') {
      throw new Error(
        classified.message ||
          'Substituição só é permitida quando o novo certificado tem validade superior'
      );
    }
    await substituirCertificadoSeguro({
      buffer: file.buffer,
      senha,
      parsed,
      cnpjLimpo,
      contabilidade_id,
      existingCert,
    });
    return 'replaced';
  }

  throw new Error(`Ação inválida: ${action}`);
}

async function ensureEmpresa(
  cnpjLimpo: string,
  razaoSocial: string,
  contabilidade_id?: number | null
) {
  let empresa = await prisma.empresa.findUnique({ where: { cnpj: cnpjLimpo } });
  if (!empresa) {
    empresa = await prisma.empresa.create({
      data: {
        cnpj: cnpjLimpo,
        razaoSocial,
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
  return empresa;
}

async function criarCertificadoNovo(opts: {
  buffer: Buffer;
  senha: string;
  parsed: ReturnType<typeof parseCertificado>;
  cnpjLimpo: string;
  contabilidade_id?: number | null;
}): Promise<void> {
  const { buffer, senha, parsed, cnpjLimpo, contabilidade_id } = opts;
  const empresa = await ensureEmpresa(
    cnpjLimpo,
    parsed.razao_social,
    contabilidade_id
  );
  const storagePath = gerarStoragePath(cnpjLimpo, contabilidade_id);
  const supabase = getSupabaseClient();
  const bucket = env.CERT_STORAGE_BUCKET || 'certificados';

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(storagePath, buffer, {
      upsert: false,
      contentType: 'application/x-pkcs12',
    });
  if (uploadError) {
    throw new Error(`Upload: ${uploadError.message}`);
  }

  try {
    await prisma.certificado.create({
      data: {
        cnpj: cnpjLimpo,
        arquivo: storagePath,
        senhaCriptografada: encryptPassword(senha),
        dataValidade: parsed.data_validade ?? undefined,
        empresaId: String(empresa.id),
        contabilidadeId: contabilidade_id ?? undefined,
      },
    });
  } catch (err) {
    await removerArquivosCertificado([storagePath]);
    throw err;
  }
}

/**
 * Substituição segura: upload novo → atualiza DB → só então remove arquivo antigo.
 * Se DB falhar após upload, remove o arquivo novo e mantém o antigo.
 */
async function substituirCertificadoSeguro(opts: {
  buffer: Buffer;
  senha: string;
  parsed: ReturnType<typeof parseCertificado>;
  cnpjLimpo: string;
  contabilidade_id?: number | null;
  existingCert: {
    id: number;
    arquivo: string | null;
  };
}): Promise<void> {
  const { buffer, senha, parsed, cnpjLimpo, contabilidade_id, existingCert } = opts;
  const empresa = await ensureEmpresa(
    cnpjLimpo,
    parsed.razao_social,
    contabilidade_id
  );

  const oldPath = existingCert.arquivo?.trim() || null;
  const newPath = gerarStoragePath(cnpjLimpo, contabilidade_id);
  const supabase = getSupabaseClient();
  const bucket = env.CERT_STORAGE_BUCKET || 'certificados';

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(newPath, buffer, {
      upsert: false,
      contentType: 'application/x-pkcs12',
    });
  if (uploadError) {
    throw new Error(`Upload do novo certificado: ${uploadError.message}`);
  }

  try {
    await prisma.certificado.update({
      where: { id: existingCert.id },
      data: {
        arquivo: newPath,
        senhaCriptografada: encryptPassword(senha),
        dataValidade: parsed.data_validade ?? undefined,
        empresaId: String(empresa.id),
        contabilidadeId: contabilidade_id ?? undefined,
      },
    });
  } catch (err) {
    await removerArquivosCertificado([newPath]);
    throw new Error(
      `Falha ao atualizar certificado no banco (arquivo antigo preservado): ${(err as Error).message}`
    );
  }

  // DB ok — remove arquivo antigo (se diferente do novo)
  if (oldPath && oldPath !== newPath) {
    const cleanup = await removerArquivosCertificado([oldPath]);
    if (cleanup.failed.length > 0) {
      logger.warn(
        { oldPath, failed: cleanup.failed },
        'Certificado atualizado, mas falha ao remover arquivo antigo do Storage'
      );
    }
  }

  // Remove extras do mesmo CNPJ (órfãos), mantendo o registro atualizado
  const todos = await certRepo.listarPorCnpjNormalizado(cnpjLimpo);
  const extras = todos.filter((c) => c.id !== existingCert.id);
  if (extras.length > 0) {
    const extraPaths = extras.map((c) => c.arquivo);
    await prisma.certificado.deleteMany({
      where: { id: { in: extras.map((c) => c.id) } },
    });
    await removerArquivosCertificado(extraPaths);
  }
}

/** Expõe parse de ação para o controller (com fallback legado). */
export function resolveConfirmAction(
  raw: unknown,
  hasExplicitAction: boolean
): ConfirmCertAction {
  const parsed = parseConfirmAction(raw);
  if (parsed) return parsed;
  // Legado: só { indice } → CREATE
  if (!hasExplicitAction) return 'CREATE';
  throw new Error('action deve ser CREATE, REPLACE_EXISTING ou SKIP');
}
