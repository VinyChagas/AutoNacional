/**
 * XML da NFS-e em diretório próprio, fora da pasta operacional de downloads.
 * O nome do arquivo sai da chave de 50 dígitos. Hash diferente não sobrescreve.
 * A gravação exige validação fiscal CONFIRMADA via validarXmlNfse (Commit 04).
 * A chave no texto arbitrário não basta. O hash não prova validade fiscal.
 */
import { createHash } from 'node:crypto';
import { open, readFile, type FileHandle } from 'node:fs/promises';
import type { DirecaoDocumentoFiscal } from '../contracts/documento-fiscal';
import type { PeriodoConsultaPortal } from '../contracts/periodo';
import { ErroRecuperacaoSefin } from '../recovery/types';
import { validarXmlNfse } from '../recovery/xml-validator';
import { escreverArquivoAtomico } from './checkpoint-store';
import {
  CheckpointNfseError,
  resolverCaminhoSeguro,
  segmentoPeriodo,
  type ArquivoVerificadoNfse,
  type OpcoesEscritaAtomica,
} from './types';

export interface ResultadoPersistenciaXml {
  hashSha256: string;
  caminhoRelativo: string;
  tamanhoBytes: number;
  reutilizado: boolean;
}

/** Leitura do XML órfão. Arquivo acima do limite não entra na memória. */
export type LeituraXmlLimitada =
  | { situacao: 'ausente'; tamanhoBytes: 0 }
  | { situacao: 'excede_limite'; tamanhoBytes: number }
  | { situacao: 'leitura_incompleta'; tamanhoBytes: number }
  | { situacao: 'lido'; conteudo: Buffer; tamanhoBytes: number; hashSha256: string };

export function hashSha256Conteudo(conteudo: Buffer): string {
  return createHash('sha256').update(conteudo).digest('hex');
}

export class XmlStore {
  constructor(
    private readonly raiz: string,
    private readonly ganchos?: OpcoesEscritaAtomica
  ) {
    if (typeof raiz !== 'string' || !raiz.trim()) {
      throw new CheckpointNfseError('CAMINHO_INVALIDO', 'Raiz do XML ausente.');
    }
  }

  caminhoRelativo(cnpj: string, periodo: PeriodoConsultaPortal, chaveNacional: string): string {
    const partes = partesSeguras(cnpj, periodo, chaveNacional);
    return `${partes[0]}/${partes[1]}/${partes[2]}`;
  }

  caminhoArquivo(cnpj: string, periodo: PeriodoConsultaPortal, chaveNacional: string): string {
    return resolverCaminhoSeguro(this.raiz, partesSeguras(cnpj, periodo, chaveNacional));
  }

  /**
   * Exige validação fiscal CONFIRMADA antes de qualquer escrita.
   * Mesmo hash reutiliza o arquivo. Hash diferente é conflito e o arquivo fica intacto.
   * A escrita nova só passa a valer depois do fsync e do rename no mesmo diretório.
   */
  async persistir(
    cnpj: string,
    periodo: PeriodoConsultaPortal,
    chaveNacional: string,
    xml: string,
    direcao: DirecaoDocumentoFiscal
  ): Promise<ResultadoPersistenciaXml> {
    const relativo = this.caminhoRelativo(cnpj, periodo, chaveNacional);
    const destino = this.caminhoArquivo(cnpj, periodo, chaveNacional);
    const conteudo = exigirXmlConfirmado(xml, {
      chave: chaveNacional,
      cnpj,
      direcao,
    });
    const hashNovo = hashSha256Conteudo(conteudo);
    const existente = await this.lerSeExistir(destino);
    if (existente) {
      const hashAtual = hashSha256Conteudo(existente);
      if (existente.length > 0 && hashAtual === hashNovo) {
        return {
          hashSha256: hashAtual,
          caminhoRelativo: relativo,
          tamanhoBytes: existente.length,
          reutilizado: true,
        };
      }
      throw new CheckpointNfseError(
        'CONFLITO_HASH',
        'XML já existente tem hash diferente. O arquivo não foi sobrescrito.'
      );
    }

    await escreverArquivoAtomico(destino, conteudo, this.ganchos);
    const lido = await readFile(destino);
    const hashLido = hashSha256Conteudo(lido);
    if (lido.length === 0 || hashLido !== hashNovo) {
      throw new CheckpointNfseError('FALHA_ESCRITA', 'O XML gravado não conferiu o hash.');
    }
    return {
      hashSha256: hashLido,
      caminhoRelativo: relativo,
      tamanhoBytes: lido.length,
      reutilizado: false,
    };
  }

  /**
   * Lê o XML da chave com teto de bytes.
   * O tamanho é conferido antes de alocar o buffer. Acima do teto, o conteúdo não é lido.
   */
  async lerLimitado(
    cnpj: string,
    periodo: PeriodoConsultaPortal,
    chaveNacional: string,
    maxBytes: number
  ): Promise<LeituraXmlLimitada> {
    if (!Number.isInteger(maxBytes) || maxBytes < 1) {
      throw new CheckpointNfseError('CAMINHO_INVALIDO', 'Limite de leitura do XML inválido.');
    }
    const destino = this.caminhoArquivo(cnpj, periodo, chaveNacional);
    let arquivo: FileHandle | null = null;
    try {
      arquivo = await open(destino, 'r');
      const info = await arquivo.stat();
      if (!info.isFile()) {
        throw new CheckpointNfseError('FALHA_LEITURA', 'O caminho do XML não é um arquivo.');
      }
      if (info.size > maxBytes) {
        return { situacao: 'excede_limite', tamanhoBytes: info.size };
      }
      if (info.size === 0) {
        const vazio = Buffer.alloc(0);
        return { situacao: 'lido', conteudo: vazio, tamanhoBytes: 0, hashSha256: hashSha256Conteudo(vazio) };
      }
      const conteudo = Buffer.alloc(info.size);
      const lido = await arquivo.read(conteudo, 0, info.size, 0);
      if (lido.bytesRead !== info.size) {
        return { situacao: 'leitura_incompleta', tamanhoBytes: info.size };
      }
      const depois = await arquivo.stat();
      if (depois.size !== info.size) {
        return { situacao: 'leitura_incompleta', tamanhoBytes: depois.size };
      }
      return {
        situacao: 'lido',
        conteudo,
        tamanhoBytes: conteudo.length,
        hashSha256: hashSha256Conteudo(conteudo),
      };
    } catch (erro) {
      if ((erro as NodeJS.ErrnoException).code === 'ENOENT') {
        return { situacao: 'ausente', tamanhoBytes: 0 };
      }
      if (erro instanceof CheckpointNfseError) throw erro;
      throw new CheckpointNfseError('FALHA_LEITURA', 'Falha ao ler XML.');
    } finally {
      await arquivo?.close().catch(() => undefined);
    }
  }

  async verificar(
    cnpj: string,
    periodo: PeriodoConsultaPortal,
    chaveNacional: string
  ): Promise<ArquivoVerificadoNfse> {
    const destino = this.caminhoArquivo(cnpj, periodo, chaveNacional);
    const existente = await this.lerSeExistir(destino);
    if (!existente) {
      return { chaveNacional, existe: false, tamanhoBytes: 0, hashSha256: null };
    }
    return {
      chaveNacional,
      existe: true,
      tamanhoBytes: existente.length,
      hashSha256: hashSha256Conteudo(existente),
    };
  }

  private async lerSeExistir(destino: string): Promise<Buffer | null> {
    try {
      return await readFile(destino);
    } catch (erro) {
      if ((erro as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new CheckpointNfseError('FALHA_LEITURA', 'Falha ao ler XML.');
    }
  }
}

function partesSeguras(cnpj: string, periodo: PeriodoConsultaPortal, chaveNacional: string): [string, string, string] {
  if (!/^\d{14}$/.test(cnpj)) {
    throw new CheckpointNfseError('CAMINHO_INVALIDO', 'CNPJ não pode compor caminho.');
  }
  if (!/^\d{50}$/.test(chaveNacional)) {
    throw new CheckpointNfseError('CAMINHO_INVALIDO', 'Chave não pode compor nome de arquivo.');
  }
  return [cnpj, segmentoPeriodo(periodo), `${chaveNacional}.xml`];
}

/**
 * Só libera a gravação com validação CONFIRMADA do Commit 04.
 * Chave como substring no texto não basta. Hash não é prova fiscal.
 */
function exigirXmlConfirmado(
  xml: string,
  esperado: { chave: string; cnpj: string; direcao: DirecaoDocumentoFiscal }
): Buffer {
  if (typeof xml !== 'string' || !xml.trim()) {
    throw new CheckpointNfseError('XML_VAZIO', 'XML vazio.');
  }
  let leitura;
  try {
    leitura = validarXmlNfse(xml, esperado);
  } catch (erro) {
    if (erro instanceof ErroRecuperacaoSefin) {
      throw new CheckpointNfseError(erro.codigo, erro.message);
    }
    throw erro;
  }
  if (leitura.validacao !== 'CONFIRMADA' || leitura.chaveXml !== esperado.chave) {
    throw new CheckpointNfseError(
      'XML_NAO_CONFIRMADO',
      'A validação fiscal não confirmou a estrutura da NFS-e. O XML não foi gravado.'
    );
  }
  return Buffer.from(xml, 'utf8');
}
