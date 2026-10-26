/**
 * Interpreta o JSON da SEFIN e devolve o XML descomprimido com limite de tamanho.
 */
import zlib from 'node:zlib';
import { ErroRecuperacaoSefin, type ClasseErroRecuperacao } from './types';

export function classificarStatusHttp(
  status: number
): { codigo: string; classe: ClasseErroRecuperacao; mensagem: string } | null {
  if (status === 200) return null;
  if (status === 400) {
    return { codigo: 'HTTP_400', classe: 'PERMANENTE', mensagem: 'A SEFIN recusou a consulta.' };
  }
  if (status === 401) {
    return { codigo: 'HTTP_401', classe: 'BLOQUEANTE', mensagem: 'A SEFIN não autenticou o certificado.' };
  }
  if (status === 403) {
    return { codigo: 'HTTP_403', classe: 'BLOQUEANTE', mensagem: 'A SEFIN recusou a autorização da consulta.' };
  }
  if (status === 404) {
    return { codigo: 'HTTP_404', classe: 'PERMANENTE', mensagem: 'A SEFIN não encontrou a NFS-e.' };
  }
  if (status === 429) {
    return { codigo: 'HTTP_429', classe: 'TRANSITORIO', mensagem: 'A SEFIN limitou o ritmo da consulta.' };
  }
  if (status === 500 || status === 502 || status === 503 || status >= 500) {
    return { codigo: `HTTP_${status}`, classe: 'TRANSITORIO', mensagem: 'A SEFIN respondeu com falha temporária.' };
  }
  return { codigo: `HTTP_${status}`, classe: 'PERMANENTE', mensagem: 'Resposta HTTP não reconhecida da SEFIN.' };
}

export async function extrairXmlDaRespostaSefin(body: Buffer, maxBytesGzip: number, maxBytesXml: number): Promise<string> {
  const texto = body.toString('utf8').trim();
  if (!texto) {
    throw new ErroRecuperacaoSefin('JSON_INVALIDO', 'PERMANENTE', 'Resposta vazia da SEFIN.');
  }
  if (/<html[\s>]/i.test(texto)) {
    throw new ErroRecuperacaoSefin('HTML_NO_LUGAR_DE_XML', 'PERMANENTE', 'A SEFIN devolveu HTML no lugar do JSON.');
  }

  let json: unknown;
  try {
    json = JSON.parse(texto);
  } catch {
    throw new ErroRecuperacaoSefin('JSON_INVALIDO', 'PERMANENTE', 'Resposta da SEFIN não é JSON.');
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new ErroRecuperacaoSefin('JSON_INVALIDO', 'PERMANENTE', 'JSON da SEFIN sem objeto de sucesso.');
  }

  const campo = (json as Record<string, unknown>).nfseXmlGZipB64;
  if (typeof campo !== 'string' || !campo.trim()) {
    throw new ErroRecuperacaoSefin(
      'CAMPO_XML_AUSENTE',
      'PERMANENTE',
      'A resposta não contém nfseXmlGZipB64.'
    );
  }
  return descomprimirCampoXml(campo, maxBytesGzip, maxBytesXml);
}

export async function descomprimirCampoXml(campo: string, maxBytesGzip: number, maxBytesXml: number): Promise<string> {
  const compacto = campo.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/=]+$/.test(compacto) || compacto.length % 4 !== 0) {
    throw new ErroRecuperacaoSefin('BASE64_INVALIDO', 'PERMANENTE', 'nfseXmlGZipB64 não é Base64 válido.');
  }
  const gzip = Buffer.from(compacto, 'base64');
  if (!gzip.length || gzip.length > maxBytesGzip || gzip[0] !== 0x1f || gzip[1] !== 0x8b) {
    throw new ErroRecuperacaoSefin('GZIP_INVALIDO', 'PERMANENTE', 'O conteúdo não é GZIP válido.');
  }
  const xml = (await descomprimirGzipLimitado(gzip, maxBytesXml)).toString('utf8');
  if (!xml.trim()) {
    throw new ErroRecuperacaoSefin('XML_VAZIO', 'PERMANENTE', 'O XML descomprimido está vazio.');
  }
  return xml;
}

function descomprimirGzipLimitado(entrada: Buffer, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const gunzip = zlib.createGunzip();
    const partes: Buffer[] = [];
    let total = 0;
    let encerrado = false;

    const falhar = (erro: ErroRecuperacaoSefin) => {
      if (encerrado) return;
      encerrado = true;
      gunzip.destroy();
      reject(erro);
    };

    gunzip.on('data', (pedaço: Buffer) => {
      total += pedaço.length;
      if (total > maxBytes) {
        falhar(
          new ErroRecuperacaoSefin(
            'LIMITE_XML',
            'PERMANENTE',
            'O XML descomprimido excede o limite configurado.'
          )
        );
        return;
      }
      partes.push(pedaço);
    });
    gunzip.on('error', () => {
      falhar(new ErroRecuperacaoSefin('GZIP_INVALIDO', 'PERMANENTE', 'Não foi possível descomprimir o GZIP.'));
    });
    gunzip.on('end', () => {
      if (encerrado) return;
      encerrado = true;
      resolve(Buffer.concat(partes, total));
    });
    gunzip.end(entrada);
  });
}
