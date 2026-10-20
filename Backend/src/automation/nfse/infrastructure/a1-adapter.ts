/**
 * Adaptador A1 → CredencialMtls do Commit 04.
 * Carrega sob demanda. Não retém PFX em variável de módulo.
 * Não registra senha, PFX nem chave privada.
 */
import { normalizarCnpjEmpresa } from '../contracts/documento-fiscal';
import { ContratoNfseError } from '../contracts/erros';
import { inspecionarCredencialMtls, type ProvedorCredencialMtls } from '../recovery/mtls-provider';
import { ErroRecuperacaoSefin, type CredencialMtls } from '../recovery/types';
import { InfraestruturaNfseError, type FonteCertificadoA1 } from './types';

/**
 * Converte a fonte A1 no provedor esperado por `recuperarXmlNfse`.
 * A inspeção PKCS#12 reutiliza o Commit 04 e ocorre só em `obter`.
 */
export class AdaptadorCertificadoA1 implements ProvedorCredencialMtls {
  constructor(private readonly fonte: FonteCertificadoA1) {}

  async obter(cnpj: string): Promise<CredencialMtls> {
    let cnpjNormalizado: string;
    try {
      cnpjNormalizado = normalizarCnpjEmpresa(cnpj);
    } catch (erro) {
      if (erro instanceof ContratoNfseError) {
        throw new InfraestruturaNfseError('CNPJ_INVALIDO', 'CNPJ inválido para carregar o certificado A1.');
      }
      throw erro;
    }

    let material;
    try {
      material = await this.fonte.carregar(cnpjNormalizado);
    } catch (erro) {
      throw mapearErroFonte(erro);
    }

    if (!material?.pfx?.length) {
      throw new InfraestruturaNfseError('CERTIFICADO_INACESSIVEL', 'Certificado A1 inacessível.');
    }
    if (typeof material.passphrase !== 'string' || !material.passphrase) {
      throw new InfraestruturaNfseError('SENHA_INDISPONIVEL', 'Senha do certificado A1 indisponível.');
    }

    // Cópia do PFX: o chamador não muta o buffer original da fonte.
    const credencial: CredencialMtls = {
      pfx: Buffer.from(material.pfx),
      senha: material.passphrase,
    };

    try {
      inspecionarCredencialMtls(credencial);
    } catch (erro) {
      if (erro instanceof ErroRecuperacaoSefin) {
        throw mapearErroInspecao(erro);
      }
      throw new InfraestruturaNfseError('PFX_INVALIDO', 'Não foi possível validar o PKCS#12.');
    }

    return credencial;
  }
}

/**
 * Fonte que delega ao loader operacional `carregarCertificadoPorCnpj`.
 * O import do loader ocorre só na primeira chamada a `carregar`.
 * Não há cache de PFX entre chamadas neste adaptador.
 */
export function criarFonteA1DoCadastro(
  carregar?: (cnpj: string) => Promise<{ pfx: Buffer; passphrase: string }>
): FonteCertificadoA1 {
  let loader = carregar;
  return {
    async carregar(cnpj: string) {
      if (!loader) {
        const modulo = await import('../../../services/certificate-loader');
        loader = modulo.carregarCertificadoPorCnpj;
      }
      return loader(cnpj);
    },
  };
}

export function criarProvedorA1DoCadastro(
  carregar?: (cnpj: string) => Promise<{ pfx: Buffer; passphrase: string }>
): ProvedorCredencialMtls {
  return new AdaptadorCertificadoA1(criarFonteA1DoCadastro(carregar));
}

function mapearErroInspecao(erro: ErroRecuperacaoSefin): InfraestruturaNfseError {
  switch (erro.codigo) {
    case 'SENHA_INVALIDA':
      return new InfraestruturaNfseError('SENHA_INVALIDA', 'Senha do certificado A1 recusada.');
    case 'CERTIFICADO_EXPIRADO':
      return new InfraestruturaNfseError('CERTIFICADO_EXPIRADO', 'Certificado A1 expirado.');
    case 'CERTIFICADO_INDISPONIVEL':
      return new InfraestruturaNfseError('PFX_INVALIDO', 'PKCS#12 inválido ou sem certificado de cliente.');
    default:
      return new InfraestruturaNfseError('PFX_INVALIDO', 'Falha ao inspecionar o certificado A1.');
  }
}

function mapearErroFonte(erro: unknown): InfraestruturaNfseError {
  if (erro instanceof InfraestruturaNfseError) return erro;
  const mensagem = erro instanceof Error ? erro.message : '';
  const baixa = mensagem.toLowerCase();

  if (/cnpj inválido|cnpj invalido/.test(baixa)) {
    return new InfraestruturaNfseError('CNPJ_INVALIDO', 'CNPJ inválido para carregar o certificado A1.');
  }
  if (/certificado não encontrado|certificado nao encontrado/.test(baixa)) {
    return new InfraestruturaNfseError('CERTIFICADO_INEXISTENTE', 'Nenhum certificado A1 associado ao CNPJ.');
  }
  if (/não possui senha|nao possui senha|senha armazenada/.test(baixa)) {
    return new InfraestruturaNfseError('SENHA_INDISPONIVEL', 'Senha do certificado A1 indisponível.');
  }
  if (/descriptografar|crypto_key|app_cred_key/.test(baixa)) {
    return new InfraestruturaNfseError('ERRO_DESCRIPTOGRAFIA', 'Falha ao abrir a senha do certificado.');
  }
  if (/não possui arquivo|nao possui arquivo|arquivo não encontrado|arquivo nao encontrado|falha ao baixar|falha ao ler/.test(baixa)) {
    return new InfraestruturaNfseError('CERTIFICADO_INACESSIVEL', 'Arquivo do certificado A1 inacessível.');
  }
  if (/leitura|enoent|eacces|eisdir/.test(baixa)) {
    return new InfraestruturaNfseError('ERRO_LEITURA', 'Erro de leitura do certificado A1.');
  }
  return new InfraestruturaNfseError('CERTIFICADO_INACESSIVEL', 'Falha ao carregar o certificado A1.');
}
