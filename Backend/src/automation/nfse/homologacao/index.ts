export {
  criarAutorizacaoHomologacao,
  criarLimitesHomologacao,
  validarAutorizacaoHomologacao,
  ehAutorizacaoHomologacaoEstruturada,
} from './autorizacao';
export { ControladorLimitesHomologacao } from './limites';
export {
  mascararCnpjHomologacao,
  registrarEvidenciaHomologacao,
  evidenciaContemSegredo,
} from './evidencias';
export { persistirEvidenciasHomologacao } from './evidencias-persistencia';
export type { PersistenciaEvidenciasHomologacao } from './evidencias-persistencia';
export {
  avaliarGateHomologacao,
  prepararDiscoveryOnly,
  prepararSefinRecovery,
  simularConsumoRequisicoesSefin,
} from './modos';
export { executarDiscoveryOnlyHomologacao } from './discovery-only-adapter';
export type {
  DiscoverNfseInjetavel,
  EntradaDiscoveryOnlyHomologacao,
} from './discovery-only-adapter';
export {
  configurarCanalHomologacaoOperacional,
  obterCanalHomologacaoOperacional,
  criarCanalAutorizacaoMemoria,
  criarCanalAutorizacaoArquivo,
  criarAutorizacaoId,
} from './canal-autorizacao';
export {
  aplicarBootstrapCanalHomologacao,
} from './bootstrap-canal-homologacao';
export type { ResultadoBootstrapCanal } from './bootstrap-canal-homologacao';
export {
  ENV_HOMOLOGACAO_STORE,
  lerCaminhoStorePrivilegiado,
  prepararStoreHomologacaoSeguro,
  modoArquivoEsperado,
  modoDiretorioEsperado,
} from './store-homologacao-seguro';
export {
  cliConsultar,
  cliEmitir,
  cliAtivar,
  cliCancelar,
} from './cli-homologacao-ops';
export type { EntradaEmitirCli } from './cli-homologacao-ops';
export {
  aplicarBootstrapAdminSocket,
  encerrarAdminSocket,
  ENV_ADMIN_SOCKET_DIR,
  ENV_ADMIN_SECRET_FILE,
} from './admin';
export type {
  CanalAutorizacaoHomologacao,
  TicketAutorizacaoOperacional,
  TicketEmissaoEntrada,
  ContextoConsumoAutorizacao,
  MotivoConsumoAutorizacao,
  EstadoTicketAutorizacao,
} from './canal-autorizacao-types';
export {
  execucaoRealDiscoveryOnlyHabilitada,
  GATE_EXECUCAO_REAL_DISCOVERY_ONLY,
  definirGateExecucaoRealSomenteTeste,
} from './gate-execucao-real';
export { avaliarPonteHomologacaoDiscoveryOnly } from './ponte-execution-homologacao';
export type {
  EntradaPonteHomologacao,
  ResultadoPonteHomologacao,
  SituacaoPonteHomologacao,
} from './ponte-execution-homologacao';
export {
  prepararExecucaoHomologacao,
  liberarExecucaoHomologacao,
  STATUS_HOMOLOGACAO_PREPARADA,
  STATUS_HOMOLOGACAO_LIBERADA,
  STATUS_HOMOLOGACAO_BLOQUEADA,
  limparRegistryPreparacaoSomenteTeste,
  simularReinicioProcessoSomenteTeste,
  obterPayloadPreparacao,
} from './preparacao-liberacao';
export type {
  EntradaPrepararHomologacao,
  ResultadoPrepararHomologacao,
  ResultadoLiberarHomologacao,
  PayloadExecucaoHomologacao,
  DependenciasPreparacaoLiberacao,
} from './preparacao-liberacao';
export {
  ESTADOS_OPERACIONAIS_HOMOLOGACAO,
  mapearVereditoParaEstadoOperacional,
} from './estados-operacionais';
export type { EstadoOperacionalHomologacao } from './estados-operacionais';
export {
  validarDiretorioFiscalSeguro,
  garantirDentroDoDiretorioAutorizado,
} from './diretorio-seguro';
export { HomologacaoNfseError, OPERACOES_HOMOLOGACAO } from './types';
export type {
  AutorizacaoHomologacaoNfse,
  CodigoErroHomologacao,
  ContagemLimitesHomologacao,
  ContextoValidacaoHomologacao,
  EstadoLimitesHomologacao,
  EvidenciaHomologacaoSegura,
  LimitesHomologacaoNfse,
  OperacaoHomologacao,
  ResultadoDiscoveryOnlyHomologacao,
  ResultadoGateHomologacao,
  VereditoDiscoveryOnly,
} from './types';
