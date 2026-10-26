#!/usr/bin/env npx ts-node
/**
 * CLI sync ADN controlada — multi-lote com limites configuráveis.
 *
 * Homologação (quando autorizada):
 *   NFSE_ALLOW_LIVE=true ADN_HOMOLOG_ROOT=/caminho/isolado npm run adn:sync -- \
 *     --cnpj 00000000000000 --ambiente producao --confirm-live \
 *     --max-requests 5 --rate-limit-ms 250
 *
 * Regras:
 * - Certificado A1 do cadastro + validação de CNPJ
 * - Gate NFSE_ALLOW_LIVE + --confirm-live
 * - max-requests 1..20 (padrão 1); rate-limit-ms >= 250; max-bytes-cnpj <= 512MB
 * - SIGINT: conclui persistência do lote atual e não inicia nova GET
 * - Checkpoint/documentos/locks/relatorios sob raiz isolada
 * - Sem Playwright, SEFIN, Iniciar, Angular, legado
 */
import type { AmbienteAdn } from './endpoints';
import {
  MAX_BYTES_CNPJ_HARNESS_ADN,
  MAX_REQUESTS_HARNESS_ADN,
  MIN_RATE_LIMIT_MS_HARNESS_ADN,
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
      '    [--nsu <n>] [--raiz <dir>] [--max-requests 1..20] \\',
      `    [--rate-limit-ms >=${MIN_RATE_LIMIT_MS_HARNESS_ADN}] [--max-bytes-cnpj <=${MAX_BYTES_CNPJ_HARNESS_ADN}]`,
      '',
      'Obrigatório: --cnpj --ambiente --confirm-live',
      'Gate: NFSE_ALLOW_LIVE=true|1',
      `Padrões: max-requests=1, rate-limit-ms=${MIN_RATE_LIMIT_MS_HARNESS_ADN}, max-bytes-cnpj=${MAX_BYTES_CNPJ_HARNESS_ADN}`,
      `Teto max-requests: ${MAX_REQUESTS_HARNESS_ADN}`,
      'SIGINT: finaliza lote em andamento e não inicia nova requisição.',
      'Sem SEFIN/Playwright/Iniciar.',
    ].join('\n')
  );
  process.exit(2);
}

function parseInteiro(raw: string | undefined, nome: string): number | undefined {
  if (raw == null || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    console.error(`${nome} inválido.`);
    process.exit(2);
  }
  return n;
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

  const maxRequests = parseInteiro(
    typeof args['max-requests'] === 'string' ? args['max-requests'] : undefined,
    '--max-requests'
  );
  const rateLimitMs = parseInteiro(
    typeof args['rate-limit-ms'] === 'string' ? args['rate-limit-ms'] : undefined,
    '--rate-limit-ms'
  );
  const maxBytesCnpj = parseInteiro(
    typeof args['max-bytes-cnpj'] === 'string' ? args['max-bytes-cnpj'] : undefined,
    '--max-bytes-cnpj'
  );

  let interromper = false;
  const onSigInt = () => {
    interromper = true;
    console.error('SIGINT recebido — concluindo lote atual sem nova requisição ADN...');
  };
  process.on('SIGINT', onSigInt);

  try {
    const resumo = await executarSyncControladaAdn({
      cnpj,
      ambiente,
      confirmLive,
      nsu,
      resume,
      raizHomologacao: raiz,
      env: process.env,
      maxRequests,
      rateLimitMs,
      maxBytesCnpj,
      deveInterromper: () => interromper,
    });

    console.log(formatarResumoSyncControladaAdn(resumo));
    process.exit(resumo.ok ? 0 : 1);
  } finally {
    process.off('SIGINT', onSigInt);
  }
}

main().catch((erro) => {
  const msg = erro instanceof Error ? erro.message : 'Falha na sync controlada ADN.';
  console.error(`codigoErro: FALHA_CLI\nmotivo: ${msg.slice(0, 200)}`);
  process.exit(1);
});
