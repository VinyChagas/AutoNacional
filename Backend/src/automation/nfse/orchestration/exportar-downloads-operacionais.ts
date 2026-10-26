/**
 * Exporta XMLs fiscais (SEFIN) para o diretório operacional AutoNacional.
 * Vigentes → Emitidas/Recebidas.
 * API-03M — indeterminadas documentamente válidas → Pendentes_Validacao_Fiscal.
 * Nunca move/apaga originais fiscais. Idempotente. Não sobrescreve divergente.
 * Exportação NÃO depende de reconciliação fiscal 100%.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  montarCaminhoCompleto,
  sanitizarNomeArquivo,
  validarArquivoBaixado,
} from '../../download-manager';
import { exportarXmlAdnIdempotente } from '../adn/exportar-downloads-operacionais';
import type { DocumentoExportavelNfse } from '../infrastructure/types';
import type { RepositorioFiscalNfse } from '../infrastructure/fiscal-repository';
import type { InventarioNfse } from '../contracts/inventario';
import type { PeriodoConsultaPortal } from '../contracts/periodo';

export const PASTA_PENDENTES_VALIDACAO_FISCAL = 'Pendentes_Validacao_Fiscal';
/** API-03O — vigentes com vínculo intermediário (não misturar com Recebidas). */
export const PASTA_INTERMEDIADAS = 'Intermediadas';

export interface EntradaExportacaoDownloadsSefin {
  inventario: InventarioNfse;
  documentosAptos: readonly DocumentoExportavelNfse[];
  /** API-03M — indeterminadas com XML válido. */
  documentosPendentesFiscais?: readonly DocumentoExportavelNfse[];
  repositorio: RepositorioFiscalNfse;
  periodoConsulta: PeriodoConsultaPortal;
  downloadsBasePath: string;
  nomeContabilidade: string;
  mesExecucaoExtenso: string;
  nomeEmpresa: string;
}

export interface ResultadoExportacaoDownloadsSefin {
  ok: boolean;
  codigoErro: string | null;
  motivo: string;
  destinoEmitidas: string;
  destinoRecebidas: string;
  destinoIntermediadas: string;
  destinoPendentes: string;
  encontrados: number;
  copiados: number;
  jaIguais: number;
  conflitos: number;
  falhasEscrita: number;
  caminhosOperacionais: string[];
  /** Chaves exportadas para Pendentes_Validacao_Fiscal nesta execução. */
  chavesPendentesExportadas: string[];
  /** API-03O — chaves vigentes exportadas como intermediárias. */
  chavesIntermediadasExportadas: string[];
}

function destinoOperacionalDe(
  doc: DocumentoExportavelNfse,
  pastas: { emitidas: string; recebidas: string; intermediadas: string }
): string {
  if (doc.papelFiscal === 'INTERMEDIARIO') return pastas.intermediadas;
  if (doc.papelFiscal === 'PRESTADOR' || doc.direcao === 'EMITIDA') return pastas.emitidas;
  return pastas.recebidas;
}

async function copiarDocumento(input: {
  doc: DocumentoExportavelNfse;
  destDir: string;
  cnpj: string;
  periodo: PeriodoConsultaPortal;
  repositorio: RepositorioFiscalNfse;
}): Promise<'copiado' | 'ja_igual' | 'conflito' | 'falha' | 'ausente'> {
  const origem = input.repositorio.caminhoXml(input.cnpj, input.periodo, input.doc.chaveNacional);
  if (!fs.existsSync(origem)) return 'ausente';
  const nomeArquivo = sanitizarNomeArquivo(`${input.doc.chaveNacional}.xml`);
  const destino = path.join(input.destDir, nomeArquivo);
  const r = await exportarXmlAdnIdempotente(origem, destino);
  if (r === 'copiado' || r === 'ja_igual' || r === 'conflito') return r;
  return 'falha';
}

/**
 * Copia XMLs aptos (vigentes) e pendentes fiscais para downloads operacionais.
 */
export async function exportarSefinParaDownloadsOperacionais(
  entrada: EntradaExportacaoDownloadsSefin
): Promise<ResultadoExportacaoDownloadsSefin> {
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
  // Pastas irmãs — montarCaminhoCompleto só aceita Emitidas/Recebidas.
  const destinoIntermediadas = path.join(path.dirname(destinoEmitidas), PASTA_INTERMEDIADAS);
  const destinoPendentes = path.join(path.dirname(destinoEmitidas), PASTA_PENDENTES_VALIDACAO_FISCAL);
  const pastas = {
    emitidas: destinoEmitidas,
    recebidas: destinoRecebidas,
    intermediadas: destinoIntermediadas,
  };

  let copiados = 0;
  let jaIguais = 0;
  let conflitos = 0;
  let falhasEscrita = 0;
  const caminhosOperacionais: string[] = [];
  const chavesPendentesExportadas: string[] = [];
  const chavesIntermediadasExportadas: string[] = [];
  const cnpj = entrada.inventario.cnpj;
  const pendentes = entrada.documentosPendentesFiscais ?? [];

  for (const doc of entrada.documentosAptos) {
    const destDir = destinoOperacionalDe(doc, pastas);
    const r = await copiarDocumento({
      doc,
      destDir,
      cnpj,
      periodo: entrada.periodoConsulta,
      repositorio: entrada.repositorio,
    });
    if (r === 'copiado' || r === 'ja_igual') {
      if (r === 'copiado') copiados += 1;
      else jaIguais += 1;
      caminhosOperacionais.push(
        path.join(destDir, sanitizarNomeArquivo(`${doc.chaveNacional}.xml`))
      );
      if (doc.papelFiscal === 'INTERMEDIARIO') {
        chavesIntermediadasExportadas.push(doc.chaveNacional);
      }
    } else if (r === 'conflito') {
      conflitos += 1;
    } else {
      falhasEscrita += 1;
    }
  }

  for (const doc of pendentes) {
    const r = await copiarDocumento({
      doc,
      destDir: destinoPendentes,
      cnpj,
      periodo: entrada.periodoConsulta,
      repositorio: entrada.repositorio,
    });
    if (r === 'copiado' || r === 'ja_igual') {
      if (r === 'copiado') copiados += 1;
      else jaIguais += 1;
      chavesPendentesExportadas.push(doc.chaveNacional);
      caminhosOperacionais.push(
        path.join(destinoPendentes, sanitizarNomeArquivo(`${doc.chaveNacional}.xml`))
      );
    } else if (r === 'conflito') {
      conflitos += 1;
    } else {
      falhasEscrita += 1;
    }
  }

  const encontrados = entrada.documentosAptos.length + pendentes.length;
  const ok = conflitos === 0 && falhasEscrita === 0;
  const motivo = ok
    ? `Exportação SEFIN→downloads OK: encontrados=${encontrados} copiados=${copiados} já_iguais=${jaIguais} intermediadas=${chavesIntermediadasExportadas.length} pendentes_fiscais=${chavesPendentesExportadas.length}.`
    : `Exportação SEFIN→downloads FALHOU: conflitos=${conflitos} falhasEscrita=${falhasEscrita}. Originais fiscais preservados.`;

  return {
    ok,
    codigoErro: ok ? null : 'SEFIN_EXPORT_FALHOU',
    motivo,
    destinoEmitidas,
    destinoRecebidas,
    destinoIntermediadas,
    destinoPendentes,
    encontrados,
    copiados,
    jaIguais,
    conflitos,
    falhasEscrita,
    caminhosOperacionais,
    chavesPendentesExportadas,
    chavesIntermediadasExportadas,
  };
}

export async function validarXmlsOperacionaisSefin(
  caminhos: string[]
): Promise<{ ok: boolean; invalidos: string[] }> {
  const invalidos: string[] = [];
  for (const c of caminhos) {
    const v = await validarArquivoBaixado(c, 'xml');
    if (!v.valid) invalidos.push(c);
  }
  return { ok: invalidos.length === 0, invalidos };
}
