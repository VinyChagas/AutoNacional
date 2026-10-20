export { recuperarXmlNfse, planejarRecuperacaoSefin } from './recovery-service';
export type { PlanoRecuperacaoSefin } from './recovery-service';
export { inspecionarCredencialMtls } from './mtls-provider';
export type { ProvedorCredencialMtls } from './mtls-provider';
export { criarTransporteHttpsMtls, montarUrlConsultaSefin, classificarFalhaTransporte } from './sefin-client';
export { extrairXmlDaRespostaSefin } from './response-parser';
export { validarXmlNfse, NAMESPACE_OFICIAL_NFSE, extrairNamespaceRaizNfse } from './xml-validator';
export { ErroRecuperacaoSefin, LIMITES_RECUPERACAO_PADRAO, URL_BASE_SEFIN } from './types';
export type {
  CredencialMtls,
  EntradaRecuperacaoSefin,
  ResultadoRecuperacaoSefin,
  TransporteHttpMtls,
} from './types';
