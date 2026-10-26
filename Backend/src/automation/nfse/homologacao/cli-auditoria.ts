/**
 * Auditoria append-only das operações da CLI de homologação.
 * Sem senhas, PFX, cookies, tokens, XML ou chaves fiscais completas.
 *
 * Escrita: O_APPEND (POSIX) — evita read-modify-write concorrente.
 * Modo arquivo: 0600 verificado.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { mascararCnpjHomologacao } from './evidencias';
import { prepararStoreHomologacaoSeguro } from './store-homologacao-seguro';
import { HomologacaoNfseError } from './types';

export type EventoAuditoriaCli =
  | 'cli_emissao'
  | 'cli_ativacao'
  | 'cli_cancelamento'
  | 'cli_consulta'
  | 'cli_recusada';

export interface RegistroAuditoriaCli {
  readonly versao: 1;
  readonly em: string;
  readonly evento: EventoAuditoriaCli;
  readonly autorizacaoId?: string;
  readonly execucaoId?: string;
  readonly cnpjMascarado?: string;
  readonly periodo?: { readonly inicio: string; readonly fim: string };
  readonly estadoTicket?: string;
  readonly motivo?: string;
  readonly codigoErro?: string;
  readonly detalhe?: string;
}

const MODE_FILE = 0o600;

export async function registrarAuditoriaCli(
  storeRoot: string,
  registro: Omit<RegistroAuditoriaCli, 'versao' | 'em'> & { agora?: Date }
): Promise<string> {
  const store = await prepararStoreHomologacaoSeguro(storeRoot);
  const pasta = path.join(store, '_auditoria');
  await fs.mkdir(pasta, { recursive: true, mode: 0o700 });
  await fs.chmod(pasta, 0o700);

  const lstPasta = await fs.lstat(pasta);
  if (lstPasta.isSymbolicLink()) {
    throw new HomologacaoNfseError(
      'DIRETORIO_INSEGURO',
      'Pasta de auditoria não pode ser symlink.'
    );
  }

  const linha: RegistroAuditoriaCli = {
    versao: 1,
    em: (registro.agora ?? new Date()).toISOString(),
    evento: registro.evento,
    autorizacaoId: registro.autorizacaoId,
    execucaoId: registro.execucaoId,
    cnpjMascarado: registro.cnpjMascarado,
    periodo: registro.periodo,
    estadoTicket: registro.estadoTicket,
    motivo: sanitizarTextoAuditoria(registro.motivo),
    codigoErro: registro.codigoErro,
    detalhe: sanitizarTextoAuditoria(registro.detalhe),
  };

  const arquivo = path.join(pasta, 'cli-audit.jsonl');
  const payload = `${JSON.stringify(linha)}\n`;

  // Append exclusivo de linha — não reescreve o arquivo inteiro.
  const fh = await fs.open(arquivo, 'a', MODE_FILE);
  try {
    await fh.writeFile(payload, 'utf8');
    await fh.chmod(MODE_FILE);
  } finally {
    await fh.close();
  }

  const st = await fs.stat(arquivo);
  if ((st.mode & 0o077) !== 0) {
    throw new HomologacaoNfseError(
      'DIRETORIO_INSEGURO',
      'Permissões do arquivo de auditoria inadequadas (esperado 0600).'
    );
  }

  return arquivo;
}

export function mascararCnpjCli(cnpj: string): string {
  return mascararCnpjHomologacao(cnpj);
}

/** Remove padrões sensíveis de motivo/detalhe antes de persistir. */
export function sanitizarTextoAuditoria(texto: string | undefined): string | undefined {
  if (texto == null) return undefined;
  const limpo = texto
    .replace(/senha[=:\s]\S+/gi, 'senha=***')
    .replace(/passphrase[=:\s]\S+/gi, 'passphrase=***')
    .replace(/password[=:\s]\S+/gi, 'password=***')
    .replace(/token[=:\s]\S+/gi, 'token=***')
    .replace(/cookie[=:\s]\S+/gi, 'cookie=***')
    .replace(/\b\d{50}\b/g, '[chave-omitida]')
    .slice(0, 200);
  return limpo.length > 0 ? limpo : undefined;
}
