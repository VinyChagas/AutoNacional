/**
 * Exporta XMLs ADN persistidos para o contrato operacional de downloads
 * (mesmo de Playwright): {base}/{contabilidade}/{mes-extenso-ano}/{empresa}/{Emitidas|Recebidas}/
 *
 * Nunca move/apaga originais ADN. Idempotente. Não sobrescreve conteúdo divergente.
 * Eventos/intermediadas ficam fora de Emitidas/Recebidas (contrato montarCaminhoCompleto).
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  montarCaminhoCompleto,
  sanitizarNomeArquivo,
  validarArquivoBaixado,
} from '../../download-manager';
import type { AmbienteAdn } from './endpoints';
import { ErroAdn } from './errors';
import { listarCompetenciasDoPeriodo } from './inventario-persistido';

export type TipoNotaOperacionalAdn = 'Emitidas' | 'Recebidas';

export interface XmlAdnParaExportacao {
  competencia: string;
  tipoNota: TipoNotaOperacionalAdn;
  caminhoOrigem: string;
  nomeArquivo: string;
}

export interface EntradaExportacaoDownloadsAdn {
  cnpj: string;
  ambiente: AmbienteAdn;
  /** Raiz de documentos ADN (…/documentos). */
  raizDocumentosAdn: string;
  dataInicio: string;
  dataFim: string;
  downloadsBasePath: string;
  nomeContabilidade: string;
  /** Pasta do mês da execução (ex.: outubro-2026) — mesmo contrato Playwright. */
  mesExecucaoExtenso: string;
  nomeEmpresa: string;
}

export interface ResultadoExportacaoDownloadsAdn {
  ok: boolean;
  codigoErro: string | null;
  motivo: string;
  competencias: string[];
  destinoEmitidas: string;
  destinoRecebidas: string;
  encontrados: number;
  copiados: number;
  jaIguais: number;
  omitidosEventos: number;
  omitidosIntermediadas: number;
  omitidosOutros: number;
  conflitos: number;
  falhasEscrita: number;
  /** Caminhos operacionais gravados ou já idênticos (para asserts). */
  caminhosOperacionais: string[];
}

function baseCnpjAmbiente(raizDocumentos: string, cnpj: string, ambiente: AmbienteAdn): string {
  const digitos = cnpj.replace(/\D/g, '');
  if (!/^\d{14}$/.test(digitos)) {
    throw new ErroAdn('CNPJ_INVALIDO', 'PERMANENTE', 'CNPJ inválido para exportação ADN.');
  }
  if (ambiente !== 'producao' && ambiente !== 'producao-restrita') {
    throw new ErroAdn('AMBIENTE_INVALIDO', 'PERMANENTE', 'Ambiente ADN inválido.');
  }
  return path.join(path.resolve(raizDocumentos), digitos, ambiente);
}

function listarXmlsEmPasta(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.xml'))
      .map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
}

/**
 * Lista XMLs Emitidas/Recebidas nas competências do período (somente leitura).
 * Eventos/Intermediadas/outros são contabilizados como omitidos pelo chamador.
 */
export function listarXmlsAdnCompetenciaOperacional(params: {
  raizDocumentosAdn: string;
  cnpj: string;
  ambiente: AmbienteAdn;
  dataInicio: string;
  dataFim: string;
}): {
  xmls: XmlAdnParaExportacao[];
  omitidosEventos: number;
  omitidosIntermediadas: number;
  omitidosOutros: number;
  competencias: string[];
} {
  const competencias = listarCompetenciasDoPeriodo(params.dataInicio, params.dataFim);
  const base = baseCnpjAmbiente(params.raizDocumentosAdn, params.cnpj, params.ambiente);
  const xmls: XmlAdnParaExportacao[] = [];
  let omitidosEventos = 0;
  let omitidosIntermediadas = 0;
  let omitidosOutros = 0;

  for (const comp of competencias) {
    const m = /^(\d{4})-(\d{2})$/.exec(comp);
    if (!m) continue;
    const dirComp = path.join(base, m[1]!, m[2]!);

    for (const origem of listarXmlsEmPasta(path.join(dirComp, 'Emitidas'))) {
      xmls.push({
        competencia: comp,
        tipoNota: 'Emitidas',
        caminhoOrigem: origem,
        nomeArquivo: sanitizarNomeArquivo(path.basename(origem)),
      });
    }
    for (const origem of listarXmlsEmPasta(path.join(dirComp, 'Recebidas'))) {
      xmls.push({
        competencia: comp,
        tipoNota: 'Recebidas',
        caminhoOrigem: origem,
        nomeArquivo: sanitizarNomeArquivo(path.basename(origem)),
      });
    }

    omitidosEventos += listarXmlsEmPasta(path.join(dirComp, 'Eventos')).length;
    omitidosIntermediadas += listarXmlsEmPasta(path.join(dirComp, 'Intermediadas')).length;
    omitidosOutros += listarXmlsEmPasta(path.join(dirComp, '_nao_classificados')).length;
    omitidosOutros += listarXmlsEmPasta(path.join(dirComp, '_xml_invalidos')).length;
  }

  return { xmls, omitidosEventos, omitidosIntermediadas, omitidosOutros, competencias };
}

async function arquivosIdenticos(a: string, b: string): Promise<boolean> {
  const [ba, bb] = await Promise.all([fsp.readFile(a), fsp.readFile(b)]);
  return ba.equals(bb);
}

/**
 * Copia um XML ADN → pasta operacional sem apagar a origem.
 * - destino ausente → copia
 * - destino idêntico → noop (idempotente)
 * - destino divergente → conflito (não sobrescreve)
 */
export async function exportarXmlAdnIdempotente(
  caminhoOrigem: string,
  caminhoDestino: string
): Promise<'copiado' | 'ja_igual' | 'conflito' | 'erro_escrita'> {
  try {
    if (!fs.existsSync(caminhoOrigem)) return 'erro_escrita';
    await fsp.mkdir(path.dirname(caminhoDestino), { recursive: true });
    if (fs.existsSync(caminhoDestino)) {
      if (await arquivosIdenticos(caminhoOrigem, caminhoDestino)) return 'ja_igual';
      return 'conflito';
    }
    // copyFile não remove origem; falha se destino aparecer no meio (wx-like via flag).
    await fsp.copyFile(caminhoOrigem, caminhoDestino);
    // Confirma que origem permanece.
    if (!fs.existsSync(caminhoOrigem)) return 'erro_escrita';
    return 'copiado';
  } catch {
    return 'erro_escrita';
  }
}

/**
 * Exporta XMLs ADN da competência solicitada para o diretório operacional AutoNacional.
 */
export async function exportarAdnParaDownloadsOperacionais(
  entrada: EntradaExportacaoDownloadsAdn
): Promise<ResultadoExportacaoDownloadsAdn> {
  const destinoEmitidas = montarCaminhoCompleto(
    entrada.downloadsBasePath,
    entrada.nomeContabilidade,
    entrada.mesExecucaoExtenso,
    entrada.nomeEmpresa,
    'Emitidas'
  );
  const destinoRecebidas = montarCaminhoCompleto(
    entrada.downloadsBasePath,
    entrada.nomeContabilidade,
    entrada.mesExecucaoExtenso,
    entrada.nomeEmpresa,
    'Recebidas'
  );

  let listagem: ReturnType<typeof listarXmlsAdnCompetenciaOperacional>;
  try {
    listagem = listarXmlsAdnCompetenciaOperacional({
      raizDocumentosAdn: entrada.raizDocumentosAdn,
      cnpj: entrada.cnpj,
      ambiente: entrada.ambiente,
      dataInicio: entrada.dataInicio,
      dataFim: entrada.dataFim,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Falha ao listar XMLs ADN.';
    return {
      ok: false,
      codigoErro: e instanceof ErroAdn ? e.codigo : 'ADN_EXPORT_LISTAGEM',
      motivo: msg,
      competencias: [],
      destinoEmitidas,
      destinoRecebidas,
      encontrados: 0,
      copiados: 0,
      jaIguais: 0,
      omitidosEventos: 0,
      omitidosIntermediadas: 0,
      omitidosOutros: 0,
      conflitos: 0,
      falhasEscrita: 0,
      caminhosOperacionais: [],
    };
  }

  let copiados = 0;
  let jaIguais = 0;
  let conflitos = 0;
  let falhasEscrita = 0;
  const caminhosOperacionais: string[] = [];

  for (const item of listagem.xmls) {
    const destDir = item.tipoNota === 'Emitidas' ? destinoEmitidas : destinoRecebidas;
    const destino = path.join(destDir, item.nomeArquivo);
    const r = await exportarXmlAdnIdempotente(item.caminhoOrigem, destino);
    if (r === 'copiado') {
      copiados += 1;
      caminhosOperacionais.push(destino);
    } else if (r === 'ja_igual') {
      jaIguais += 1;
      caminhosOperacionais.push(destino);
    } else if (r === 'conflito') {
      conflitos += 1;
    } else {
      falhasEscrita += 1;
    }
  }

  const ok = conflitos === 0 && falhasEscrita === 0;
  const motivo = ok
    ? `Exportação ADN→downloads OK: encontrados=${listagem.xmls.length} copiados=${copiados} ` +
      `já_iguais=${jaIguais}; omitidos eventos=${listagem.omitidosEventos} ` +
      `intermediadas=${listagem.omitidosIntermediadas} outros=${listagem.omitidosOutros}.`
    : `Exportação ADN→downloads FALHOU: conflitos=${conflitos} falhasEscrita=${falhasEscrita}. ` +
      `Execução não pode ser concluída. Originais ADN preservados.`;

  return {
    ok,
    codigoErro: ok ? null : 'ADN_EXPORT_FALHOU',
    motivo,
    competencias: listagem.competencias,
    destinoEmitidas,
    destinoRecebidas,
    encontrados: listagem.xmls.length,
    copiados,
    jaIguais,
    omitidosEventos: listagem.omitidosEventos,
    omitidosIntermediadas: listagem.omitidosIntermediadas,
    omitidosOutros: listagem.omitidosOutros,
    conflitos,
    falhasEscrita,
    caminhosOperacionais,
  };
}

/** Valida que caminhos operacionais passam no contrato validarArquivoBaixado (XML). */
export async function validarXmlsOperacionaisExportados(
  caminhos: string[]
): Promise<{ ok: boolean; invalidos: string[] }> {
  const invalidos: string[] = [];
  for (const c of caminhos) {
    const v = await validarArquivoBaixado(c, 'xml');
    if (!v.valid) invalidos.push(c);
  }
  return { ok: invalidos.length === 0, invalidos };
}
