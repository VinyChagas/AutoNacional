/**
 * Gate de execução real DISCOVERY_ONLY.
 * Fechado por padrão — sem env, endpoint ou ativação operacional.
 *
 * H2.2.2-B: gate aberto sozinho NÃO autoriza descoberta.
 * Autorização suficiente = ticket + ativacaoDiscoveryReal individual.
 */

/** Constante auditável: execução real desabilitada por padrão. */
export const GATE_EXECUCAO_REAL_DISCOVERY_ONLY = false as boolean;

/** Override exclusivo de testes offline — nunca ligado ao execution-service. */
let overrideGateSomenteTeste: boolean | null = null;

export function execucaoRealDiscoveryOnlyHabilitada(): boolean {
  if (overrideGateSomenteTeste !== null) {
    return overrideGateSomenteTeste;
  }
  return GATE_EXECUCAO_REAL_DISCOVERY_ONLY;
}

/**
 * Injeção controlada para testes offline.
 * `null` restaura o padrão (gate fechado).
 * Não usar em código de produção / rotas / env.
 */
export function definirGateExecucaoRealSomenteTeste(valor: boolean | null): void {
  overrideGateSomenteTeste = valor;
}
