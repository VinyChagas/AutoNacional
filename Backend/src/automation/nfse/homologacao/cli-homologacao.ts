#!/usr/bin/env npx ts-node
/**
 * CLI administrativa local — homologação DISCOVERY_ONLY.
 *
 * Tickets (store):
 *   npm run homologacao:cli -- consultar|emitir|ativar|cancelar ...
 *
 * Canal admin UDS (diagnóstico):
 *   npm run homologacao:cli -- admin health --socket-dir /abs/dir --secret-file /abs/secret
 *   npm run homologacao:cli -- admin status --socket-dir /abs/dir --secret-file /abs/secret
 *
 * Não inicia navegador, Discovery, SEFIN nem enfileira jobs.
 */
import * as path from 'node:path';
import {
  ENV_HOMOLOGACAO_STORE,
  lerCaminhoStorePrivilegiado,
} from './store-homologacao-seguro';
import { HomologacaoNfseError } from './types';
import { mascararCnpjCli } from './cli-auditoria';
import { cliAtivar, cliCancelar, cliConsultar, cliEmitir } from './cli-homologacao-ops';
import {
  ADMIN_SOCKET_FILENAME,
  ENV_ADMIN_SECRET,
  ENV_ADMIN_SECRET_FILE,
  ENV_ADMIN_SOCKET_DIR,
  enviarComandoAdminUds,
} from './admin';
import type { AdminOp } from './admin';
import { carregarSegredoAdmin } from './admin/admin-seguranca';

type Args = Record<string, string | boolean>;

function parseArgs(argv: string[]): { comando: string; sub?: string; args: Args } {
  const [comando = '', ...rest] = argv;
  if (comando === 'admin') {
    const [sub = '', ...tail] = rest;
    return { comando: 'admin', sub, args: parseFlags(tail) };
  }
  return { comando, args: parseFlags(rest) };
}

function parseFlags(rest: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < rest.length; i += 1) {
    const tok = rest[i]!;
    if (!tok.startsWith('--')) continue;
    const chave = tok.slice(2);
    const prox = rest[i + 1];
    if (prox && !prox.startsWith('--')) {
      args[chave] = prox;
      i += 1;
    } else {
      args[chave] = true;
    }
  }
  return args;
}

function str(args: Args, chave: string): string {
  const v = args[chave];
  if (typeof v !== 'string' || !v.trim()) {
    throw new HomologacaoNfseError('CONTEXTO_INVALIDO', `Parâmetro --${chave} obrigatório.`);
  }
  return v.trim();
}

function optNum(args: Args, chave: string): number | undefined {
  const v = args[chave];
  if (typeof v !== 'string') return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) {
    throw new HomologacaoNfseError('CONTEXTO_INVALIDO', `--${chave} inválido.`);
  }
  return n;
}

function resolverStore(args: Args): string {
  if (typeof args.store === 'string' && args.store.trim()) {
    return args.store.trim();
  }
  const env = lerCaminhoStorePrivilegiado();
  if (env) return env;
  throw new HomologacaoNfseError(
    'DIRETORIO_INSEGURO',
    `Informe --store absoluto ou ${ENV_HOMOLOGACAO_STORE}.`
  );
}

/**
 * Segredo apenas via arquivo (nunca --secret em argv — evita exposição em ps).
 * Em não-produção, ENV_ADMIN_SECRET pode ser usado como fallback de teste.
 */
async function resolverTokenAdmin(args: Args): Promise<string> {
  if (typeof args.secret === 'string') {
    throw new HomologacaoNfseError(
      'CONTEXTO_INVALIDO',
      'Não use --secret em argv. Informe --secret-file (0600).'
    );
  }
  const fileArg =
    typeof args['secret-file'] === 'string' && args['secret-file'].trim()
      ? args['secret-file'].trim()
      : null;
  const fileEnv = process.env[ENV_ADMIN_SECRET_FILE]?.trim() || null;
  const inline =
    process.env.NODE_ENV === 'production'
      ? null
      : process.env[ENV_ADMIN_SECRET]?.trim() || null;
  return carregarSegredoAdmin({
    secretFile: fileArg || fileEnv,
    secretInline: inline,
  });
}

function resolverSocketPath(args: Args): string {
  if (typeof args.socket === 'string' && args.socket.trim()) {
    return args.socket.trim();
  }
  const dir =
    (typeof args['socket-dir'] === 'string' && args['socket-dir'].trim()) ||
    process.env[ENV_ADMIN_SOCKET_DIR]?.trim() ||
    '';
  if (!dir) {
    throw new HomologacaoNfseError(
      'DIRETORIO_INSEGURO',
      `Informe --socket-dir / --socket ou ${ENV_ADMIN_SOCKET_DIR}.`
    );
  }
  if (!path.isAbsolute(dir)) {
    throw new HomologacaoNfseError('DIRETORIO_INSEGURO', 'socket-dir deve ser absoluto.');
  }
  return path.join(dir, ADMIN_SOCKET_FILENAME);
}

async function main(): Promise<void> {
  const { comando, sub, args } = parseArgs(process.argv.slice(2));
  if (!comando || args.help === true || comando === 'help') {
    imprimirAjuda();
    process.exit(comando ? 0 : 1);
  }

  if (comando === 'admin') {
    await rodarAdmin(sub ?? '', args);
    return;
  }

  const store = resolverStore(args);

  switch (comando) {
    case 'consultar': {
      const { ticket } = await cliConsultar(store, str(args, 'execucao-id'));
      if (!ticket) {
        console.log(JSON.stringify({ encontrado: false, execucaoId: str(args, 'execucao-id') }));
        return;
      }
      console.log(
        JSON.stringify(
          {
            encontrado: true,
            autorizacaoId: ticket.autorizacaoId,
            execucaoId: ticket.autorizacao.execucaoId,
            estado: ticket.estado,
            ativacaoDiscoveryReal: ticket.ativacaoDiscoveryReal,
            operacao: ticket.autorizacao.operacao,
            validoAte: ticket.autorizacao.validoAte,
            cnpjMascarado: mascararCnpjCli(ticket.autorizacao.cnpj),
          },
          null,
          2
        )
      );
      return;
    }
    case 'emitir': {
      const ticket = await cliEmitir({
        store,
        execucaoId: str(args, 'execucao-id'),
        cnpj: str(args, 'cnpj'),
        periodoInicio: str(args, 'periodo-inicio'),
        periodoFim: str(args, 'periodo-fim'),
        diretorioFiscal: str(args, 'diretorio-fiscal'),
        validoAte: str(args, 'valido-ate'),
        motivo: str(args, 'motivo'),
        maxDocumentos: optNum(args, 'max-documentos'),
        maxPaginas: optNum(args, 'max-paginas'),
        timeoutMs: optNum(args, 'timeout-ms'),
      });
      console.log(
        JSON.stringify(
          {
            ok: true,
            autorizacaoId: ticket.autorizacaoId,
            execucaoId: ticket.autorizacao.execucaoId,
            estado: ticket.estado,
            ativacaoDiscoveryReal: ticket.ativacaoDiscoveryReal,
          },
          null,
          2
        )
      );
      return;
    }
    case 'ativar': {
      const ticket = await cliAtivar({
        store,
        autorizacaoId: str(args, 'autorizacao-id'),
        motivo: str(args, 'motivo'),
      });
      console.log(
        JSON.stringify(
          {
            ok: true,
            autorizacaoId: ticket.autorizacaoId,
            ativacaoDiscoveryReal: ticket.ativacaoDiscoveryReal,
            ativacaoEm: ticket.ativacaoEm,
          },
          null,
          2
        )
      );
      return;
    }
    case 'cancelar': {
      await cliCancelar({
        store,
        autorizacaoId: str(args, 'autorizacao-id'),
        motivo: str(args, 'motivo'),
      });
      console.log(JSON.stringify({ ok: true, estado: 'CANCELADA' }, null, 2));
      return;
    }
    default:
      throw new HomologacaoNfseError(
        'CONTEXTO_INVALIDO',
        `Comando desconhecido: ${comando}. Use consultar|emitir|ativar|cancelar|admin.`
      );
  }
}

async function rodarAdmin(sub: string, args: Args): Promise<void> {
  if (sub !== 'health' && sub !== 'status') {
    throw new HomologacaoNfseError(
      'CONTEXTO_INVALIDO',
      'Use: admin health | admin status'
    );
  }
  const op = sub as AdminOp;
  const socketPath = resolverSocketPath(args);
  const token = await resolverTokenAdmin(args);
  const resposta = await enviarComandoAdminUds({ socketPath, token, op });
  console.log(JSON.stringify(resposta, null, 2));
  if (!resposta.ok) {
    process.exit(1);
  }
}

function imprimirAjuda(): void {
  console.log(`CLI homologação DISCOVERY_ONLY (local, sem HTTP)

Comandos de ticket (store):
  consultar  --store PATH --execucao-id ID
  emitir     --store PATH --execucao-id ID --cnpj CNPJ ...
  ativar     --store PATH --autorizacao-id ID --motivo TEXTO
  cancelar   --store PATH --autorizacao-id ID --motivo TEXTO

Comandos admin UDS (diagnóstico; sem preparar/liberar):
  admin health  --socket-dir PATH --secret-file PATH
  admin status  --socket-dir PATH --secret-file PATH

Não passe segredo em argv (--secret é recusado).
Env store: ${ENV_HOMOLOGACAO_STORE}
Env admin: ${ENV_ADMIN_SOCKET_DIR}, ${ENV_ADMIN_SECRET_FILE}
Não inicia Discovery, navegador, SEFIN nem PQueue.`);
}

main().catch((erro) => {
  const codigo = erro instanceof HomologacaoNfseError ? erro.codigo : 'ERRO';
  const mensagem = erro instanceof Error ? erro.message : String(erro);
  console.error(JSON.stringify({ ok: false, codigo, mensagem }));
  process.exit(1);
});
