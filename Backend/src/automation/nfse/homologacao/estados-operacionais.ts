/**
 * Estados operacionais da homologação Discovery-Only (H2.2.2-A).
 */
import type { CodigoErroHomologacao, VereditoDiscoveryOnly } from './types';

export const ESTADOS_OPERACIONAIS_HOMOLOGACAO = [
  'BLOQUEADA',
  'CONCLUIDA',
  'INCOMPLETA',
  'FALHA',
  'CANCELADA',
] as const;
export type EstadoOperacionalHomologacao = (typeof ESTADOS_OPERACIONAIS_HOMOLOGACAO)[number];

export function mapearVereditoParaEstadoOperacional(
  veredito: VereditoDiscoveryOnly,
  codigoErro: CodigoErroHomologacao | null,
  canceladoPorSignal: boolean
): EstadoOperacionalHomologacao {
  if (canceladoPorSignal || codigoErro === 'INTERRUPCAO') {
    return 'CANCELADA';
  }
  if (veredito === 'PASS') {
    return 'CONCLUIDA';
  }
  if (veredito === 'INCOMPLETO') {
    return 'INCOMPLETA';
  }
  if (codigoErro === 'TIMEOUT') {
    return 'INCOMPLETA';
  }
  return 'FALHA';
}
