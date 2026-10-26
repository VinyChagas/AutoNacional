/**
 * Feature flag NFSE_NATIVE_RECOVERY_ENABLED (piloto/homologação).
 * API-02K: o Iniciar A1 padrão NÃO depende desta flag — usa modoProdutoPortalSefin.
 * Ausente ou false: desativada no caminho legado da flag. true: habilitada.
 * Qualquer outro valor: falha segura (desativada) com diagnóstico.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

/** Raiz fiscal isolada via env. Null se ausente. */
export function lerRaizFiscalNativa(env: NodeJS.ProcessEnv = process.env): string | null {
  const bruto = env.NFSE_FISCAL_STORAGE_PATH;
  if (typeof bruto !== 'string' || !bruto.trim()) return null;
  return bruto.trim();
}

/** Raiz padrão de produto (Application Support), distinta de ./downloads. */
export function defaultRaizFiscalNativaProduto(): string {
  if (process.platform === 'darwin') {
    return path.join(
      os.homedir(),
      'Library',
      'Application Support',
      'AutoNacional',
      'nfse-fiscal'
    );
  }
  return path.join(os.homedir(), '.local', 'share', 'AutoNacional', 'nfse-fiscal');
}

/**
 * Resolve raiz fiscal: env NFSE_FISCAL_STORAGE_PATH ou default de produto.
 * Garante que o diretório exista (produto Iniciar).
 */
export function resolverRaizFiscalNativaProduto(
  env: NodeJS.ProcessEnv = process.env
): string {
  const viaEnv = lerRaizFiscalNativa(env);
  const raiz = path.resolve(viaEnv ?? defaultRaizFiscalNativaProduto());
  fs.mkdirSync(raiz, { recursive: true });
  return raiz;
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
