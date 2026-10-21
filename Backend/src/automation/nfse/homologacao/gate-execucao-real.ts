/**
 * Gate de execução real DISCOVERY_ONLY (H2.2.1).
 * Fechado por padrão — autorização prepara o canal, não navega no Portal.
 *
 * H2.2.2 abrirá este gate por mecanismo explícito e revisado.
 * Não há ativação por env, flag genérica ou autorização de teste.
 */

/** Constante auditável: execução real desabilitada nesta etapa. */
export const GATE_EXECUCAO_REAL_DISCOVERY_ONLY = false as boolean;

export function execucaoRealDiscoveryOnlyHabilitada(): boolean {
  return GATE_EXECUCAO_REAL_DISCOVERY_ONLY;
}
