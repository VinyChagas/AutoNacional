/**
 * Runtime Iniciar A1→ADN: injeção para testes + factory de sync padrão.
 * Reutiliza stores/locks/limites do motor ADN homologado.
 * Não abre Playwright. Não chama SEFIN.
 */
import { criarProvedorA1DoCadastro } from '../infrastructure/a1-adapter';
import { AdnClient } from './adn-client';
import { assertCnpjCompativelComCertificado } from './cert-identity';
import { CheckpointStoreArquivo } from './checkpoint-store';
import {
  garantirArvoreHomologacaoAdn,
  LIMITES_SYNC_CONTROLADA_ADN,
  MAX_BYTES_CNPJ_HARNESS_ADN,
  MAX_REQUESTS_HARNESS_ADN,
  MIN_RATE_LIMIT_MS_HARNESS_ADN,
  resolverRaizHomologacaoAdn,
  verificarEspacoHomologacaoAdn,
} from './controlled-sync-service';
import { DocumentStoreArquivoAdn } from './document-store';
import type { AmbienteAdn } from './endpoints';
import { ErroAdn } from './errors';
import type { AutorizacaoAdnIniciar } from './iniciar-routing';
import { criarTransporteHttpsMtlsAdn } from './mtls-transport';
import { SyncLockArquivoAdn, SyncLockCompostoAdn } from './sync-lock';
import { SyncServiceAdn } from './sync-service';
import type { LimitesAdn, ResultadoSyncAdn, TransporteHttpAdn } from './types';
import type { DependenciasFluxoAdnIniciar } from './iniciar-executor';
import path from 'node:path';

/** Override de sync (testes offline). Null = factory padrão. */
let syncOverride: DependenciasFluxoAdnIniciar['executarSync'] | null = null;

/** Autorizações explícitas por CNPJ (ativação individual / testes). */
const autorizacoesPorCnpj = new Map<string, boolean>();

export function setSyncAdnIniciarParaTestes(
  fn: DependenciasFluxoAdnIniciar['executarSync'] | null
): void {
  syncOverride = fn;
}

export function autorizarAdnIniciarEmpresa(
  cnpj: string,
  ativa: boolean
): void {
  const digitos = String(cnpj).replace(/\D/g, '');
  if (!digitos) return;
  if (ativa) autorizacoesPorCnpj.set(digitos, true);
  else autorizacoesPorCnpj.delete(digitos);
}

export function limparAutorizacoesAdnIniciar(): void {
  autorizacoesPorCnpj.clear();
}

export function obterAutorizacaoAdnIniciarRuntime(
  cnpj: string
): AutorizacaoAdnIniciar | null {
  const digitos = String(cnpj).replace(/\D/g, '');
  if (!digitos) return null;
  if (!autorizacoesPorCnpj.has(digitos)) return null;
  return { ativa: true, cnpj: digitos };
}

export function resetIniciarAdnRuntimeParaTestes(): void {
  syncOverride = null;
  autorizacoesPorCnpj.clear();
}

function limitesIniciarAdn(env: NodeJS.ProcessEnv): LimitesAdn {
  const maxReqBruto = Number(env.NFSE_ADN_INICIAR_MAX_REQUESTS ?? MAX_REQUESTS_HARNESS_ADN);
  const maxRequests = Number.isFinite(maxReqBruto)
    ? Math.min(MAX_REQUESTS_HARNESS_ADN, Math.max(1, Math.floor(maxReqBruto)))
    : MAX_REQUESTS_HARNESS_ADN;
  return {
    ...LIMITES_SYNC_CONTROLADA_ADN,
    rateLimitMs: MIN_RATE_LIMIT_MS_HARNESS_ADN,
    maxRequests,
    maxBytesArmazenamentoCnpj: MAX_BYTES_CNPJ_HARNESS_ADN,
  };
}

/**
 * Sync padrão para produção/homologação (mTLS A1 + stores em ADN_HOMOLOG_ROOT).
 * Usado só após decisão ADN + gate live no executor.
 */
export function criarExecutarSyncAdnIniciarPadrao(opcoes?: {
  env?: NodeJS.ProcessEnv;
  criarTransporte?: () => TransporteHttpAdn;
  obterCredencial?: (cnpj: string) => Promise<{ pfx: Buffer; senha: string }>;
}): DependenciasFluxoAdnIniciar['executarSync'] {
  return async ({ cnpj, ambiente, deveInterromper }) => {
    const env = opcoes?.env ?? process.env;
    const raiz = resolverRaizHomologacaoAdn({ env });
    const arvore = garantirArvoreHomologacaoAdn(raiz);
    const digitos = cnpj.replace(/\D/g, '');

    const obterCred =
      opcoes?.obterCredencial ??
      (async (c: string) => criarProvedorA1DoCadastro().obter(c));

    const credencial = await obterCred(digitos);
    assertCnpjCompativelComCertificado(digitos, credencial);

    const docsCnpjDir = path.join(arvore.documentos, digitos, ambiente);
    const espaco = verificarEspacoHomologacaoAdn({
      raiz: arvore.raiz,
      documentosCnpjDir: docsCnpjDir,
      maxBytesCnpj: MAX_BYTES_CNPJ_HARNESS_ADN,
    });
    if (!espaco.ok) {
      throw new ErroAdn(espaco.codigo, 'BLOQUEANTE', espaco.motivo);
    }

    const limites = limitesIniciarAdn(env);
    const transporte =
      opcoes?.criarTransporte?.() ?? criarTransporteHttpsMtlsAdn();
    const client = new AdnClient(transporte, credencial, limites);
    const checkpoint = new CheckpointStoreArquivo(arvore.checkpoints);
    const documentos = new DocumentStoreArquivoAdn(arvore.documentos, limites);
    const lock = new SyncLockCompostoAdn(new SyncLockArquivoAdn(arvore.locks));
    const sync = new SyncServiceAdn(client, checkpoint, limites, documentos, lock);

    return sync.syncDistribuicao({
      cnpj: digitos,
      ambiente,
      resume: true,
      deveInterromper,
      maxRequests: limites.maxRequests,
    });
  };
}

export function obterDependenciasAdnIniciar(opcoes?: {
  env?: NodeJS.ProcessEnv;
  /** Testes offline: não exige NFSE_ALLOW_LIVE. */
  exigirGateLive?: boolean;
}): DependenciasFluxoAdnIniciar {
  return {
    executarSync: syncOverride ?? criarExecutarSyncAdnIniciarPadrao({ env: opcoes?.env }),
    exigirGateLive: opcoes?.exigirGateLive,
  };
}

/** Helper de teste: sync em memória a partir de ResultadoSyncAdn fixo. */
export function syncAdnIniciarFixoParaTestes(
  resultado: ResultadoSyncAdn | ((cnpj: string, ambiente: AmbienteAdn) => ResultadoSyncAdn)
): DependenciasFluxoAdnIniciar['executarSync'] {
  return async ({ cnpj, ambiente }) => {
    if (typeof resultado === 'function') return resultado(cnpj, ambiente);
    return { ...resultado, cnpj: cnpj.replace(/\D/g, ''), ambiente };
  };
}
