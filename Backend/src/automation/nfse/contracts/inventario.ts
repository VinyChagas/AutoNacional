/**
 * Inventário dos documentos descobertos para um CNPJ e um período de portal.
 * Canceladas e indeterminadas permanecem na lista.
 */
import {
  documentoPermaneceNoInventario,
  normalizarCnpjEmpresa,
  type DocumentoFiscalNfse,
} from './documento-fiscal';
import { ContratoNfseError } from './erros';
import type { PeriodoConsultaPortal } from './periodo';

export const ESTADOS_COMPLETUDE_INVENTARIO = ['COMPLETO', 'PARCIAL', 'INDETERMINADO'] as const;
export type EstadoCompletudeInventario = (typeof ESTADOS_COMPLETUDE_INVENTARIO)[number];

export interface TotaisInventarioNfse {
  descobertos: number;
  emitidas: number;
  recebidas: number;
  vigentes: number;
  canceladas: number;
  indeterminadas: number;
}

export interface InventarioNfse {
  id: string;
  cnpj: string;
  periodoConsulta: PeriodoConsultaPortal;
  documentos: DocumentoFiscalNfse[];
  totais: TotaisInventarioNfse;
  completude: EstadoCompletudeInventario;
}

export interface NovoInventarioInput {
  id: string;
  cnpj: string;
  periodoConsulta: PeriodoConsultaPortal;
  documentos: readonly DocumentoFiscalNfse[];
  completude: EstadoCompletudeInventario;
}

export function calcularTotaisInventario(
  documentos: readonly DocumentoFiscalNfse[]
): TotaisInventarioNfse {
  const totais: TotaisInventarioNfse = {
    descobertos: documentos.length,
    emitidas: 0,
    recebidas: 0,
    vigentes: 0,
    canceladas: 0,
    indeterminadas: 0,
  };

  for (const documento of documentos) {
    if (documento.direcao === 'EMITIDA') totais.emitidas += 1;
    else totais.recebidas += 1;

    if (documento.situacao === 'VIGENTE') totais.vigentes += 1;
    else if (documento.situacao === 'CANCELADA') totais.canceladas += 1;
    else totais.indeterminadas += 1;
  }

  return totais;
}

export function montarInventario(input: NovoInventarioInput): InventarioNfse {
  const id = input.id.trim();
  if (!id) {
    throw new ContratoNfseError('Inventário sem identificação.');
  }
  if (!(ESTADOS_COMPLETUDE_INVENTARIO as readonly string[]).includes(input.completude)) {
    throw new ContratoNfseError(`Completude de inventário não permitida: ${input.completude}.`);
  }

  const cnpj = normalizarCnpjEmpresa(input.cnpj);
  const chaves = new Set<string>();
  const documentos: DocumentoFiscalNfse[] = [];

  for (const documento of input.documentos) {
    if (documento.cnpj !== cnpj) {
      throw new ContratoNfseError('Documento de outro CNPJ não entra neste inventário.');
    }
    if (!documentoPermaneceNoInventario(documento, input.periodoConsulta)) {
      throw new ContratoNfseError(
        'Documento de outro período consultado no portal não entra neste inventário.'
      );
    }
    if (chaves.has(documento.chaveNacional)) {
      throw new ContratoNfseError(`Chave repetida no inventário: ${documento.chaveNacional}.`);
    }
    chaves.add(documento.chaveNacional);
    documentos.push(documento);
  }

  return {
    id,
    cnpj,
    periodoConsulta: input.periodoConsulta,
    documentos,
    totais: calcularTotaisInventario(documentos),
    completude: input.completude,
  };
}
