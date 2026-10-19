/**
 * Descoberta nativa sobre uma Page já autenticada pelo AutoNacional.
 */
import type { Page } from 'playwright';
import { getLogger } from '../../../infrastructure/logger';
import type { PeriodoConsultaPortal } from '../contracts/periodo';
import { executarDescoberta } from './discovery-runner';
import { criarPortalDaPage } from './page-capture';
import type { ResultadoDescobertaNfse, TipoConsultaDescoberta } from './types';

const logger = getLogger('nfse-discovery');

export interface DiscoverNfseInput {
  page: Page;
  cnpj: string;
  periodoConsulta: PeriodoConsultaPortal;
  tipo: TipoConsultaDescoberta;
  maxPaginas?: number;
}

export async function discoverNfse(input: DiscoverNfseInput): Promise<ResultadoDescobertaNfse> {
  logger.info(
    { tipo: input.tipo, inicio: input.periodoConsulta.inicio, fim: input.periodoConsulta.fim },
    'Iniciando descoberta de NFS-e na página autenticada'
  );
  const resultado = await executarDescoberta(criarPortalDaPage(input.page), {
    cnpj: input.cnpj,
    periodoConsulta: input.periodoConsulta,
    tipo: input.tipo,
    maxPaginas: input.maxPaginas,
  });
  logger.info(
    {
      status: resultado.status,
      descobertos: resultado.inventario.totais.descobertos,
      paginas: resultado.paginasPercorridas,
      diagnosticos: resultado.diagnosticos.length,
    },
    'Descoberta de NFS-e encerrada'
  );
  return resultado;
}
