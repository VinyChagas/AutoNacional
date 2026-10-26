/**
 * Módulo ADN/NSU — descoberta por distribuição oficial (mTLS A1).
 * Sem Playwright. Sem SEFIN.
 * Iniciar ADN complementar (API-02K: A1 padrão é Portal+SEFIN). Exceções Playwright preservadas.
 * Kill-switch env NFSE_ADN_INICIAR_ENABLED=false força Playwright.
 * NFSExplorer é apenas referência de código — não há dependência runtime.
 */

export { ErroAdn } from './errors';
export {
  BASE_URLS_ADN,
  HOSTS_ADN,
  hostAdnPermitido,
  montarUrlDistribuicaoDfe,
  type AmbienteAdn,
} from './endpoints';
export {
  LIMITES_ADN_PADRAO,
  type CheckpointDistribuicaoAdn,
  type ClassificacaoDocumentoAdn,
  type CredencialMtls,
  type DocumentoDistribuidoAdn,
  type DistribuicaoNsuItem,
  type LimitesAdn,
  type LoteDistribuicaoNsuResponse,
  type ResultadoSyncAdn,
  type StatusSyncAdn,
  type TransporteHttpAdn,
} from './types';
export {
  interpretarRespostaDistribuicao,
  type ClassificacaoDistribuicaoAdn,
  type InterpretacaoDistribuicaoAdn,
} from './distribuicao-result';
export {
  analisarLote,
  dedupeKeyDistribuicao,
  MAX_LOTE_DOCUMENTADO,
  type LoteAnaliseAdn,
} from './lote-analyzer';
export {
  classificarDocumentoDistribuido,
  processarItemDistribuicao,
} from './classifier';
export { decodificarArquivoXmlAdn } from './xml-decode';
export {
  extrairCamposXmlAdn,
  identificarPapeisAdn,
  normalizarCompetenciaAdn,
} from './xml-extract';
export {
  CheckpointStoreArquivo,
  CheckpointStoreMemoria,
  commitCheckpointAposLote,
  validarCheckpointAdn,
  type PersistenciaCheckpointAdn,
} from './checkpoint-store';
export {
  DocumentStoreArquivoAdn,
  DocumentStoreMemoriaAdn,
  chaveDedupeDocumento,
  type PersistenciaDocumentosAdn,
  type ResultadoPersistenciaDocumentoAdn,
  type OpcoesDocumentStoreAdn,
} from './document-store';
export {
  SyncLockMemoriaAdn,
  SyncLockArquivoAdn,
  SyncLockCompostoAdn,
  type SyncLockAdn,
} from './sync-lock';
export { escreverArquivoAtomico, escreverArquivoAtomicoNovo } from './fs-atomic';
export {
  criarTransporteHttpsMtlsAdn,
  classificarFalhaTransporteAdn,
} from './mtls-transport';
export { AdnClient, type ConsultaDfeAdnOptions, type ResultadoConsultaDfeAdn } from './adn-client';
export { SyncServiceAdn, type SyncAdnOptions } from './sync-service';
export {
  adaptarSyncAdnParaInventarioParcial,
  criarPeriodoReferenciaAdn,
  type AdaptarSyncAdnParaInventarioInput,
  type ResultadoAdaptacaoInventarioAdn,
} from './inventory-adapter';
export {
  ENV_ADN_ALLOW_LIVE,
  avaliarGateLiveAdn,
  lerAllowLiveEnv,
  type ResultadoGateLiveAdn,
} from './live-gate';
export {
  assertCnpjCompativelComCertificado,
  extrairCnpjDoCertificadoA1,
} from './cert-identity';
export {
  LIMITES_SMOKE_ADN,
  TransporteUmaRequisicaoAdn,
  TransporteLimiteRequisicoesAdn,
  executarSmokeAdn,
  formatarResumoSmokeAdn,
  type DependenciasSmokeAdn,
  type EntradaSmokeAdn,
  type ResumoSmokeAdn,
} from './smoke-service';
export {
  LIMITES_SYNC_CONTROLADA_ADN,
  MAX_DOCS_SYNC_CONTROLADA,
  MAX_DOCS_POR_LOTE_SYNC_CONTROLADA,
  MAX_REQUESTS_HARNESS_ADN,
  MIN_RATE_LIMIT_MS_HARNESS_ADN,
  MAX_BYTES_CNPJ_HARNESS_ADN,
  ENV_ADN_HOMOLOG_ROOT,
  resolverRaizHomologacaoAdn,
  garantirArvoreHomologacaoAdn,
  normalizarLimitesHarnessAdn,
  verificarEspacoHomologacaoAdn,
  consolidarRelatorioSyncAdn,
  lerRelatorioConsolidadoAdn,
  executarSyncControladaAdn,
  formatarResumoSyncControladaAdn,
  type EntradaSyncControladaAdn,
  type DependenciasSyncControladaAdn,
  type ResumoSyncControladaAdn,
  type RelatorioConsolidadoAdn,
} from './controlled-sync-service';
export type { PersistenciaSyncAdnResumo, MotivoXmlInvalidoAdn } from './types';
export {
  NOME_FLAG_ADN_INICIAR,
  NOME_ALLOWLIST_ADN_INICIAR,
  lerFlagAdnIniciar,
  flagAdnIniciarAtiva,
  killSwitchAdnIniciarAtivo,
  lerAllowlistAdnIniciar,
  cnpjNaAllowlistAdnIniciar,
} from './iniciar-feature-flag';
export {
  carregarConfigAdnIniciar,
  salvarConfigAdnIniciar,
  lerConfigAdnIniciarMemoria,
  configAdnIniciarPadrao,
  setConfigAdnIniciarParaTestes,
  resetConfigAdnIniciarParaTestes,
  aplicarHomologRootConfigNoEnv,
  cnpjNaExcecaoPlaywrightAdn,
  type ConfigAdnIniciarProduto,
} from './iniciar-config';
export {
  decidirAdnIniciar,
  type ContextoRoteamentoAdnIniciar,
  type DecisaoRoteamentoAdnIniciar,
  type AutorizacaoAdnIniciar,
  type SituacaoRoteamentoAdnIniciar,
} from './iniciar-routing';
export {
  executarFluxoAdnIniciar,
  type EntradaFluxoAdnIniciar,
  type DependenciasFluxoAdnIniciar,
  type ResultadoFluxoAdnIniciar,
} from './iniciar-executor';
export {
  setSyncAdnIniciarParaTestes,
  setFonteInventarioPersistidoParaTestes,
  autorizarAdnIniciarEmpresa,
  limparAutorizacoesAdnIniciar,
  obterAutorizacaoAdnIniciarRuntime,
  resetIniciarAdnRuntimeParaTestes,
  obterDependenciasAdnIniciar,
  criarExecutarSyncAdnIniciarPadrao,
  syncAdnIniciarFixoParaTestes,
} from './iniciar-runtime';
export {
  listarCompetenciasDoPeriodo,
  consolidarInventarioPersistidoAdn,
  decidirResultadoFinalAdnIniciar,
  formatarMotivoConsolidacaoAdn,
  InventarioPersistidoArquivoAdn,
  InventarioPersistidoMemoriaAdn,
  type ContagensClassificacaoAdn,
  type ContagensCompetenciaAdn,
  type ConsolidacaoInventarioPersistidoAdn,
  type FonteInventarioPersistidoAdn,
  type ResultadoFinalAdnIniciar,
} from './inventario-persistido';
export {
  listarXmlsAdnCompetenciaOperacional,
  exportarXmlAdnIdempotente,
  exportarAdnParaDownloadsOperacionais,
  validarXmlsOperacionaisExportados,
  type EntradaExportacaoDownloadsAdn,
  type ResultadoExportacaoDownloadsAdn,
  type XmlAdnParaExportacao,
} from './exportar-downloads-operacionais';
