/**
 * Loader de certificados para automação NFSe.
 * Carrega PFX do Supabase Storage e descriptografa a senha.
 */
import * as certificadosRepo from '../repositories/certificados';
import { getSupabaseClient } from '../config/supabase';
import { env } from '../config/env';
import { decryptPassword } from '../infrastructure/crypto';
import type { CertificadoEmMemoria } from '../automation/playwright-nfse';
import { getLogger } from '../infrastructure/logger';

const logger = getLogger('certificate-loader');

function limparCnpj(cnpj: string): string {
  return cnpj.replace(/[.\/\-\s]/g, '').trim();
}

/**
 * Carrega certificado por CNPJ: baixa PFX do Storage e retorna buffer + senha.
 */
export async function carregarCertificadoPorCnpj(
  cnpj: string
): Promise<CertificadoEmMemoria> {
  const cnpjLimpo = limparCnpj(cnpj);
  if (cnpjLimpo.length !== 14) {
    throw new Error(`CNPJ inválido: ${cnpj}`);
  }

  const cert = await certificadosRepo.obterPorCnpj(cnpjLimpo);
  if (!cert) {
    throw new Error(`Certificado não encontrado para CNPJ ${cnpjLimpo}`);
  }

  if (!cert.arquivo?.trim()) {
    throw new Error(
      `Certificado para CNPJ ${cnpjLimpo} não possui arquivo PFX. Reimporte o certificado na tela de Empresas.`
    );
  }

  if (!cert.senhaCriptografada?.trim()) {
    throw new Error(
      `Certificado para CNPJ ${cnpjLimpo} não possui senha armazenada. ` +
        `Reimporte o certificado na tela de Empresas para salvar a senha.`
    );
  }

  const supabase = getSupabaseClient();
  const bucket = env.CERT_STORAGE_BUCKET || 'certificados';

  const { data: pfxBuffer, error } = await supabase.storage
    .from(bucket)
    .download(cert.arquivo);

  if (error || !pfxBuffer) {
    logger.error({ err: error, path: cert.arquivo }, 'Erro ao baixar certificado do Storage');
    throw new Error(
      `Falha ao baixar certificado: ${error?.message ?? 'Arquivo não encontrado'}`
    );
  }

  const arrayBuffer = await pfxBuffer.arrayBuffer();
  const pfx = Buffer.from(arrayBuffer);

  let passphrase: string;
  try {
    passphrase = decryptPassword(cert.senhaCriptografada);
  } catch (e) {
    logger.error({ err: e }, 'Erro ao descriptografar senha do certificado');
    throw new Error(
      'Falha ao descriptografar senha. Verifique se CRYPTO_KEY/APP_CRED_KEY está configurada corretamente.'
    );
  }

  return { pfx, passphrase };
}
