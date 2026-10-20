/**
 * Feature flag NFSE_NATIVE_RECOVERY_ENABLED.
 * Ausente ou false: desativada. true: habilitada.
 * Qualquer outro valor: falha segura (desativada) com diagnóstico.
 * Não carrega certificado, não abre navegador e não cria diretórios.
 */
import { OrquestracaoNfseError } from './types';

export const NOME_FLAG_RECUPERACAO_NATIVA = 'NFSE_NATIVE_RECOVERY_ENABLED';

export type LeituraFlagRecuperacaoNativa =
  | { ativa: false; motivo: 'AUSENTE' | 'FALSE' | 'INVALIDA'; valorBruto: string | null }
  | { ativa: true; motivo: 'TRUE'; valorBruto: 'true' };

export function lerFlagRecuperacaoNativa(
  env: NodeJS.ProcessEnv = process.env
): LeituraFlagRecuperacaoNativa {
  const bruto = env[NOME_FLAG_RECUPERACAO_NATIVA];
  if (bruto === undefined || bruto === null || String(bruto).trim() === '') {
    return { ativa: false, motivo: 'AUSENTE', valorBruto: bruto ?? null };
  }
  const valor = String(bruto).trim().toLowerCase();
  if (valor === 'false') {
    return { ativa: false, motivo: 'FALSE', valorBruto: String(bruto) };
  }
  if (valor === 'true') {
    return { ativa: true, motivo: 'TRUE', valorBruto: 'true' };
  }
  return { ativa: false, motivo: 'INVALIDA', valorBruto: String(bruto) };
}

export function flagRecuperacaoNativaAtiva(env: NodeJS.ProcessEnv = process.env): boolean {
  return lerFlagRecuperacaoNativa(env).ativa;
}

/** Raiz fiscal isolada. Ausente quando a flag está off não é erro. */
export function lerRaizFiscalNativa(env: NodeJS.ProcessEnv = process.env): string | null {
  const bruto = env.NFSE_FISCAL_STORAGE_PATH;
  if (typeof bruto !== 'string' || !bruto.trim()) return null;
  return bruto.trim();
}

export function exigirFlagValidaOuDesativada(env: NodeJS.ProcessEnv = process.env): LeituraFlagRecuperacaoNativa {
  const leitura = lerFlagRecuperacaoNativa(env);
  if (leitura.motivo === 'INVALIDA') {
    throw new OrquestracaoNfseError(
      'FLAG_INVALIDA',
      'NFSE_NATIVE_RECOVERY_ENABLED inválida. Fluxo nativo não será ativado.'
    );
  }
  return leitura;
}
