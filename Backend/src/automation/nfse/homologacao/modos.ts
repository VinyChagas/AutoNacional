/**
 * Gates de modo H1 — DISCOVERY_ONLY e SEFIN_RECOVERY.
 * Nesta etapa só valida contratos e pré-condições offline.
 * Não inicia Page, SEFIN, Persistência nem checkpoint.
 */
import type { InventarioNfse } from '../contracts/inventario';
import { validarAutorizacaoHomologacao } from './autorizacao';
import { ControladorLimitesHomologacao } from './limites';
import { registrarEvidenciaHomologacao } from './evidencias';
import {
  HomologacaoNfseError,
  type AutorizacaoHomologacaoNfse,
  type ContextoValidacaoHomologacao,
  type EvidenciaHomologacaoSegura,
  type ResultadoGateHomologacao,
} from './types';

export function avaliarGateHomologacao(
  autorizacao: AutorizacaoHomologacaoNfse,
  contexto: ContextoValidacaoHomologacao
): ResultadoGateHomologacao {
  const validada = validarAutorizacaoHomologacao(autorizacao, contexto);
  const discovery = validada.operacao === 'DISCOVERY_ONLY';
  return {
    permitido: true,
    operacao: validada.operacao,
    motivo: discovery
      ? 'DISCOVERY_ONLY autorizado: descoberta/classificação sem SEFIN.'
      : 'SEFIN_RECOVERY autorizado: recuperação sujeita a inventário, A1 e limites.',
    permiteSefin: !discovery,
    permitePersistenciaXml: !discovery,
    permiteCheckpointRecuperacao: !discovery,
  };
}

/**
 * Prepara modo DISCOVERY_ONLY: valida auth + limites de documentos.
 * Não executa descoberta real nem cria storage.
 */
export function prepararDiscoveryOnly(entrada: {
  autorizacao: AutorizacaoHomologacaoNfse | null | undefined;
  contexto: ContextoValidacaoHomologacao;
  quantidadeDocumentosEstimada?: number;
}): {
  gate: ResultadoGateHomologacao;
  limites: ControladorLimitesHomologacao;
  evidencia: EvidenciaHomologacaoSegura;
} {
  const contexto: ContextoValidacaoHomologacao = {
    ...entrada.contexto,
    operacaoSolicitada: 'DISCOVERY_ONLY',
  };
  const auth = validarAutorizacaoHomologacao(entrada.autorizacao, contexto);
  const gate = avaliarGateHomologacao(auth, contexto);
  if (gate.permiteSefin) {
    throw new HomologacaoNfseError(
      'OPERACAO_NAO_AUTORIZADA',
      'DISCOVERY_ONLY não pode autorizar SEFIN.'
    );
  }

  const limites = new ControladorLimitesHomologacao(auth.limites);
  if (entrada.quantidadeDocumentosEstimada != null) {
    limites.exigirDocumentos(entrada.quantidadeDocumentosEstimada);
  }

  const evidencia = registrarEvidenciaHomologacao({
    execucaoId: auth.execucaoId,
    cnpj: auth.cnpj,
    periodoConsulta: auth.periodoConsulta,
    operacao: 'DISCOVERY_ONLY',
    evento: 'discovery_only_preparado',
    detalhes: {
      permiteSefin: false,
      maxDocumentos: auth.limites.maxDocumentos,
      maxRequisicoesSefin: auth.limites.maxRequisicoesSefin,
    },
    agora: entrada.contexto.agora,
  });

  return { gate, limites, evidencia };
}

/**
 * Prepara modo SEFIN_RECOVERY: exige auth específica, inventário completo,
 * ausência de indeterminada e disponibilidade declarada de A1 (booleano injetado).
 * Não chama SEFIN nem carrega certificado.
 */
export function prepararSefinRecovery(entrada: {
  autorizacao: AutorizacaoHomologacaoNfse | null | undefined;
  contexto: ContextoValidacaoHomologacao;
  inventario: InventarioNfse | null;
  certificadoDisponivel: boolean;
}): {
  gate: ResultadoGateHomologacao;
  limites: ControladorLimitesHomologacao;
  evidencia: EvidenciaHomologacaoSegura;
  elegiveis: number;
} {
  const contexto: ContextoValidacaoHomologacao = {
    ...entrada.contexto,
    operacaoSolicitada: 'SEFIN_RECOVERY',
  };

  if (!entrada.autorizacao) {
    throw new HomologacaoNfseError(
      'AUTORIZACAO_AUSENTE',
      'SEFIN_RECOVERY exige autorização específica.'
    );
  }

  const auth = validarAutorizacaoHomologacao(entrada.autorizacao, contexto);
  const gate = avaliarGateHomologacao(auth, contexto);
  if (!gate.permiteSefin) {
    throw new HomologacaoNfseError(
      'OPERACAO_NAO_AUTORIZADA',
      'Autorização não permite recuperação SEFIN.'
    );
  }

  if (!entrada.inventario) {
    throw new HomologacaoNfseError('INVENTARIO_INCOMPLETO', 'Inventário ausente para SEFIN_RECOVERY.');
  }
  if (entrada.inventario.completude !== 'COMPLETO') {
    throw new HomologacaoNfseError('INVENTARIO_INCOMPLETO', 'Inventário incompleto bloqueia SEFIN_RECOVERY.');
  }
  if (entrada.inventario.totais.indeterminadas > 0) {
    throw new HomologacaoNfseError(
      'SITUACAO_INDETERMINADA',
      'Indeterminada bloqueia SEFIN_RECOVERY.'
    );
  }
  if (entrada.inventario.cnpj !== auth.cnpj) {
    throw new HomologacaoNfseError('CNPJ_DIVERGENTE', 'Inventário de outro CNPJ.');
  }
  if (!entrada.certificadoDisponivel) {
    throw new HomologacaoNfseError(
      'CERTIFICADO_INDISPONIVEL',
      'Certificado A1 indisponível para SEFIN_RECOVERY.'
    );
  }

  const elegiveis = entrada.inventario.documentos.filter((d) => d.situacao === 'VIGENTE').length;
  const canceladas = entrada.inventario.totais.canceladas;
  const limites = new ControladorLimitesHomologacao(auth.limites);
  limites.exigirDocumentos(entrada.inventario.totais.descobertos);

  const evidencia = registrarEvidenciaHomologacao({
    execucaoId: auth.execucaoId,
    cnpj: auth.cnpj,
    periodoConsulta: auth.periodoConsulta,
    operacao: 'SEFIN_RECOVERY',
    evento: 'sefin_recovery_preparado',
    detalhes: {
      elegiveis,
      canceladas,
      vigentes: entrada.inventario.totais.vigentes,
      maxRequisicoesSefin: auth.limites.maxRequisicoesSefin,
      certificadoDisponivel: true,
    },
    agora: entrada.contexto.agora,
  });

  return { gate, limites, evidencia, elegiveis };
}

/**
 * Simula o consumo de N requisições SEFIN respeitando o controlador.
 * Não realiza HTTP.
 */
export function simularConsumoRequisicoesSefin(
  limites: ControladorLimitesHomologacao,
  quantidade: number
): void {
  for (let i = 0; i < quantidade; i += 1) {
    limites.exigirProximaRequisicaoSefin();
  }
}
