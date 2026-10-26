/**
 * Adapta ResultadoSyncAdn → InventarioNfse dos contratos existentes.
 *
 * REGRA: fim da distribuição NSU NÃO declara inventário mensal completo.
 * Completude do inventário permanece PARCIAL (ou INDETERMINADO se vazio/erro).
 */
import { criarDocumentoFiscal, type DocumentoFiscalNfse } from '../contracts/documento-fiscal';
import { montarInventario, type InventarioNfse } from '../contracts/inventario';
import {
  criarCompetenciaFiscalXml,
  criarPeriodoConsultaPortal,
  type PeriodoConsultaPortal,
} from '../contracts/periodo';
import type { ResultadoSyncAdn } from './types';

export interface AdaptarSyncAdnParaInventarioInput {
  sync: ResultadoSyncAdn;
  /** Período de referência do operador (contrato exige PERIODO_CONSULTA_PORTAL). */
  periodoConsulta: PeriodoConsultaPortal;
  /** Prefixo do id do inventário. */
  inventarioId?: string;
}

export interface ResultadoAdaptacaoInventarioAdn {
  inventario: InventarioNfse;
  /** Documentos ADN não mapeados (eventos, intermediadas, chave ≠ 50, XML inválido). */
  omitidos: Array<{
    nsu?: number;
    chaveAcesso?: string;
    classificacao: string;
    motivo: string;
  }>;
  /** Sempre false: NSU caught-up ≠ completude mensal. */
  inventarioMensalCompletoDeclarado: false;
  observacoes: string[];
}

/**
 * Mapeia apenas NFS-e emitidas/recebidas com chave nacional de 50 dígitos.
 * Eventos e intermediadas ficam em `omitidos` (rastreáveis no ResultadoSyncAdn).
 */
export function adaptarSyncAdnParaInventarioParcial(
  input: AdaptarSyncAdnParaInventarioInput
): ResultadoAdaptacaoInventarioAdn {
  const { sync, periodoConsulta } = input;
  if (periodoConsulta.tipo !== 'PERIODO_CONSULTA_PORTAL') {
    throw new Error('Adaptador ADN exige PERIODO_CONSULTA_PORTAL.');
  }

  const omitidos: ResultadoAdaptacaoInventarioAdn['omitidos'] = [];
  const documentos: DocumentoFiscalNfse[] = [];
  const chaves = new Set<string>();

  for (const doc of sync.documentos) {
    if (doc.classificacao === 'evento') {
      omitidos.push({
        nsu: doc.nsu,
        chaveAcesso: doc.chaveAcesso,
        classificacao: doc.classificacao,
        motivo: `Evento ADN (${doc.tipoEvento ?? 'sem tipo'}) — não entra como NFS-e no inventário de período.`,
      });
      continue;
    }
    if (doc.classificacao === 'intermediada' || doc.classificacao === 'nao_classificado') {
      omitidos.push({
        nsu: doc.nsu,
        chaveAcesso: doc.chaveAcesso,
        classificacao: doc.classificacao,
        motivo: 'Papel intermediário ou não classificado — contrato só aceita EMITIDA/RECEBIDA.',
      });
      continue;
    }
    if (!doc.xmlValido || !doc.chaveAcesso || !/^\d{50}$/.test(doc.chaveAcesso)) {
      omitidos.push({
        nsu: doc.nsu,
        chaveAcesso: doc.chaveAcesso,
        classificacao: doc.classificacao,
        motivo: 'Chave nacional de 50 dígitos ausente ou XML inválido.',
      });
      continue;
    }
    if (chaves.has(doc.chaveAcesso)) {
      omitidos.push({
        nsu: doc.nsu,
        chaveAcesso: doc.chaveAcesso,
        classificacao: doc.classificacao,
        motivo: 'Chave duplicada no mapeamento.',
      });
      continue;
    }
    chaves.add(doc.chaveAcesso);

    const direcao = doc.classificacao === 'emitida' ? 'EMITIDA' : 'RECEBIDA';
    documentos.push(
      criarDocumentoFiscal({
        chaveNacional: doc.chaveAcesso,
        cnpj: sync.cnpj,
        direcao,
        situacao: 'VIGENTE',
        periodoConsulta,
        competenciaFiscalXml: doc.competencia
          ? criarCompetenciaFiscalXml(doc.competencia)
          : undefined,
        origemClassificacao: 'XML',
        evidencias: [
          {
            origem: 'XML',
            descricao: `Distribuição ADN NSU=${doc.nsu ?? 'n/a'}; classificação=${doc.classificacao}.`,
          },
        ],
      })
    );
  }

  const observacoes = [
    'Inventário gerado a partir da distribuição ADN/NSU.',
    'Completude permanece PARCIAL: fim da distribuição NSU não prova inventário mensal completo.',
    `Sync ADN status=${sync.status}; fimDistribuicaoConfirmado=${sync.fimDistribuicaoConfirmado}; motivo=${sync.motivoParada}.`,
  ];
  if (sync.fimDistribuicaoConfirmado) {
    observacoes.push(
      'Cursor NSU esgotado (NENHUM_DOCUMENTO_LOCALIZADO) — ainda assim inventário mensal NÃO é declarado completo.'
    );
  }

  const inventario = montarInventario({
    id: input.inventarioId?.trim() || `adn-${sync.cnpj}-${Date.now()}`,
    cnpj: sync.cnpj,
    periodoConsulta,
    documentos,
    completude: documentos.length === 0 && sync.status === 'ERRO' ? 'INDETERMINADO' : 'PARCIAL',
  });

  return {
    inventario,
    omitidos,
    inventarioMensalCompletoDeclarado: false,
    observacoes,
  };
}

export function criarPeriodoReferenciaAdn(inicio: string, fim: string): PeriodoConsultaPortal {
  return criarPeriodoConsultaPortal(inicio, fim);
}
