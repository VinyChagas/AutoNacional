/**
 * Gate de execução live ADN.
 * Exige NFSE_ALLOW_LIVE=true (ou 1) e --confirm-live.
 * Fechado por padrão — sem rede real.
 */

export const ENV_ADN_ALLOW_LIVE = 'NFSE_ALLOW_LIVE';

export type ResultadoGateLiveAdn =
  | { ok: true; allowLiveEnv: true; confirmLiveCli: true }
  | { ok: false; allowLiveEnv: boolean; confirmLiveCli: boolean; codigo: string; motivo: string };

export function lerAllowLiveEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const bruto = env[ENV_ADN_ALLOW_LIVE];
  if (bruto === undefined || bruto === null) return false;
  const v = String(bruto).trim().toLowerCase();
  return v === 'true' || v === '1';
}

export function avaliarGateLiveAdn(params: {
  confirmLive: boolean;
  env?: NodeJS.ProcessEnv;
}): ResultadoGateLiveAdn {
  const allowLiveEnv = lerAllowLiveEnv(params.env ?? process.env);
  const confirmLiveCli = Boolean(params.confirmLive);

  if (!allowLiveEnv && !confirmLiveCli) {
    return {
      ok: false,
      allowLiveEnv,
      confirmLiveCli,
      codigo: 'GATE_FECHADO',
      motivo:
        'Gate live fechado: defina NFSE_ALLOW_LIVE=true e passe --confirm-live. Nenhuma chamada ADN será feita.',
    };
  }
  if (!allowLiveEnv) {
    return {
      ok: false,
      allowLiveEnv,
      confirmLiveCli,
      codigo: 'GATE_FECHADO',
      motivo:
        'NFSE_ALLOW_LIVE deve ser true (ou 1). Chamadas reais ao ADN estão bloqueadas.',
    };
  }
  if (!confirmLiveCli) {
    return {
      ok: false,
      allowLiveEnv,
      confirmLiveCli,
      codigo: 'CONFIRMACAO_AUSENTE',
        motivo:
          'Passe --confirm-live para autorizar explicitamente esta execução live ADN.',
    };
  }
  return { ok: true, allowLiveEnv: true, confirmLiveCli: true };
}
