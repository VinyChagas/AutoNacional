#!/usr/bin/env npx ts-node
/**
 * CLI administrativa local — homologação DISCOVERY_ONLY.
 *
 * Uso:
 *   npm run homologacao:cli -- consultar --store /abs/path --execucao-id 123
 *   npm run homologacao:cli -- emitir --store /abs/path --execucao-id 123 ...
 *   npm run homologacao:cli -- ativar --store /abs/path --autorizacao-id auth-... --motivo "..."
 *   npm run homologacao:cli -- cancelar --store /abs/path --autorizacao-id auth-... --motivo "..."
 *
 * Não inicia navegador, Discovery, SEFIN nem Backend HTTP.
 * Store: AUTONACIONAL_HOMOLOGACAO_STORE ou --store (absoluto).
 */
import {
  ENV_HOMOLOGACAO_STORE,
  lerCaminhoStorePrivilegiado,
} from './store-homologacao-seguro';
import { HomologacaoNfseError } from './types';
import { mascararCnpjCli } from './cli-auditoria';
import { cliAtivar, cliCancelar, cliConsultar, cliEmitir } from './cli-homologacao-ops';

type Args = Record<string, string | boolean>;

function parseArgs(argv: string[]): { comando: string; args: Args } {
  const [comando = '', ...rest] = argv;
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
  return { comando, args };
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

async function main(): Promise<void> {
  const { comando, args } = parseArgs(process.argv.slice(2));
  if (!comando || args.help === true || comando === 'help') {
    imprimirAjuda();
    process.exit(comando ? 0 : 1);
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
        `Comando desconhecido: ${comando}. Use consultar|emitir|ativar|cancelar.`
      );
  }
}

function imprimirAjuda(): void {
  console.log(`CLI homologação DISCOVERY_ONLY (local, sem HTTP)

Comandos:
  consultar  --store PATH --execucao-id ID
  emitir     --store PATH --execucao-id ID --cnpj CNPJ \\
             --periodo-inicio DD/MM/YYYY --periodo-fim DD/MM/YYYY \\
             --diretorio-fiscal /abs/path --valido-ate ISO --motivo TEXTO
  ativar     --store PATH --autorizacao-id ID --motivo TEXTO
  cancelar   --store PATH --autorizacao-id ID --motivo TEXTO

Env privilegiada (alternativa a --store): ${ENV_HOMOLOGACAO_STORE}
Não inicia Discovery, navegador, SEFIN nem Backend.`);
}

main().catch((erro) => {
  const codigo = erro instanceof HomologacaoNfseError ? erro.codigo : 'ERRO';
  const mensagem = erro instanceof Error ? erro.message : String(erro);
  console.error(JSON.stringify({ ok: false, codigo, mensagem }));
  process.exit(1);
});
