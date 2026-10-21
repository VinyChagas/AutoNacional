export { discoverNfse } from './discovery-service';
export type { DiscoverNfseInput } from './discovery-service';
export { executarDescoberta } from './discovery-runner';
export { exigirControleDescoberta } from './controle-descoberta';
export { analisarHrefDownload, extrairChaveDaLinha } from './chave';
export { interpretarHtmlTabela, registroDaLinha } from './row-parser';
export {
  LIMITE_SEGURANCA_PAGINAS,
  comFingerprint,
  fingerprintPagina,
  textoIndicaSemRegistros,
} from './pagination';
export { confirmarFiltroAplicado, urlConfirmaPesquisa } from './discovery-validation';
export type {
  ControleDescoberta,
  DiagnosticoDescoberta,
  EtapaControleDescoberta,
  EvidenciaSituacaoBruta,
  LeituraFiltroPortal,
  LinhaListagem,
  PaginaListagem,
  PortalListagem,
  RegistroDescobertaNfse,
  ResultadoDescobertaNfse,
  StatusDescobertaNfse,
  TipoConsultaDescoberta,
} from './types';
