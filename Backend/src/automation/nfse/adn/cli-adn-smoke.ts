#!/usr/bin/env npx ts-node
/**
 * CLI smoke ADN — exatamente 1 GET /DFe/{NSU}.
 *
 * Homologação (quando autorizada — NÃO executar nesta etapa de implementação):
 *   NFSE_ALLOW_LIVE=true npm run adn:smoke -- \
 *     --cnpj 00000000000000 --nsu 1 --ambiente producao --confirm-live
 *
 * Regras:
 * - Certificado A1 do cadastro AutoNacional
 * - Gate NFSE_ALLOW_LIVE + --confirm-live
 * - Sem Playwright, SEFIN, checkpoint, retries
 * - Saída sanitizada (sem XML/PFX/senha/rawBody)
 */
import type { AmbienteAdn } from './endpoints';
import {
  executarSmokeAdn,
  formatarResumoSmokeAdn,
} from './smoke-service';

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
      '  NFSE_ALLOW_LIVE=true npm run adn:smoke -- --cnpj <14dig> --nsu <n> --ambiente producao|producao-restrita --confirm-live',
      '',
      'Obrigatório: --cnpj --nsu --ambiente --confirm-live',
      'Gate: NFSE_ALLOW_LIVE=true|1',
      'Exatamente 1 GET /DFe/{NSU}?lote=true — sem checkpoint/SEFIN/Playwright.',
    ].join('\n')
  );
  process.exit(2);
}

async function main(): Promise<void> {
  const args = parseFlags(process.argv.slice(2));
  if (args.help === true || args.h === true) uso();

  const cnpj = typeof args.cnpj === 'string' ? args.cnpj.trim() : '';
  const nsuRaw = typeof args.nsu === 'string' ? args.nsu.trim() : '';
  const ambienteRaw = typeof args.ambiente === 'string' ? args.ambiente.trim() : '';
  const confirmLive = args['confirm-live'] === true || args.confirmLive === true;

  if (!cnpj || !nsuRaw || !ambienteRaw) uso();

  const nsu = Number(nsuRaw);
  if (!Number.isInteger(nsu) || nsu < 0) {
    console.error('NSU inválido.');
    process.exit(2);
  }

  if (ambienteRaw !== 'producao' && ambienteRaw !== 'producao-restrita') {
    console.error('--ambiente deve ser producao ou producao-restrita.');
    process.exit(2);
  }
  const ambiente = ambienteRaw as AmbienteAdn;

  const resumo = await executarSmokeAdn({
    cnpj,
    nsu,
    ambiente,
    confirmLive,
    env: process.env,
  });

  console.log(formatarResumoSmokeAdn(resumo));
  process.exit(resumo.ok ? 0 : 1);
}

main().catch((erro) => {
  const msg = erro instanceof Error ? erro.message : 'Falha no smoke ADN.';
  // Nunca despejar stack com possíveis buffers.
  console.error(`codigoErro: FALHA_CLI\nmotivo: ${msg.slice(0, 200)}`);
  process.exit(1);
});
