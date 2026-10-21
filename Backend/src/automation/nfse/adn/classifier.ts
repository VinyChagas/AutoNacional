/**
 * Classificação pós-distribuição: emitida / recebida / intermediada / evento.
 * A API ADN não separa emitidas/recebidas no path.
 */
import type {
  ClassificacaoDocumentoAdn,
  DistribuicaoNsuItem,
  DocumentoDistribuidoAdn,
  PapelFiscalAdn,
} from './types';
import { extrairCamposXmlAdn, identificarPapeisAdn, normalizarCompetenciaAdn } from './xml-extract';
import { decodificarArquivoXmlAdn } from './xml-decode';
import { LIMITES_ADN_PADRAO } from './types';

export function classificarDocumentoDistribuido(params: {
  empresaCnpj: string;
  item: DistribuicaoNsuItem;
  papeis: PapelFiscalAdn[];
  pareceEvento: boolean;
  tipoEvento?: string | null;
}): ClassificacaoDocumentoAdn {
  const tipoApi = params.item.TipoDocumento;

  if (
    tipoApi === 'EVENTO' ||
    Boolean(params.item.TipoEvento) ||
    Boolean(params.tipoEvento) ||
    params.pareceEvento
  ) {
    return 'evento';
  }

  if (tipoApi && tipoApi !== 'NFSE' && tipoApi !== 'NENHUM') {
    return 'nao_classificado';
  }

  if (params.papeis.includes('emitente')) return 'emitida';
  if (params.papeis.includes('tomador')) return 'recebida';
  if (params.papeis.includes('intermediario')) return 'intermediada';
  return 'nao_classificado';
}

export async function processarItemDistribuicao(params: {
  empresaCnpj: string;
  item: DistribuicaoNsuItem;
  limites?: { maxBytesGzip: number; maxBytesXml: number };
}): Promise<DocumentoDistribuidoAdn> {
  const limites = params.limites ?? LIMITES_ADN_PADRAO;
  const item = params.item;

  if (!item.ArquivoXml) {
    return {
      nsu: item.NSU ?? undefined,
      chaveAcesso: item.ChaveAcesso ?? undefined,
      tipoDocumento: item.TipoDocumento,
      tipoEvento: item.TipoEvento ?? undefined,
      classificacao:
        item.TipoDocumento === 'EVENTO' || item.TipoEvento ? 'evento' : 'nao_classificado',
      papeis: [],
      sha256: '',
      xmlValido: false,
      dataHoraGeracao: item.DataHoraGeracao ?? undefined,
    };
  }

  let xml: string;
  try {
    xml = await decodificarArquivoXmlAdn(item.ArquivoXml, limites);
  } catch {
    return {
      nsu: item.NSU ?? undefined,
      chaveAcesso: item.ChaveAcesso ?? undefined,
      tipoDocumento: item.TipoDocumento,
      tipoEvento: item.TipoEvento ?? undefined,
      classificacao: 'nao_classificado',
      papeis: [],
      sha256: '',
      xmlValido: false,
      dataHoraGeracao: item.DataHoraGeracao ?? undefined,
    };
  }

  const campos = extrairCamposXmlAdn(xml);
  const papeis = identificarPapeisAdn(params.empresaCnpj, campos);
  const classificacao = classificarDocumentoDistribuido({
    empresaCnpj: params.empresaCnpj,
    item,
    papeis,
    pareceEvento: campos.pareceEvento,
    tipoEvento: campos.tipoEvento ?? item.TipoEvento,
  });

  const chave =
    campos.chave ??
    (item.ChaveAcesso ? item.ChaveAcesso.replace(/\D/g, '') : undefined) ??
    undefined;

  return {
    nsu: item.NSU ?? undefined,
    chaveAcesso: chave,
    tipoDocumento: item.TipoDocumento,
    tipoEvento: campos.tipoEvento ?? item.TipoEvento ?? undefined,
    classificacao,
    papeis,
    cnpjPrestador: campos.cnpjEmitente ?? undefined,
    cnpjTomador: campos.cnpjTomador ?? undefined,
    cnpjIntermediario: campos.cnpjIntermediario ?? undefined,
    competencia: normalizarCompetenciaAdn(campos.dCompet),
    sha256: campos.sha256,
    xmlValido: Boolean(chave) || campos.bemFormado,
    xml,
    dataHoraGeracao: item.DataHoraGeracao ?? undefined,
  };
}
