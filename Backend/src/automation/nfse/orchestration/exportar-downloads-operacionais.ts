/**
 * Exporta XMLs fiscais (SEFIN) para o diretório operacional AutoNacional.
 * Mesmo contrato de pastas do Playwright/ADN: Emitidas/Recebidas.
 * Nunca move/apaga originais fiscais. Idempotente. Não sobrescreve divergente.
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

export interface EntradaExportacaoDownloadsSefin {
  inventario: InventarioNfse;
  documentosAptos: readonly DocumentoExportavelNfse[];
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
  encontrados: number;
  copiados: number;
  jaIguais: number;
  conflitos: number;
  falhasEscrita: number;
  caminhosOperacionais: string[];
}

function tipoNotaDe(direcao: DocumentoExportavelNfse['direcao']): 'Emitidas' | 'Recebidas' {
  return direcao === 'RECEBIDA' ? 'Recebidas' : 'Emitidas';
}

/**
 * Copia XMLs aptos (persistidos pelo SEFIN) para downloads operacionais.
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

  let copiados = 0;
  let jaIguais = 0;
  let conflitos = 0;
  let falhasEscrita = 0;
  const caminhosOperacionais: string[] = [];
  const cnpj = entrada.inventario.cnpj;

  for (const doc of entrada.documentosAptos) {
    const origem = entrada.repositorio.caminhoXml(
      cnpj,
      entrada.periodoConsulta,
      doc.chaveNacional
    );
    if (!fs.existsSync(origem)) {
      falhasEscrita += 1;
      continue;
    }
    const tipo = tipoNotaDe(doc.direcao);
    const destDir = tipo === 'Emitidas' ? destinoEmitidas : destinoRecebidas;
    const nomeArquivo = sanitizarNomeArquivo(`${doc.chaveNacional}.xml`);
    const destino = path.join(destDir, nomeArquivo);
    const r = await exportarXmlAdnIdempotente(origem, destino);
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

  const encontrados = entrada.documentosAptos.length;
  const ok = conflitos === 0 && falhasEscrita === 0;
  const motivo = ok
    ? `Exportação SEFIN→downloads OK: encontrados=${encontrados} copiados=${copiados} já_iguais=${jaIguais}.`
    : `Exportação SEFIN→downloads FALHOU: conflitos=${conflitos} falhasEscrita=${falhasEscrita}. Originais fiscais preservados.`;

  return {
    ok,
    codigoErro: ok ? null : 'SEFIN_EXPORT_FALHOU',
    motivo,
    destinoEmitidas,
    destinoRecebidas,
    encontrados,
    copiados,
    jaIguais,
    conflitos,
    falhasEscrita,
    caminhosOperacionais,
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
