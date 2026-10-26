/**
 * Bootstrap mínimo do canal Discovery-Only no processo da ponte.
 *
 * Configurar o store ≠ autorizar Discovery.
 * Não emite, não ativa, não executa descoberta, não abre o gate.
 */
import { getLogger } from '../../../infrastructure/logger';
import {
  configurarCanalHomologacaoOperacional,
  criarCanalAutorizacaoArquivo,
} from './canal-autorizacao';
import {
  ENV_HOMOLOGACAO_STORE,
  lerCaminhoStorePrivilegiado,
  prepararStoreHomologacaoSeguro,
} from './store-homologacao-seguro';
import { HomologacaoNfseError } from './types';

const logger = getLogger('homologacao-bootstrap');

export type ResultadoBootstrapCanal =
  | { readonly status: 'ausente' }
  | { readonly status: 'configurado'; readonly store: string }
  | { readonly status: 'recusado'; readonly motivo: string; readonly codigo: string };

/**
 * Lê env privilegiada e monta o canal em arquivo no processo atual.
 * Sem env → canal null (legado). Store inseguro → canal null + recusa.
 */
export async function aplicarBootstrapCanalHomologacao(
  env: NodeJS.ProcessEnv = process.env
): Promise<ResultadoBootstrapCanal> {
  const caminho = lerCaminhoStorePrivilegiado(env);
  if (!caminho) {
    configurarCanalHomologacaoOperacional(null);
    logger.info(
      { env: ENV_HOMOLOGACAO_STORE, presente: false },
      'Canal homologação ausente — fluxo legado preservado'
    );
    return { status: 'ausente' };
  }

  try {
    const store = await prepararStoreHomologacaoSeguro(caminho);
    const canal = criarCanalAutorizacaoArquivo(store);
    configurarCanalHomologacaoOperacional(canal);
    logger.info(
      {
        store,
        ativacaoAutomatica: false,
        emissaoAutomatica: false,
        gateAberto: false,
        discoverNoStartup: false,
      },
      'Canal homologação configurado (somente store; sem autorização automática)'
    );
    return { status: 'configurado', store };
  } catch (erro) {
    configurarCanalHomologacaoOperacional(null);
    const codigo =
      erro instanceof HomologacaoNfseError ? erro.codigo : 'DIRETORIO_INSEGURO';
    const motivo = erro instanceof Error ? erro.message : 'Store inseguro';
    logger.error(
      { codigo, motivo, caminhoInformado: caminho },
      'Bootstrap do canal recusado — legado preservado'
    );
    return { status: 'recusado', motivo, codigo };
  }
}
