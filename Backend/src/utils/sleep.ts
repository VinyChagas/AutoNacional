/**
 * Utilitário para delay assíncrono (setTimeout promissificado).
 * Usado no producer para espaçar o enfileiramento de execuções.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
