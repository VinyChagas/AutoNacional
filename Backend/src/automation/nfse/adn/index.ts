/**
 * Módulo ADN/NSU — descoberta por distribuição oficial (mTLS A1).
 * Sem Playwright. Sem ligação ao botão Iniciar. Sem chamadas reais nesta etapa.
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
  executarSmokeAdn,
  formatarResumoSmokeAdn,
  type DependenciasSmokeAdn,
  type EntradaSmokeAdn,
  type ResumoSmokeAdn,
} from './smoke-service';
export type { PersistenciaSyncAdnResumo, MotivoXmlInvalidoAdn } from './types';
