/**
 * Identidade CNPJ do certificado A1 (PKCS#12) vs cnpjConsulta.
 * Não registra PFX nem senha.
 */
import * as forge from 'node-forge';
import type { CredencialMtls } from '../recovery/types';
import { ErroAdn } from './errors';

function apenasDigitos(texto: string): string {
  return texto.replace(/\D/g, '');
}

function extrairCnpjDoTexto(texto: string): string | null {
  if (!texto?.trim()) return null;
  const limpo = apenasDigitos(texto);
  if (limpo.length === 14 && limpo !== '00000000000000') return limpo;
  const match = texto.match(/(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})|\b(\d{14})\b/);
  if (match) {
    const cnpj = apenasDigitos(match[1] || match[2] || '');
    if (cnpj.length === 14) return cnpj;
  }
  return null;
}

function certificadoDeCliente(p12: forge.pkcs12.Pkcs12Pfx): forge.pki.Certificate | null {
  const chaves = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[
      forge.pki.oids.pkcs8ShroudedKeyBag
    ] ?? []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? []),
  ].flatMap((bolsa) => (bolsa.key ? [bolsa.key] : []));

  const certs =
    p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
  const correspondentes = certs.flatMap((bolsa) => {
    if (!bolsa.cert) return [];
    const publica = bolsa.cert.publicKey;
    const ok = chaves.some((chave) => {
      if (!('n' in publica) || !publica.n || !chave.n) return false;
      return publica.n.compareTo(chave.n) === 0;
    });
    return ok ? [bolsa.cert] : [];
  });
  return (
    correspondentes.find((c) => {
      const ext = c.getExtension('basicConstraints');
      return !(ext && typeof ext === 'object' && 'cA' in ext && ext.cA);
    }) ?? null
  );
}

/**
 * Extrai o CNPJ do subject do certificado de cliente no PFX.
 */
export function extrairCnpjDoCertificadoA1(credencial: CredencialMtls): string {
  if (!credencial.pfx?.length) {
    throw new ErroAdn('CERTIFICADO_INDISPONIVEL', 'BLOQUEANTE', 'Certificado A1 indisponível.');
  }
  if (!credencial.senha?.trim()) {
    throw new ErroAdn('SENHA_INVALIDA', 'BLOQUEANTE', 'Senha do certificado A1 ausente.');
  }

  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const asn1 = forge.asn1.fromDer(credencial.pfx.toString('binary'));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, credencial.senha);
  } catch (erro) {
    const msg = erro instanceof Error ? erro.message.toLowerCase() : '';
    if (msg.includes('password') || msg.includes('mac') || msg.includes('decrypt')) {
      throw new ErroAdn('SENHA_INVALIDA', 'BLOQUEANTE', 'Senha do certificado A1 recusada.');
    }
    throw new ErroAdn('CERTIFICADO_INDISPONIVEL', 'BLOQUEANTE', 'Não foi possível ler o certificado A1.');
  }

  const cert = certificadoDeCliente(p12);
  if (!cert) {
    throw new ErroAdn(
      'CERTIFICADO_INDISPONIVEL',
      'BLOQUEANTE',
      'PKCS#12 sem certificado de cliente.'
    );
  }

  let cnpj: string | null = null;
  for (const attr of cert.subject.attributes) {
    const valor = String(attr.value ?? '');
    if (attr.shortName === 'CN' || attr.name === 'commonName') {
      if (valor.includes(':')) {
        const parte = valor.split(':', 2)[1] ?? '';
        cnpj = extrairCnpjDoTexto(parte) || extrairCnpjDoTexto(valor);
      } else {
        cnpj = extrairCnpjDoTexto(valor);
      }
      if (cnpj) break;
    }
  }
  if (!cnpj) {
    for (const attr of cert.subject.attributes) {
      cnpj = extrairCnpjDoTexto(String(attr.value ?? ''));
      if (cnpj) break;
    }
  }
  if (!cnpj) {
    throw new ErroAdn(
      'CNPJ_CERTIFICADO_AUSENTE',
      'BLOQUEANTE',
      'Não foi possível extrair o CNPJ da identidade do certificado A1.'
    );
  }
  return cnpj;
}

/**
 * Exige igualdade dos 14 dígitos entre cnpjConsulta e o CNPJ do certificado.
 */
export function assertCnpjCompativelComCertificado(
  cnpjConsulta: string,
  credencial: CredencialMtls
): { cnpjConsulta: string; cnpjCertificado: string } {
  const consulta = apenasDigitos(cnpjConsulta);
  if (!/^\d{14}$/.test(consulta)) {
    throw new ErroAdn('CNPJ_INVALIDO', 'PERMANENTE', 'cnpjConsulta deve ter 14 dígitos.');
  }
  const cnpjCertificado = extrairCnpjDoCertificadoA1(credencial);
  if (consulta !== cnpjCertificado) {
    throw new ErroAdn(
      'CNPJ_INCOMPATIVEL',
      'BLOQUEANTE',
      'CNPJ consultado diverge da identidade do certificado A1.'
    );
  }
  return { cnpjConsulta: consulta, cnpjCertificado };
}
