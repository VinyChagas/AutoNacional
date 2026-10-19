/**
 * Período aplicado ao Portal Nacional e competência lida do XML.
 * São conceitos distintos: só o primeiro seleciona documentos.
 */
import { ContratoNfseError } from './erros';

export const PERIODO_CONSULTA_PORTAL = 'PERIODO_CONSULTA_PORTAL' as const;
export const COMPETENCIA_FISCAL_XML = 'COMPETENCIA_FISCAL_XML' as const;

/** Filtro `#datainicio` / `#datafim` do Portal Nacional, no formato DD/MM/YYYY. */
export interface PeriodoConsultaPortal {
  readonly tipo: typeof PERIODO_CONSULTA_PORTAL;
  inicio: string;
  fim: string;
}

/** Metadado `dCompet` do XML. Não decide se a nota entra no inventário. */
export interface CompetenciaFiscalXml {
  readonly tipo: typeof COMPETENCIA_FISCAL_XML;
  dCompet: string;
}

const DATA_PORTAL = /^(\d{2})\/(\d{2})\/(\d{4})$/;

function dataPortalValida(valor: string): boolean {
  const match = DATA_PORTAL.exec(valor);
  if (!match) return false;
  const dia = Number(match[1]);
  const mes = Number(match[2]);
  const ano = Number(match[3]);
  if (mes < 1 || mes > 12 || dia < 1) return false;
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return dia <= ultimoDia;
}

function ordinalDataPortal(valor: string): number {
  const match = DATA_PORTAL.exec(valor);
  if (!match) return 0;
  return Number(match[3]) * 10000 + Number(match[2]) * 100 + Number(match[1]);
}

export function criarPeriodoConsultaPortal(inicio: string, fim: string): PeriodoConsultaPortal {
  if (!dataPortalValida(inicio) || !dataPortalValida(fim)) {
    throw new ContratoNfseError(
      'Período consultado no portal usa datas DD/MM/YYYY. dCompet não ocupa este campo.'
    );
  }
  if (ordinalDataPortal(inicio) > ordinalDataPortal(fim)) {
    throw new ContratoNfseError('Período consultado invertido: início posterior ao fim.');
  }
  return { tipo: PERIODO_CONSULTA_PORTAL, inicio, fim };
}

export function criarCompetenciaFiscalXml(dCompet: string): CompetenciaFiscalXml {
  const valor = dCompet.trim();
  if (!valor) {
    throw new ContratoNfseError('dCompet vazio não é competência fiscal do XML.');
  }
  return { tipo: COMPETENCIA_FISCAL_XML, dCompet: valor };
}

export function periodosConsultaIguais(
  a: PeriodoConsultaPortal,
  b: PeriodoConsultaPortal
): boolean {
  return a.tipo === b.tipo && a.inicio === b.inicio && a.fim === b.fim;
}
