/**
 * Descoberta nativa sobre uma Page já autenticada pelo AutoNacional.
 */
import type { Page } from 'playwright';
import { getLogger } from '../../../infrastructure/logger';
import type { PeriodoConsultaPortal } from '../contracts/periodo';
import { executarDescoberta } from './discovery-runner';
import { criarPortalDaPage } from './page-capture';
import type {
  ControleDescoberta,
  ResultadoDescobertaNfse,
  TipoConsultaDescoberta,
} from './types';

const logger = getLogger('nfse-discovery');

export interface DiscoverNfseInput {
  page: Page;
  cnpj: string;
  periodoConsulta: PeriodoConsultaPortal;
  tipo: TipoConsultaDescoberta;
  /** Orçamento de páginas desta chamada (restante global na homologação). */
  maxPaginas?: number;
  /** Orçamento de documentos desta chamada (restante global). */
  maxDocumentos?: number;
  controle?: ControleDescoberta;
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
    maxDocumentos: input.maxDocumentos,
    controle: input.controle,
  });
  const diagnosticosResumo = resultado.diagnosticos.slice(0, 5).map((d) => ({
    codigo: d.codigo,
    direcao: d.direcao,
    etapa: d.etapa,
    seletor: d.seletor,
    url: d.url,
    // Mensagem truncada — sem credenciais/tokens
    motivo: String(d.mensagem ?? '').slice(0, 180),
  }));
  const indeterminadas = resultado.inventario.totais.indeterminadas;
  const indeterminadasDiag = resultado.diagnosticos
    .filter((d) => d.codigo === 'SITUACAO_INDETERMINADA')
    .slice(0, 5)
    .map((d) => ({
      chaveNacional: d.chaveNacional,
      direcao: d.direcao,
      pagina: d.pagina,
      linha: d.linha,
      motivo: String(d.mensagem ?? '').slice(0, 180),
    }));
  logger.info(
    {
      status: resultado.status,
      descobertos: resultado.inventario.totais.descobertos,
      vigentes: resultado.inventario.totais.vigentes,
      canceladas: resultado.inventario.totais.canceladas,
      indeterminadas,
      paginas: resultado.paginasPercorridas,
      diagnosticos: resultado.diagnosticos.length,
      ...(diagnosticosResumo.length > 0 ? { diagnosticosResumo } : {}),
      ...(indeterminadasDiag.length > 0 ? { indeterminadasDiag } : {}),
    },
    'Descoberta de NFS-e encerrada'
  );
  return resultado;
}
