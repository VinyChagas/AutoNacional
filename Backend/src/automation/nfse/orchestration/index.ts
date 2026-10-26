export {
  NOME_FLAG_RECUPERACAO_NATIVA,
  lerFlagRecuperacaoNativa,
  flagRecuperacaoNativaAtiva,
  lerRaizFiscalNativa,
  resolverRaizFiscalNativaProduto,
  defaultRaizFiscalNativaProduto,
  exigirFlagValidaOuDesativada,
} from './feature-flag';
export type { LeituraFlagRecuperacaoNativa } from './feature-flag';
export { executarFluxoFiscalNativo } from './native-orchestrator';
export { decidirIntegracaoNativa, tentarFluxoNativoControlado } from './integration-adapter';
export { decidirMotorIniciar } from './iniciar-motor-routing';
export type {
  DecisaoMotorIniciar,
  MotorProcessamentoIniciar,
  SituacaoMotorIniciar,
} from './iniciar-motor-routing';
export {
  exportarSefinParaDownloadsOperacionais,
  validarXmlsOperacionaisSefin,
} from './exportar-downloads-operacionais';
export { OrquestracaoNfseError, autorizacaoNativaAtiva } from './types';
export type {
  AutorizacaoExecucaoNativa,
  CompatibilidadePdfNativo,
  CodigoErroOrquestracaoNfse,
  ContextoIntegracaoExecution,
  DecisaoIntegracaoNativa,
  DependenciasFluxoFiscalNativo,
  DiagnosticoOrquestracaoNfse,
  EntradaFluxoFiscalNativo,
  ModoExecucaoFiscal,
  ResultadoFluxoFiscalNativo,
  SituacaoDecisaoIntegracao,
} from './types';
export {
  agoraMonotonicoMs,
  deltaMonotonicoMs,
  metricasOperacionaisVazias,
  serializarMetricasOperacionais,
  CronometroMonotonico,
} from './metricas-operacionais';
export type {
  ContadoresOperacionaisNfse,
  DuracoesOperacionaisNfse,
  MetricasOperacionaisNfse,
} from './metricas-operacionais';
export {
  montarReconciliacaoExecucao,
  serializarReconciliacao,
} from './reconciliacao-execucao';
export type {
  ReconciliacaoExecucao,
  StatusFiscalReconciliacao,
} from './reconciliacao-execucao';
