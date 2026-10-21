/**
 * Bootstrap opcional do canal admin UDS no processo Backend.
 * Desativado por padrão. Falha explícita se configurado e inseguro.
 */
import { getLogger } from '../../../../infrastructure/logger';
import { HomologacaoNfseError } from '../types';
import { lerConfigAdminSocket } from './admin-config';
import { carregarSegredoAdmin } from './admin-seguranca';
import { iniciarAdminServidorUds, type AdminServidorAtivo } from './admin-servidor';

const logger = getLogger('homologacao-admin-bootstrap');

let servidorAtivo: AdminServidorAtivo | null = null;

export type ResultadoBootstrapAdmin =
  | { readonly status: 'desativado' }
  | { readonly status: 'ativo'; readonly socketPath: string }
  | { readonly status: 'recusado'; readonly codigo: string; readonly motivo: string };

export async function aplicarBootstrapAdminSocket(
  env: NodeJS.ProcessEnv = process.env
): Promise<ResultadoBootstrapAdmin> {
  const cfg = lerConfigAdminSocket(env);
  if (!cfg.habilitado) {
    logger.info('Canal admin UDS desativado (env ausente)');
    return { status: 'desativado' };
  }

  try {
    const segredo = await carregarSegredoAdmin({
      secretFile: cfg.secretFile,
      secretInline: cfg.secretInline,
    });
    const ativo = await iniciarAdminServidorUds({
      socketDir: cfg.socketDir,
      segredo,
    });
    servidorAtivo = ativo;
    return { status: 'ativo', socketPath: ativo.socketPath };
  } catch (erro) {
    servidorAtivo = null;
    const codigo =
      erro instanceof HomologacaoNfseError ? erro.codigo : 'CONTEXTO_INVALIDO';
    const motivo = erro instanceof Error ? erro.message : 'Falha no canal admin';
    logger.error({ codigo, motivo }, 'Bootstrap admin UDS recusado — falha explícita');
    return { status: 'recusado', codigo, motivo };
  }
}

export async function encerrarAdminSocket(): Promise<void> {
  const ativo = servidorAtivo;
  servidorAtivo = null;
  if (ativo) {
    await ativo.fechar();
  }
}

export function obterAdminSocketAtivo(): AdminServidorAtivo | null {
  return servidorAtivo;
}
