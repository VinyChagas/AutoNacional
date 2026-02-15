/**
 * Parser de certificados digitais ICP-Brasil (.pfx/.p12).
 * Extrai CNPJ, razão social, data de validade, serial e thumbprint.
 */
import * as forge from 'node-forge';
import { getLogger } from '../infrastructure/logger';

const logger = getLogger('certificado-parser');

export interface CertificadoParseResult {
  cnpj: string;
  cnpj_formatado: string;
  razao_social: string;
  data_validade: string | null;
  serial: string | null;
  thumbprint: string | null;
}

function extrairCnpjDoTexto(texto: string): string | null {
  if (!texto || !texto.trim()) return null;
  const limpo = texto.replace(/\D/g, '');
  if (limpo.length === 14 && limpo !== '00000000000000') return limpo;
  const match = texto.match(/(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})|\b(\d{14})\b/);
  if (match) {
    const cnpj = (match[1] || match[2] || '').replace(/\D/g, '');
    if (cnpj.length === 14) return cnpj;
  }
  return null;
}

function formatarCnpj(cnpj: string): string {
  return cnpj.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
}

/**
 * Extrai informações completas do certificado PFX/P12.
 * @throws Error se senha incorreta ou certificado inválido
 */
export function parseCertificado(conteudoPfx: Buffer, senha: string): CertificadoParseResult {
  if (!conteudoPfx?.length) {
    throw new Error('Arquivo do certificado vazio ou inválido');
  }
  if (!senha || !senha.trim()) {
    throw new Error('Senha do certificado é obrigatória');
  }

  try {
    const p12Asn1 = forge.asn1.fromDer(conteudoPfx.toString('binary'));
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, senha);

    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    const certBag = certBags[forge.pki.oids.certBag]?.[0];
    if (!certBag?.cert) {
      throw new Error('Certificado não encontrado no arquivo PKCS12');
    }
    const cert = certBag.cert;

    let razao_social = '';
    let cnpj: string | null = null;

    const subject = cert.subject.attributes;
    for (const attr of subject) {
      if (attr.shortName === 'CN') {
        const cnVal = attr.value as string;
        if (cnVal.includes(':')) {
          const [nome, parteCnpj] = cnVal.split(':', 2);
          razao_social = nome.trim();
          cnpj = extrairCnpjDoTexto(parteCnpj?.trim() || '') || extrairCnpjDoTexto(cnVal);
        } else {
          razao_social = cnVal;
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
          if (!razao_social && attr.shortName === 'CN') razao_social = attr.value as string;
          break;
        }
      }
    }

    if (!cnpj || cnpj.length !== 14) {
      throw new Error(
        'Não foi possível extrair o CNPJ do certificado. Verifique se é um certificado ICP-Brasil válido.'
      );
    }

    const validity = cert.validity;
    const data_validade = validity.notAfter
      ? `${String(validity.notAfter.getDate()).padStart(2, '0')}/${String(validity.notAfter.getMonth() + 1).padStart(2, '0')}/${validity.notAfter.getFullYear()}`
      : null;

    const serial = cert.serialNumber || null;

    let thumbprint: string | null = null;
    try {
      const certDer = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
      const md = forge.md.sha1.create();
      md.update(certDer, 'raw');
      thumbprint = md.digest().toHex().toUpperCase();
    } catch {
      // thumbprint opcional
    }

    return {
      cnpj,
      cnpj_formatado: formatarCnpj(cnpj),
      razao_social: razao_social || `Empresa ${formatarCnpj(cnpj)}`,
      data_validade,
      serial,
      thumbprint,
    };
  } catch (e) {
    const msg = (e as Error).message?.toLowerCase() || '';
    if (msg.includes('password') || msg.includes('mac') || msg.includes('decrypt')) {
      throw new Error('Senha do certificado incorreta');
    }
    logger.error({ err: e }, 'Erro ao parsear certificado');
    throw e;
  }
}
