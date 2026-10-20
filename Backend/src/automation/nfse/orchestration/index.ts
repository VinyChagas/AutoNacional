export {
  NOME_FLAG_RECUPERACAO_NATIVA,
  lerFlagRecuperacaoNativa,
  flagRecuperacaoNativaAtiva,
  lerRaizFiscalNativa,
  exigirFlagValidaOuDesativada,
} from './feature-flag';
export type { LeituraFlagRecuperacaoNativa } from './feature-flag';
export { executarFluxoFiscalNativo } from './native-orchestrator';
export { decidirIntegracaoNativa, tentarFluxoNativoControlado } from './integration-adapter';
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
