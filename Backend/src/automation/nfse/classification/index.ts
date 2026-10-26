export {
  CODIGO_DATA_SITUACAO_CANCELADA,
  CODIGO_DATA_SITUACAO_GERADA,
  CODIGO_DATA_SITUACAO_SUBSTITUIDA,
  CODIGO_SITUACAO_DESCONHECIDO,
  CODIGOS_DATA_SITUACAO_VIGENTE,
  CONFLITO_SITUACAO,
  PREFIXO_DATA_SITUACAO_DECISAO_JUDICIAL,
  PREFIXO_DATA_SITUACAO_SUBSTITUICAO_GERADA,
  classificarSituacao,
  documentoClassificado,
  ehCodigoDecisaoJudicialPortal,
  ehCodigoSubstituicaoGeradaPortal,
  ehEvidenciaBypassDecisaoJudicial,
  evidenciaTemDecisaoAdministrativaJudicial,
  evidenciasDaClassificacao,
} from './situacao';
export {
  CODIGO_DIAGNOSTICO_INDETERMINADA,
  inferirNumeroNotaDosTextos,
  montarDiagnosticoNotaIndeterminada,
  motivoBloqueioIndeterminada,
  resumoDiagnosticoIndeterminadaParaLog,
} from './diagnostico-indeterminada';
export type { DiagnosticoNotaIndeterminada } from './diagnostico-indeterminada';
export type {
  ClassificacaoSituacaoNfse,
  EvidenciaColunaSituacao,
  FonteClassificacaoSituacao,
  IconeColunaSituacao,
} from './situacao';
export {
  ajustarInventarioComXmlsSubstituicao,
  ajustarInventarioPorSubstituicoes,
  chavesOriginaisSubstituidas,
  coletarVinculosSubstituicao,
  lerSubstituicaoDoXmlNfse,
} from './substituicao';
export type { LeituraSubstituicaoXml, VinculoSubstituicaoXml } from './substituicao';
