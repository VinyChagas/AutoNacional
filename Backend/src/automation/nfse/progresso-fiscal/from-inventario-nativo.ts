/**
 * API-03N — progresso fiscal a partir do inventário Portal+SEFIN.
 * Usa os totais do inventário (não inventa vigentes = descobertos − canceladas).
 */
import type { InventarioNfse } from '../contracts/inventario';
import type { ProgressoFiscalNfse } from './types';

export interface IdentidadeProgressoInventarioNativo {
  batchId: string | null;
  empresaId: string;
  execucaoId: string;
  cnpj: string;
}

export function progressoFiscalDeInventarioNativo(entrada: {
  identidade: IdentidadeProgressoInventarioNativo;
  inventario: InventarioNfse;
  codigo?: string | null;
  message?: string | null;
  recuperacaoEstado?: ProgressoFiscalNfse['recuperacao']['estado'];
}): ProgressoFiscalNfse {
  const t = entrada.inventario.totais;
  const completo = entrada.inventario.completude === 'COMPLETO';
  return {
    versao: 1,
    batch_id: entrada.identidade.batchId,
    empresa_id: entrada.identidade.empresaId,
    execucao_id: entrada.identidade.execucaoId,
    cnpj: entrada.identidade.cnpj,
    revisao: 0,
    inventario: {
      estado: completo ? 'completa' : 'parcial',
      completude: entrada.inventario.completude,
      conclusao_confiavel: completo,
      totais: {
        emitidas: t.emitidas,
        recebidas: t.recebidas,
        canceladas: t.canceladas,
        vigentes: t.vigentes,
        indeterminadas: t.indeterminadas,
        descobertos: t.descobertos,
        paginas: 0,
      },
    },
    validacao: {
      estado: completo ? 'completa' : 'parcial',
      origem: 'PORTAL',
      vigentes: t.vigentes,
      canceladas: t.canceladas,
      indeterminadas: t.indeterminadas,
      conclusao_confiavel: completo && t.indeterminadas === 0,
    },
    recuperacao: {
      estado: entrada.recuperacaoEstado ?? 'parcial',
      conclusao_confiavel: false,
    },
    codigo: entrada.codigo ?? null,
    message: entrada.message ?? null,
    estado_operacional: null,
    veredito_discovery: completo ? 'PASS' : 'INCOMPLETO',
  };
}
