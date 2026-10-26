export {
  ENV_ADMIN_SOCKET_DIR,
  ENV_ADMIN_SECRET_FILE,
  ENV_ADMIN_SECRET,
  ADMIN_SOCKET_FILENAME,
  ADMIN_PROTOCOL_VERSION,
  lerConfigAdminSocket,
} from './admin-config';
export {
  aplicarBootstrapAdminSocket,
  encerrarAdminSocket,
  obterAdminSocketAtivo,
} from './admin-bootstrap';
export type { ResultadoBootstrapAdmin } from './admin-bootstrap';
export { enviarComandoAdminUds } from './admin-cliente';
export { parseAdminRequest, montarRespostaOk, montarRespostaErro } from './admin-protocolo';
export type { AdminOp, AdminRequest, AdminResponse } from './admin-protocolo';
export {
  prepararDiretorioAdminSocket,
  caminhoSocketAdmin,
  carregarSegredoAdmin,
  tokenAdminValido,
  classificarSocketExistente,
  removerSocketOrfaoSeguro,
  ADMIN_SECRET_MIN_LENGTH,
} from './admin-seguranca';
export { iniciarAdminServidorUds } from './admin-servidor';
export {
  registrarHandlersAdminPreparacaoLiberacao,
  limparHandlersAdminPreparacaoLiberacaoSomenteTeste,
  handlersAdminPreparacaoLiberacaoAtivos,
} from './admin-handlers';
