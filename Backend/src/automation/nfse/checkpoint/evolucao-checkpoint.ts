/**
 * Evolução incremental segura de checkpoint fiscal (API-03F / API-03P).
 *
 * Compara inventário COMPLETO com checkpoint existente por chave, direção e situação.
 * Superconjunto e transições fiscais permitidas evoluem o JSON sem apagar XMLs.
 * API-03P — descoberta posterior mais fraca (→INDETERMINADA) preserva situação
 * confirmada (CANCELADA/VIGENTE) em vez de bloquear a empresa.
 * Chaves ausentes, direção divergente ou transição inválida bloqueiam sem alterar o disco.
 */
import type { SituacaoDocumentoFiscal } from '../contracts/documento-fiscal';
import { montarInventario, type InventarioNfse } from '../contracts/inventario';
import { calcularFingerprintInventario } from './fingerprint-inventario';
import {
  VERSAO_FORMATO_CHECKPOINT,
  type CheckpointNfse,
  type DocumentoCheckpointNfse,
  type EstadoDocumentoCheckpoint,
} from './types';

export interface MudancaSituacaoEvolucao {
  chaveNacional: string;
  de: SituacaoDocumentoFiscal;
  para: SituacaoDocumentoFiscal;
}

/** API-03P — situação confirmada mantida diante de descoberta mais fraca. */
export interface PreservacaoSituacaoEvolucao {
  chaveNacional: string;
  situacaoMantida: SituacaoDocumentoFiscal;
  situacaoDescoberta: SituacaoDocumentoFiscal;
  motivo: string;
}

export type ComparacaoEvolucaoCheckpoint =
  | { tipo: 'IDENTICO' }
  | {
      tipo: 'EVOLUIVEL';
      chavesNovas: string[];
      mudancasSituacao: MudancaSituacaoEvolucao[];
      preservacoesSituacao: PreservacaoSituacaoEvolucao[];
    }
  | {
      tipo: 'BLOQUEADO';
      codigo: 'CHAVES_AUSENTES' | 'DIRECAO_DIVERGENTE' | 'TRANSICAO_SITUACAO_INVALIDA';
      mensagem: string;
      chavesAusentes: string[];
      chavesDirecaoDivergente: string[];
      transicoesInvalidas: MudancaSituacaoEvolucao[];
    };

/**
 * Transições fiscais aceitas na evolução automática (aplicam mudança no checkpoint).
 * CANCELADA→VIGENTE exige revisão humana (evidência explícita).
 * Enfraquecimento →INDETERMINADA é tratado à parte (preservação API-03P).
 */
export function transicaoSituacaoPermitida(
  de: SituacaoDocumentoFiscal,
  para: SituacaoDocumentoFiscal
): boolean {
  if (de === para) return true;
  if (de === 'VIGENTE' && para === 'CANCELADA') return true;
  if (de === 'INDETERMINADA' && (para === 'VIGENTE' || para === 'CANCELADA')) return true;
  return false;
}

/**
 * API-03P — descoberta INDETERMINADA por ausência de evidência não sobrescreve
 * situação fiscal já confirmada no checkpoint.
 */
export function ehEnfraquecimentoEvidencia(
  de: SituacaoDocumentoFiscal,
  para: SituacaoDocumentoFiscal
): boolean {
  return para === 'INDETERMINADA' && (de === 'CANCELADA' || de === 'VIGENTE');
}

/**
 * Cancelamento comprovado no checkpoint: exclusão da recuperação após classificação
 * prévia (descoberta ou evolução VIGENTE→CANCELADA). Estado divergente = sem evidência
 * histórica confiável — não preservar automaticamente.
 */
export function cancelamentoComprovadoNoCheckpoint(documento: DocumentoCheckpointNfse): boolean {
  return documento.situacao === 'CANCELADA' && documento.estado === 'EXCLUIDA_DA_RECUPERACAO';
}

export function vigenciaComprovadaNoCheckpoint(documento: DocumentoCheckpointNfse): boolean {
  return (
    documento.situacao === 'VIGENTE' &&
    (documento.estado === 'PENDENTE' ||
      documento.estado === 'EM_PROCESSAMENTO' ||
      documento.estado === 'PERSISTIDO' ||
      documento.estado === 'FALHA_TRANSITORIA' ||
      documento.estado === 'FALHA_PERMANENTE' ||
      documento.estado === 'INCONSISTENTE')
  );
}

function podePreservarSituacaoConfirmada(
  noCp: DocumentoCheckpointNfse,
  para: SituacaoDocumentoFiscal
): PreservacaoSituacaoEvolucao | null {
  if (!ehEnfraquecimentoEvidencia(noCp.situacao, para)) return null;
  if (noCp.situacao === 'CANCELADA') {
    if (!cancelamentoComprovadoNoCheckpoint(noCp)) return null;
    return {
      chaveNacional: noCp.chaveNacional,
      situacaoMantida: 'CANCELADA',
      situacaoDescoberta: para,
      motivo:
        'Cancelamento comprovado no checkpoint; descoberta posterior INDETERMINADA por ausência de evidência — situação preservada.',
    };
  }
  if (noCp.situacao === 'VIGENTE') {
    if (!vigenciaComprovadaNoCheckpoint(noCp)) return null;
    return {
      chaveNacional: noCp.chaveNacional,
      situacaoMantida: 'VIGENTE',
      situacaoDescoberta: para,
      motivo:
        'Vigência confirmada no checkpoint; descoberta posterior INDETERMINADA por ausência de evidência — situação preservada.',
    };
  }
  return null;
}

export function compararInventarioComCheckpoint(
  checkpoint: CheckpointNfse,
  inventario: InventarioNfse
): ComparacaoEvolucaoCheckpoint {
  const porChaveCp = new Map(checkpoint.documentos.map((d) => [d.chaveNacional, d]));
  const porChaveInv = new Map(inventario.documentos.map((d) => [d.chaveNacional, d]));

  const chavesAusentes = [...porChaveCp.keys()].filter((chave) => !porChaveInv.has(chave)).sort();
  const chavesDirecaoDivergente: string[] = [];
  const transicoesInvalidas: MudancaSituacaoEvolucao[] = [];
  const mudancasSituacao: MudancaSituacaoEvolucao[] = [];
  const preservacoesSituacao: PreservacaoSituacaoEvolucao[] = [];
  const chavesNovas: string[] = [];

  for (const [chave, noInv] of porChaveInv) {
    const noCp = porChaveCp.get(chave);
    if (!noCp) {
      chavesNovas.push(chave);
      continue;
    }
    if (noCp.direcao !== noInv.direcao) {
      chavesDirecaoDivergente.push(chave);
      continue;
    }
    if (noCp.situacao !== noInv.situacao) {
      const mudanca = { chaveNacional: chave, de: noCp.situacao, para: noInv.situacao };
      const preservacao = podePreservarSituacaoConfirmada(noCp, noInv.situacao);
      if (preservacao) {
        preservacoesSituacao.push(preservacao);
      } else if (transicaoSituacaoPermitida(noCp.situacao, noInv.situacao)) {
        mudancasSituacao.push(mudanca);
      } else {
        transicoesInvalidas.push(mudanca);
      }
    }
  }

  chavesNovas.sort();
  preservacoesSituacao.sort((a, b) => a.chaveNacional.localeCompare(b.chaveNacional));

  if (chavesAusentes.length > 0) {
    return {
      tipo: 'BLOQUEADO',
      codigo: 'CHAVES_AUSENTES',
      mensagem: `Inventário sem chaves já presentes no checkpoint: ${chavesAusentes.join(', ')}.`,
      chavesAusentes,
      chavesDirecaoDivergente,
      transicoesInvalidas,
    };
  }
  if (chavesDirecaoDivergente.length > 0) {
    return {
      tipo: 'BLOQUEADO',
      codigo: 'DIRECAO_DIVERGENTE',
      mensagem: `Direção divergente para chave(s): ${chavesDirecaoDivergente.join(', ')}.`,
      chavesAusentes,
      chavesDirecaoDivergente,
      transicoesInvalidas,
    };
  }
  if (transicoesInvalidas.length > 0) {
    const detalhe = transicoesInvalidas
      .map((m) => `${m.chaveNacional}:${m.de}→${m.para}`)
      .join(', ');
    return {
      tipo: 'BLOQUEADO',
      codigo: 'TRANSICAO_SITUACAO_INVALIDA',
      mensagem: `Transição de situação não permitida automaticamente: ${detalhe}.`,
      chavesAusentes,
      chavesDirecaoDivergente,
      transicoesInvalidas,
    };
  }

  if (
    chavesNovas.length === 0 &&
    mudancasSituacao.length === 0 &&
    preservacoesSituacao.length === 0
  ) {
    return { tipo: 'IDENTICO' };
  }

  return { tipo: 'EVOLUIVEL', chavesNovas, mudancasSituacao, preservacoesSituacao };
}

/**
 * API-03P — alinha inventário às situações preservadas no checkpoint
 * (CANCELADA/VIGENTE mantidas quando a descoberta veio INDETERMINADA).
 */
export function alinharInventarioAoCheckpoint(
  inventario: InventarioNfse,
  checkpoint: CheckpointNfse
): InventarioNfse {
  const porChaveCp = new Map(checkpoint.documentos.map((d) => [d.chaveNacional, d]));
  let alterou = false;
  const documentos = inventario.documentos.map((doc) => {
    const noCp = porChaveCp.get(doc.chaveNacional);
    if (!noCp || noCp.direcao !== doc.direcao) return doc;
    if (doc.situacao !== 'INDETERMINADA') return doc;
    if (noCp.situacao !== 'CANCELADA' && noCp.situacao !== 'VIGENTE') return doc;
    if (noCp.situacao === 'CANCELADA' && !cancelamentoComprovadoNoCheckpoint(noCp)) return doc;
    if (noCp.situacao === 'VIGENTE' && !vigenciaComprovadaNoCheckpoint(noCp)) return doc;
    alterou = true;
    return {
      ...doc,
      situacao: noCp.situacao,
      origemClassificacao: 'REVISAO_MANUAL' as const,
      evidencias: [
        ...doc.evidencias,
        {
          origem: 'REVISAO_MANUAL' as const,
          descricao: `API-03P: situação ${noCp.situacao} preservada; descoberta INDETERMINADA sem evidência suficiente.`,
        },
      ],
    };
  });
  if (!alterou) return inventario;
  return montarInventario({
    id: inventario.id,
    cnpj: inventario.cnpj,
    periodoConsulta: inventario.periodoConsulta,
    documentos,
    completude: inventario.completude,
  });
}

/**
 * Monta checkpoint evoluído: preserva metadados/XML de documentos anteriores,
 * adiciona novas chaves, aplica mudanças permitidas e mantém situações confirmadas
 * diante de enfraquecimento (API-03P). Não lê nem escreve disco.
 */
export function montarCheckpointEvoluido(
  checkpoint: CheckpointNfse,
  inventario: InventarioNfse,
  execucaoId: string,
  agora: string,
  comparacao: Extract<ComparacaoEvolucaoCheckpoint, { tipo: 'EVOLUIVEL' }>
): CheckpointNfse {
  const porChaveCp = new Map(checkpoint.documentos.map((d) => [d.chaveNacional, d]));
  const mudancaPorChave = new Map(
    comparacao.mudancasSituacao.map((m) => [m.chaveNacional, m] as const)
  );
  const preservacaoPorChave = new Map(
    comparacao.preservacoesSituacao.map((p) => [p.chaveNacional, p] as const)
  );
  const documentos: DocumentoCheckpointNfse[] = [];

  for (const docInv of [...inventario.documentos].sort((a, b) =>
    a.chaveNacional.localeCompare(b.chaveNacional)
  )) {
    const existente = porChaveCp.get(docInv.chaveNacional);
    if (!existente) {
      documentos.push(estadoInicialDocumento(docInv.situacao, docInv.chaveNacional, docInv.direcao, agora));
      continue;
    }

    const preservacao = preservacaoPorChave.get(docInv.chaveNacional);
    if (preservacao) {
      documentos.push(aplicarPreservacaoSituacao(existente, preservacao, agora));
      continue;
    }

    const mudanca = mudancaPorChave.get(docInv.chaveNacional);
    if (!mudanca) {
      documentos.push(existente);
      continue;
    }

    documentos.push(aplicarMudancaSituacao(existente, mudanca.para, agora));
  }

  const rascunho: CheckpointNfse = {
    versaoFormato: VERSAO_FORMATO_CHECKPOINT,
    execucaoId,
    cnpj: checkpoint.cnpj,
    periodoConsulta: checkpoint.periodoConsulta,
    fingerprintInventario: checkpoint.fingerprintInventario,
    createdAt: checkpoint.createdAt,
    updatedAt: agora,
    documentos,
  };
  const inventarioAlinhado = alinharInventarioAoCheckpoint(inventario, rascunho);

  return {
    ...rascunho,
    fingerprintInventario: calcularFingerprintInventario(inventarioAlinhado),
  };
}

function aplicarPreservacaoSituacao(
  documento: DocumentoCheckpointNfse,
  preservacao: PreservacaoSituacaoEvolucao,
  instante: string
): DocumentoCheckpointNfse {
  return {
    ...documento,
    // Situação e estado fiscal permanecem; só registra o aviso de enfraquecimento.
    diagnostico: preservacao.motivo,
    codigo: 'PRESERVACAO_SITUACAO',
    updatedAt: instante,
  };
}

function aplicarMudancaSituacao(
  documento: DocumentoCheckpointNfse,
  situacao: SituacaoDocumentoFiscal,
  instante: string
): DocumentoCheckpointNfse {
  if (situacao === 'CANCELADA') {
    return {
      ...documento,
      situacao: 'CANCELADA',
      estado: 'EXCLUIDA_DA_RECUPERACAO',
      // Preserva hash/caminho/tamanho — XML histórico não é rebaixado nem apagado.
      diagnostico: 'Situação atualizada para CANCELADA; XML histórico preservado.',
      codigo: 'EVOLUCAO_SITUACAO',
      updatedAt: instante,
    };
  }
  if (situacao === 'VIGENTE') {
    const tinhaXmlIntegro =
      documento.hashSha256 !== null &&
      documento.caminhoRelativo !== null &&
      (documento.estado === 'PERSISTIDO' ||
        documento.estado === 'BLOQUEADO' ||
        documento.estado === 'EXCLUIDA_DA_RECUPERACAO');
    return {
      ...documento,
      situacao: 'VIGENTE',
      estado: tinhaXmlIntegro ? 'PERSISTIDO' : 'PENDENTE',
      diagnostico: tinhaXmlIntegro
        ? 'Situação atualizada para VIGENTE; XML pré-existente reaproveitado.'
        : 'Situação atualizada para VIGENTE; aguarda recuperação.',
      codigo: 'EVOLUCAO_SITUACAO',
      updatedAt: instante,
    };
  }
  // INDETERMINADA não entra via transicaoSituacaoPermitida a partir de outro estado.
  return {
    ...documento,
    situacao: 'INDETERMINADA',
    estado: 'BLOQUEADO',
    diagnostico: 'Situação indeterminada bloqueia o processamento automático até revisão.',
    codigo: 'SITUACAO_INDETERMINADA',
    updatedAt: instante,
  };
}

function estadoInicialDocumento(
  situacao: SituacaoDocumentoFiscal,
  chaveNacional: string,
  direcao: DocumentoCheckpointNfse['direcao'],
  instante: string
): DocumentoCheckpointNfse {
  if (situacao === 'VIGENTE') {
    return baseDoc(chaveNacional, direcao, situacao, 'PENDENTE', null, null, instante);
  }
  if (situacao === 'CANCELADA') {
    return baseDoc(
      chaveNacional,
      direcao,
      situacao,
      'EXCLUIDA_DA_RECUPERACAO',
      'Nota cancelada permanece no inventário e fica fora da recuperação.',
      null,
      instante
    );
  }
  return baseDoc(
    chaveNacional,
    direcao,
    situacao,
    'BLOQUEADO',
    'Situação indeterminada bloqueia o processamento automático até revisão.',
    'SITUACAO_INDETERMINADA',
    instante
  );
}

function baseDoc(
  chaveNacional: string,
  direcao: DocumentoCheckpointNfse['direcao'],
  situacao: SituacaoDocumentoFiscal,
  estado: EstadoDocumentoCheckpoint,
  diagnostico: string | null,
  codigo: string | null,
  instante: string
): DocumentoCheckpointNfse {
  return {
    chaveNacional,
    direcao,
    situacao,
    estado,
    hashSha256: null,
    caminhoRelativo: null,
    tamanhoBytes: null,
    diagnostico,
    codigo,
    updatedAt: instante,
  };
}
