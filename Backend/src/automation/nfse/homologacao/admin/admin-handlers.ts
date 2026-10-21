/**
 * Handlers injetáveis de preparar/liberar — evita ciclo admin ↔ execution-service.
 * Registrados pelo execution-service no boot do processo.
 */
import { HomologacaoNfseError } from '../types';

export type AdminPrepararHandler = (
  params: Record<string, unknown>
) => Promise<Record<string, unknown>>;

export type AdminLiberarHandler = (
  params: Record<string, unknown>
) => Promise<Record<string, unknown>>;

let prepararHandler: AdminPrepararHandler | null = null;
let liberarHandler: AdminLiberarHandler | null = null;

export function registrarHandlersAdminPreparacaoLiberacao(entrada: {
  preparar: AdminPrepararHandler;
  liberar: AdminLiberarHandler;
}): void {
  prepararHandler = entrada.preparar;
  liberarHandler = entrada.liberar;
}

/** Somente testes — remove wire de produção. */
export function limparHandlersAdminPreparacaoLiberacaoSomenteTeste(): void {
  prepararHandler = null;
  liberarHandler = null;
}

export function handlersAdminPreparacaoLiberacaoAtivos(): boolean {
  return prepararHandler != null && liberarHandler != null;
}

export async function executarAdminPreparar(
  params: Record<string, unknown>
): Promise<Record<string, unknown>> {
  if (!prepararHandler) {
    throw new HomologacaoNfseError(
      'CONTEXTO_INVALIDO',
      'Handler admin preparar não registrado no processo Backend.'
    );
  }
  return prepararHandler(params);
}

export async function executarAdminLiberar(
  params: Record<string, unknown>
): Promise<Record<string, unknown>> {
  if (!liberarHandler) {
    throw new HomologacaoNfseError(
      'CONTEXTO_INVALIDO',
      'Handler admin liberar não registrado no processo Backend.'
    );
  }
  return liberarHandler(params);
}
