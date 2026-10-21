/**
 * Configuração privilegiada do canal admin UDS (H2.2.4-B1).
 * Desativado por padrão. Não autoriza Discovery-Only.
 */
export const ENV_ADMIN_SOCKET_DIR = 'AUTONACIONAL_HOMOLOGACAO_ADMIN_SOCKET_DIR';
export const ENV_ADMIN_SECRET_FILE = 'AUTONACIONAL_HOMOLOGACAO_ADMIN_SECRET_FILE';
/** Apenas testes / emergência — preferir arquivo 0600. */
export const ENV_ADMIN_SECRET = 'AUTONACIONAL_HOMOLOGACAO_ADMIN_SECRET';

export const ADMIN_SOCKET_FILENAME = 'homologacao-admin.sock';
export const ADMIN_PROTOCOL_VERSION = 1 as const;
export const ADMIN_MAX_MESSAGE_BYTES = 4_096;
export const ADMIN_IO_TIMEOUT_MS = 5_000;

export type ConfigAdminSocket =
  | { readonly habilitado: false }
  | {
      readonly habilitado: true;
      readonly socketDir: string;
      readonly secretFile: string | null;
      readonly secretInline: string | null;
    };

export function lerConfigAdminSocket(
  env: NodeJS.ProcessEnv = process.env
): ConfigAdminSocket {
  const socketDir = env[ENV_ADMIN_SOCKET_DIR]?.trim() ?? '';
  if (!socketDir) {
    return { habilitado: false };
  }
  return {
    habilitado: true,
    socketDir,
    secretFile: env[ENV_ADMIN_SECRET_FILE]?.trim() || null,
    secretInline: env[ENV_ADMIN_SECRET]?.trim() || null,
  };
}
