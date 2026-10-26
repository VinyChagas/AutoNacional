/**
 * Checagens cooperativas de AbortSignal / callback entre etapas da descoberta.
 * Não cancela operações Playwright já em andamento.
 */
import { ContratoNfseError } from '../contracts/erros';
import type { ControleDescoberta, EtapaControleDescoberta } from './types';

export function exigirControleDescoberta(
  controle: ControleDescoberta | undefined,
  etapa: EtapaControleDescoberta
): void {
  if (controle?.signal?.aborted) {
    throw new ContratoNfseError(`Descoberta interrompida (${etapa}).`);
  }
  controle?.antesDeOperacao?.(etapa);
  if (controle?.signal?.aborted) {
    throw new ContratoNfseError(`Descoberta interrompida após ${etapa}.`);
  }
}
