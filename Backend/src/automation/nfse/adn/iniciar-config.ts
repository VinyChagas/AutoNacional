/**
 * Configuração persistente do produto para o motor Iniciar A1→ADN.
 * Sobrevive a reinícios do Backend. Não depende de flags temporárias de piloto.
 *
 * Arquivo padrão (macOS):
 *   ~/Library/Application Support/AutoNacional/adn-iniciar-config.json
 *
 * Kill-switch de emergência (env): NFSE_ADN_INICIAR_ENABLED=false
 * força Playwright para todos (não grava no arquivo).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MAX_REQUESTS_HARNESS_ADN } from './controlled-sync-service';

export const NOME_ARQUIVO_CONFIG_ADN_INICIAR = 'adn-iniciar-config.json';

export interface ConfigAdnIniciarProduto {
  /** Versão do schema do arquivo. */
  versao: 1;
  /**
   * Quando true, certificado A1 usa ADN por padrão (sem Chromium/hCaptcha).
   * Default de produto: true.
   */
  adnPadraoA1: boolean;
  /**
   * CNPJs (só dígitos) que forçam Playwright mesmo com A1.
   * Exceções explícitas — lista vazia = nenhuma.
   */
  playwrightExcecaoCnpjs: string[];
  /** Teto de requisições ADN por execução Iniciar (1..MAX_REQUESTS_HARNESS_ADN). */
  maxRequests: number;
  /**
   * Raiz persistente de checkpoints/XMLs ADN.
   * Se null, usa ADN_HOMOLOG_ROOT ou default da árvore de homologação.
   */
  homologRoot: string | null;
}

const DEFAULT_HOMOLOG_ROOT_DARWIN = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'AutoNacional',
  'adn-homologacao'
);

export function defaultHomologRootAdnIniciar(): string {
  if (process.platform === 'darwin') return DEFAULT_HOMOLOG_ROOT_DARWIN;
  return path.join(os.homedir(), '.local', 'share', 'AutoNacional', 'adn-homologacao');
}

export function defaultConfigDirAdnIniciar(): string {
  const viaEnv = process.env.ADN_INICIAR_CONFIG_DIR?.trim();
  if (viaEnv) return path.resolve(viaEnv);
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'AutoNacional');
  }
  return path.join(os.homedir(), '.config', 'AutoNacional');
}

export function caminhoArquivoConfigAdnIniciar(dir?: string): string {
  return path.join(dir ?? defaultConfigDirAdnIniciar(), NOME_ARQUIVO_CONFIG_ADN_INICIAR);
}

export function configAdnIniciarPadrao(): ConfigAdnIniciarProduto {
  return {
    versao: 1,
    adnPadraoA1: true,
    playwrightExcecaoCnpjs: [],
    maxRequests: MAX_REQUESTS_HARNESS_ADN,
    homologRoot: defaultHomologRootAdnIniciar(),
  };
}

function normalizarCnpjs(lista: unknown): string[] {
  if (!Array.isArray(lista)) return [];
  const out = new Set<string>();
  for (const item of lista) {
    const digitos = String(item ?? '').replace(/\D/g, '');
    if (digitos.length >= 11) out.add(digitos);
  }
  return [...out].sort();
}

function normalizarConfig(parcial: Partial<ConfigAdnIniciarProduto> | null | undefined): ConfigAdnIniciarProduto {
  const base = configAdnIniciarPadrao();
  if (!parcial || typeof parcial !== 'object') return base;
  const maxBruto = Number(parcial.maxRequests ?? base.maxRequests);
  const maxRequests = Number.isFinite(maxBruto)
    ? Math.min(MAX_REQUESTS_HARNESS_ADN, Math.max(1, Math.floor(maxBruto)))
    : base.maxRequests;
  const homolog =
    parcial.homologRoot === null
      ? null
      : typeof parcial.homologRoot === 'string' && parcial.homologRoot.trim()
        ? path.resolve(parcial.homologRoot.trim())
        : base.homologRoot;
  return {
    versao: 1,
    adnPadraoA1: parcial.adnPadraoA1 !== false,
    playwrightExcecaoCnpjs: normalizarCnpjs(parcial.playwrightExcecaoCnpjs),
    maxRequests,
    homologRoot: homolog,
  };
}

/** Cache em memória — recarregado do disco em carregar/salvar e nos testes. */
let cache: ConfigAdnIniciarProduto | null = null;
/** Override só para testes offline (não grava disco). */
let overrideTestes: ConfigAdnIniciarProduto | null = null;

export function setConfigAdnIniciarParaTestes(
  cfg: ConfigAdnIniciarProduto | null
): void {
  overrideTestes = cfg ? normalizarConfig(cfg) : null;
  cache = null;
}

export function resetConfigAdnIniciarParaTestes(): void {
  overrideTestes = null;
  cache = null;
}

export function lerConfigAdnIniciarMemoria(): ConfigAdnIniciarProduto {
  if (overrideTestes) return overrideTestes;
  if (cache) return cache;
  return configAdnIniciarPadrao();
}

/**
 * Carrega do disco (ou cria default). Idempotente e seguro para bootstrap.
 */
export function carregarConfigAdnIniciar(opcoes?: {
  dir?: string;
  criarSeAusente?: boolean;
}): ConfigAdnIniciarProduto {
  if (overrideTestes) return overrideTestes;

  const arquivo = caminhoArquivoConfigAdnIniciar(opcoes?.dir);
  const criar = opcoes?.criarSeAusente !== false;

  try {
    if (fs.existsSync(arquivo)) {
      const bruto = JSON.parse(fs.readFileSync(arquivo, 'utf8')) as Partial<ConfigAdnIniciarProduto>;
      cache = normalizarConfig(bruto);
      return cache;
    }
  } catch {
    // arquivo corrompido → recria default abaixo
  }

  const cfg = configAdnIniciarPadrao();
  if (criar) {
    try {
      fs.mkdirSync(path.dirname(arquivo), { recursive: true, mode: 0o700 });
      fs.writeFileSync(arquivo, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
    } catch {
      // sem permissão de escrita: segue com default em memória
    }
  }
  cache = cfg;
  return cfg;
}

export function salvarConfigAdnIniciar(
  parcial: Partial<ConfigAdnIniciarProduto>,
  opcoes?: { dir?: string }
): ConfigAdnIniciarProduto {
  const atual = carregarConfigAdnIniciar({ dir: opcoes?.dir, criarSeAusente: true });
  const proximo = normalizarConfig({ ...atual, ...parcial, versao: 1 });
  const arquivo = caminhoArquivoConfigAdnIniciar(opcoes?.dir);
  fs.mkdirSync(path.dirname(arquivo), { recursive: true, mode: 0o700 });
  fs.writeFileSync(arquivo, JSON.stringify(proximo, null, 2) + '\n', { mode: 0o600 });
  cache = proximo;
  overrideTestes = null;
  return proximo;
}

/** Aplica homologRoot ao env se ainda não definido (bootstrap). */
export function aplicarHomologRootConfigNoEnv(
  cfg: ConfigAdnIniciarProduto = lerConfigAdnIniciarMemoria(),
  env: NodeJS.ProcessEnv = process.env
): void {
  if (env.ADN_HOMOLOG_ROOT?.trim()) return;
  if (cfg.homologRoot?.trim()) {
    env.ADN_HOMOLOG_ROOT = path.resolve(cfg.homologRoot.trim());
  }
}

export function cnpjNaExcecaoPlaywrightAdn(
  cnpj: string,
  cfg: ConfigAdnIniciarProduto = lerConfigAdnIniciarMemoria()
): boolean {
  const digitos = String(cnpj ?? '').replace(/\D/g, '');
  if (!digitos) return false;
  return cfg.playwrightExcecaoCnpjs.includes(digitos);
}
