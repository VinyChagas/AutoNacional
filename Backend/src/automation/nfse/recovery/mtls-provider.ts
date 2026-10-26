/**
 * Conferência local do PKCS#12 antes de qualquer rede.
 * Usa o certificado de cliente cuja chave pública corresponde à chave privada.
 * Não lê o cadastro de certificados e não registra senha nem PFX.
 */
import * as forge from 'node-forge';
import { ErroRecuperacaoSefin, type CredencialMtls } from './types';

export interface ProvedorCredencialMtls {
  obter(cnpj: string): Promise<CredencialMtls>;
}

export function inspecionarCredencialMtls(credencial: CredencialMtls, agora = new Date()): void {
  if (!credencial.pfx?.length) {
    throw new ErroRecuperacaoSefin(
      'CERTIFICADO_INDISPONIVEL',
      'BLOQUEANTE',
      'Certificado A1 indisponível para a consulta SEFIN.'
    );
  }
  if (!credencial.senha.trim()) {
    throw new ErroRecuperacaoSefin(
      'SENHA_INVALIDA',
      'PERMANENTE',
      'Senha do certificado A1 ausente.'
    );
  }

  let notAfter: Date | null = null;
  let notBefore: Date | null = null;
  try {
    // node-forge espera DER. PKCS#12 BER com encoding não canônico pode falhar aqui.
    const asn1 = forge.asn1.fromDer(credencial.pfx.toString('binary'));
    const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, credencial.senha);
    const certificado = certificadoDeCliente(p12);
    if (!certificado) {
      throw new ErroRecuperacaoSefin(
        'CERTIFICADO_INDISPONIVEL',
        'BLOQUEANTE',
        'O PKCS#12 não contém certificado de cliente.'
      );
    }
    notAfter = certificado.validity.notAfter ?? null;
    notBefore = certificado.validity.notBefore ?? null;
  } catch (erro) {
    if (erro instanceof ErroRecuperacaoSefin) throw erro;
    const mensagem = erro instanceof Error ? erro.message.toLowerCase() : '';
    if (mensagem.includes('password') || mensagem.includes('mac') || mensagem.includes('decrypt')) {
      throw new ErroRecuperacaoSefin(
        'SENHA_INVALIDA',
        'PERMANENTE',
        'Senha do certificado A1 recusada.'
      );
    }
    throw new ErroRecuperacaoSefin(
      'CERTIFICADO_INDISPONIVEL',
      'BLOQUEANTE',
      'Não foi possível ler o certificado A1.'
    );
  }

  if (notBefore && notBefore.getTime() > agora.getTime()) {
    throw new ErroRecuperacaoSefin(
      'CERTIFICADO_AINDA_NAO_VALIDO',
      'PERMANENTE',
      'Certificado A1 ainda não válido.'
    );
  }
  if (notAfter && notAfter.getTime() < agora.getTime()) {
    throw new ErroRecuperacaoSefin(
      'CERTIFICADO_EXPIRADO',
      'PERMANENTE',
      'Certificado A1 expirado.'
    );
  }
}

function certificadoDeCliente(p12: forge.pkcs12.Pkcs12Pfx): forge.pki.Certificate | null {
  const chaves = [
    ...bolsas(p12, forge.pki.oids.pkcs8ShroudedKeyBag),
    ...bolsas(p12, forge.pki.oids.keyBag),
  ].flatMap((bolsa) => (bolsa.key ? [bolsa.key] : []));
  const correspondentes = bolsas(p12, forge.pki.oids.certBag).flatMap((bolsa) => {
    if (!bolsa.cert || !chaves.some((chave) => mesmaChaveRsa(bolsa.cert!, chave))) return [];
    return [bolsa.cert];
  });
  return correspondentes.find((certificado) => !ehAutoridadeCertificadora(certificado)) ?? null;
}

function bolsas(p12: forge.pkcs12.Pkcs12Pfx, tipo: string): forge.pkcs12.Bag[] {
  return p12.getBags({ bagType: tipo })[tipo] ?? [];
}

function mesmaChaveRsa(certificado: forge.pki.Certificate, privada: forge.pki.rsa.PrivateKey): boolean {
  const publica = certificado.publicKey;
  if (!('n' in publica) || !publica.n || !privada.n) return false;
  return publica.n.compareTo(privada.n) === 0;
}

function ehAutoridadeCertificadora(certificado: forge.pki.Certificate): boolean {
  const extensao = certificado.getExtension('basicConstraints');
  return Boolean(extensao && typeof extensao === 'object' && 'cA' in extensao && extensao.cA);
}
