/**
 * Decodifica ArquivoXml da distribuição (GZip + Base64).
 * Reutiliza a rotina limitada já usada na recuperação SEFIN.
 */
import { descomprimirCampoXml } from '../recovery/response-parser';
import { ErroAdn } from './errors';
import { LIMITES_ADN_PADRAO } from './types';

export async function decodificarArquivoXmlAdn(
  arquivoXml: string,
  limites: { maxBytesGzip: number; maxBytesXml: number } = LIMITES_ADN_PADRAO
): Promise<string> {
  const trimmed = arquivoXml.trim();
  if (!trimmed) {
    throw new ErroAdn('XML_VAZIO', 'PERMANENTE', 'Campo ArquivoXml vazio.');
  }

  // Já é XML plaintext (fixture / edge case).
  if (trimmed.startsWith('<') || trimmed.startsWith('<?xml')) {
    if (/<!DOCTYPE/i.test(trimmed) || /<!ENTITY/i.test(trimmed)) {
      throw new ErroAdn('XML_ENTIDADE_EXTERNA', 'PERMANENTE', 'XML com DOCTYPE/ENTITY recusado.');
    }
    return trimmed;
  }

  try {
    return await descomprimirCampoXml(trimmed, limites.maxBytesGzip, limites.maxBytesXml);
  } catch (erro) {
    // Fallback: base64 sem gzip → texto XML.
    try {
      const buf = Buffer.from(trimmed.replace(/\s+/g, ''), 'base64');
      const asText = buf.toString('utf8');
      if (asText.trim().startsWith('<')) {
        if (/<!DOCTYPE/i.test(asText) || /<!ENTITY/i.test(asText)) {
          throw new ErroAdn('XML_ENTIDADE_EXTERNA', 'PERMANENTE', 'XML com DOCTYPE/ENTITY recusado.');
        }
        return asText;
      }
    } catch (inner) {
      if (inner instanceof ErroAdn) throw inner;
    }
    const msg = erro instanceof Error ? erro.message : 'Falha ao decodificar ArquivoXml.';
    throw new ErroAdn('ARQUIVO_XML_INVALIDO', 'PERMANENTE', msg);
  }
}
