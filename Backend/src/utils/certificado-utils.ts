/**
 * Utilitários para extrair informações de certificados digitais ICP-Brasil.
 * Utilitários para manipulação de certificados digitais.
 */
import * as forge from 'node-forge';
import { getLogger } from '../infrastructure/logger';

const logger = getLogger('certificado-utils');

export interface CertificadoInfo {
  empresa: string | null;
  cnpj: string | null;
  cnpj_limpo: string | null;
  dataVencimento: string | null;
}

function extrairCnpjDoTexto(texto: string): string | null {
  if (!texto || !texto.trim()) return null;
  const limpo = texto.replace(/\D/g, '');
  if (limpo.length === 14 && limpo !== '00000000000000') {
    return limpo;
  }
  const match = texto.match(/(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})|\b(\d{14})\b/);
  if (match) {
    const cnpj = (match[1] || match[2] || '').replace(/\D/g, '');
    if (cnpj.length === 14) return cnpj;
  }
  return null;
}

/**
 * Extrai CNPJ, nome da empresa e data de vencimento de um certificado PFX.
 */
export function extrairInformacoesCertificado(
  conteudoPfx: Buffer,
  senha: string
): CertificadoInfo {
  try {
    const p12Asn1 = forge.asn1.fromDer(conteudoPfx.toString('binary'));
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, senha);

    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    const certBag = certBags[forge.pki.oids.certBag]?.[0];
    if (!certBag?.cert) {
      throw new Error('Certificado não encontrado no arquivo PKCS12');
    }
    const cert = certBag.cert;

    let nomeEmpresa: string | null = null;
    let cnpj: string | null = null;

    const subject = cert.subject.attributes;
    for (const attr of subject) {
      if (attr.shortName === 'CN') {
        const cnVal = attr.value as string;
        if (cnVal.includes(':')) {
          const [nome, parteCnpj] = cnVal.split(':', 2);
          nomeEmpresa = nome.trim();
          cnpj = extrairCnpjDoTexto(parteCnpj?.trim() || '') || extrairCnpjDoTexto(cnVal);
        } else {
          nomeEmpresa = cnVal;
          cnpj = extrairCnpjDoTexto(cnVal);
        }
        if (cnpj) break;
      }
    }

    if (!cnpj) {
      for (const attr of subject) {
        if (attr.shortName === 'OU') {
          cnpj = extrairCnpjDoTexto(attr.value as string);
          if (cnpj) break;
        }
      }
    }

    if (!cnpj) {
      for (const attr of subject) {
        const cnpjExtraido = extrairCnpjDoTexto(attr.value as string);
        if (cnpjExtraido) {
          cnpj = cnpjExtraido;
          if (!nomeEmpresa && attr.shortName === 'CN') nomeEmpresa = attr.value as string;
          break;
        }
      }
    }

    const validity = cert.validity;
    const dataVencimento = validity.notAfter
      ? `${String(validity.notAfter.getDate()).padStart(2, '0')}/${String(validity.notAfter.getMonth() + 1).padStart(2, '0')}/${validity.notAfter.getFullYear()}`
      : null;

    return {
      empresa: nomeEmpresa,
      cnpj: cnpj ? cnpj.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5') : null,
      cnpj_limpo: cnpj,
      dataVencimento,
    };
  } catch (e) {
    const msg = (e as Error).message?.toLowerCase() || '';
    if (msg.includes('password') || msg.includes('mac') || msg.includes('decrypt')) {
      throw new Error('Senha do certificado incorreta');
    }
    logger.error({ err: e }, 'Erro ao extrair informações do certificado');
    throw e;
  }
}
