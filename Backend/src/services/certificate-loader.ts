/**
 * Loader de certificados para automação NFSe.
 * Carrega PFX do filesystem local e descriptografa a senha.
 */
import * as certificadosRepo from '../repositories/certificados';
import {
  CertificateFileNotFoundError,
  getCertificateStorage,
  maskRelativePath,
} from '../storage';
import { decryptPassword } from '../infrastructure/crypto';
import type { CertificadoEmMemoria } from '../automation/playwright-nfse';
import { getLogger } from '../infrastructure/logger';

const logger = getLogger('certificate-loader');

function limparCnpj(cnpj: string): string {
  return cnpj.replace(/[.\/\-\s]/g, '').trim();
}

/**
 * Carrega certificado por CNPJ: lê PFX do storage local e retorna buffer + senha.
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

  const storage = getCertificateStorage();
  let pfx: Buffer;
  try {
    pfx = await storage.read(cert.arquivo);
  } catch (e) {
    logger.error(
      { pathMasked: maskRelativePath(cert.arquivo) },
      'Erro ao ler certificado do storage local'
    );
    if (e instanceof CertificateFileNotFoundError) {
      throw new Error('Falha ao baixar certificado: Arquivo não encontrado');
    }
    throw new Error(
      `Falha ao baixar certificado: ${(e as Error).message || 'Arquivo não encontrado'}`
    );
  }

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
