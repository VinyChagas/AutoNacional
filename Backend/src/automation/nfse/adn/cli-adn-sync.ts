#!/usr/bin/env npx ts-node
/**
 * CLI sync ADN controlada — exatamente 1 GET /DFe/{NSU}, persistência em homologação.
 *
 * Homologação (quando autorizada — NÃO executar nesta etapa de implementação):
 *   NFSE_ALLOW_LIVE=true ADN_HOMOLOG_ROOT=/caminho/isolado npm run adn:sync -- \
 *     --cnpj 00000000000000 --nsu 1 --ambiente producao --confirm-live
 *
 * Regras:
 * - Certificado A1 do cadastro AutoNacional + validação de CNPJ
 * - Gate NFSE_ALLOW_LIVE + --confirm-live
 * - 1 requisição, até 50 documentos
 * - Checkpoint/documentos/locks sob raiz de homologação isolada
 * - Sem Playwright, SEFIN, Iniciar, Angular, legado
 * - Saída sanitizada
 */
import type { AmbienteAdn } from './endpoints';
import {
  executarSyncControladaAdn,
  formatarResumoSyncControladaAdn,
} from './controlled-sync-service';

type Args = Record<string, string | boolean>;

function parseFlags(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const tok = argv[i]!;
    if (!tok.startsWith('--')) continue;
    const chave = tok.slice(2);
    const prox = argv[i + 1];
    if (prox && !prox.startsWith('--')) {
      args[chave] = prox;
      i += 1;
    } else {
      args[chave] = true;
    }
  }
  return args;
}

function uso(): never {
  console.error(
    [
      'Uso:',
      '  NFSE_ALLOW_LIVE=true npm run adn:sync -- \\',
      '    --cnpj <14dig> --ambiente producao|producao-restrita --confirm-live \\',
      '    [--nsu <n>] [--raiz <dir>] [--resume]',
      '',
      'Obrigatório: --cnpj --ambiente --confirm-live',
      'Gate: NFSE_ALLOW_LIVE=true|1',
      'Raiz: --raiz ou ADN_HOMOLOG_ROOT (senão .adn-homologacao no cwd)',
      'Limite: 1 GET /DFe/{NSU}?lote=true — até 50 docs — com checkpoint/lock isolados.',
      'Sem SEFIN/Playwright/Iniciar.',
    ].join('\n')
  );
  process.exit(2);
}

async function main(): Promise<void> {
  const args = parseFlags(process.argv.slice(2));
  if (args.help === true || args.h === true) uso();

  const cnpj = typeof args.cnpj === 'string' ? args.cnpj.trim() : '';
  const ambienteRaw = typeof args.ambiente === 'string' ? args.ambiente.trim() : '';
  const confirmLive = args['confirm-live'] === true || args.confirmLive === true;
  const nsuRaw = typeof args.nsu === 'string' ? args.nsu.trim() : '';
  const raiz =
    typeof args.raiz === 'string'
      ? args.raiz.trim()
      : typeof args['raiz-homologacao'] === 'string'
        ? String(args['raiz-homologacao']).trim()
        : undefined;
  const resume = args.resume === true || args['no-resume'] !== true;

  if (!cnpj || !ambienteRaw) uso();

  if (ambienteRaw !== 'producao' && ambienteRaw !== 'producao-restrita') {
    console.error('--ambiente deve ser producao ou producao-restrita.');
    process.exit(2);
  }
  const ambiente = ambienteRaw as AmbienteAdn;

  let nsu: number | undefined;
  if (nsuRaw) {
    nsu = Number(nsuRaw);
    if (!Number.isInteger(nsu) || nsu < 0) {
      console.error('NSU inválido.');
      process.exit(2);
    }
  }

  const resumo = await executarSyncControladaAdn({
    cnpj,
    ambiente,
    confirmLive,
    nsu,
    resume,
    raizHomologacao: raiz,
    env: process.env,
  });

  console.log(formatarResumoSyncControladaAdn(resumo));
  process.exit(resumo.ok ? 0 : 1);
}

main().catch((erro) => {
  const msg = erro instanceof Error ? erro.message : 'Falha na sync controlada ADN.';
  console.error(`codigoErro: FALHA_CLI\nmotivo: ${msg.slice(0, 200)}`);
  process.exit(1);
});
