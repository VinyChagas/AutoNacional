/**
 * Harness de sincronização ADN controlada (homologação) — multi-lote.
 * Gate duplo + limites configuráveis + SIGINT seguro + relatório consolidado.
 * Sem Iniciar/SEFIN/Playwright.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { CredencialMtls } from '../recovery/types';
import { criarProvedorA1DoCadastro } from '../infrastructure/a1-adapter';
import { AdnClient } from './adn-client';
import { assertCnpjCompativelComCertificado } from './cert-identity';
import { CheckpointStoreArquivo } from './checkpoint-store';
import { DocumentStoreArquivoAdn } from './document-store';
import type { AmbienteAdn } from './endpoints';
import { ErroAdn } from './errors';
import { escreverArquivoAtomico } from './fs-atomic';
import { avaliarGateLiveAdn } from './live-gate';
import { criarTransporteHttpsMtlsAdn } from './mtls-transport';
import { TransporteLimiteRequisicoesAdn } from './smoke-service';
import { SyncLockCompostoAdn, SyncLockArquivoAdn } from './sync-lock';
import { SyncServiceAdn } from './sync-service';
import type { LimitesAdn, TransporteHttpAdn } from './types';

export const MAX_REQUESTS_HARNESS_ADN = 20;
export const MIN_RATE_LIMIT_MS_HARNESS_ADN = 250;
export const MAX_BYTES_CNPJ_HARNESS_ADN = 512 * 1024 * 1024;
/** Margem mínima livre no filesystem da raiz de homologação. */
export const MIN_ESPACO_LIVRE_HARNESS_ADN = 64 * 1024 * 1024;

/** Limites padrão do harness (1 req; compatível com API-01I/J/K). */
export const LIMITES_SYNC_CONTROLADA_ADN: LimitesAdn = {
  timeoutMs: 20_000,
  maxBytesResposta: 4_000_000,
  maxBytesGzip: 1_500_000,
  maxBytesXml: 4_000_000,
  rateLimitMs: MIN_RATE_LIMIT_MS_HARNESS_ADN,
  maxRequests: 1,
  maxBytesArmazenamentoCnpj: MAX_BYTES_CNPJ_HARNESS_ADN,
};

export const ENV_ADN_HOMOLOG_ROOT = 'ADN_HOMOLOG_ROOT';
export const MAX_DOCS_POR_LOTE_SYNC_CONTROLADA = 50;
/** @deprecated use MAX_DOCS_POR_LOTE_SYNC_CONTROLADA */
export const MAX_DOCS_SYNC_CONTROLADA = MAX_DOCS_POR_LOTE_SYNC_CONTROLADA;

export interface EntradaSyncControladaAdn {
  cnpj: string;
  ambiente: AmbienteAdn;
  confirmLive: boolean;
  /** NSU inicial; se omitido e resume=true, usa checkpoint. */
  nsu?: number;
  resume?: boolean;
  /** Raiz de homologação isolada (checkpoints/documentos/locks/relatorios). */
  raizHomologacao?: string;
  env?: NodeJS.ProcessEnv;
  /** 1..20; padrão 1. */
  maxRequests?: number;
  /** >= 250 ms; padrão 250. */
  rateLimitMs?: number;
  /** 1..512MB; padrão 512MB. 0 não permitido no harness. */
  maxBytesCnpj?: number;
  /**
   * Callback de interrupção (SIGINT). Se true antes de nova GET,
   * encerra após o lote corrente.
   */
  deveInterromper?: () => boolean;
  /** Se false, não grava relatório consolidado (testes pontuais). Default true. */
  gravarRelatorio?: boolean;
}

export interface DependenciasSyncControladaAdn {
  obterCredencial?: (cnpj: string) => Promise<CredencialMtls>;
  criarTransporte?: () => TransporteHttpAdn;
  /** Override de espaço livre (bytes) — testes. */
  obterEspacoLivreBytes?: (raiz: string) => number;
}

export interface ResumoSyncControladaAdn {
  ok: boolean;
  codigoErro: string | null;
  motivo: string | null;
  cnpj: string | null;
  ambiente: AmbienteAdn | null;
  nsuInicial: number | null;
  ultimoNsuProcessado: number | null;
  requests: number;
  lotesProcessados: number;
  statusSync: string | null;
  fimDistribuicaoConfirmado: boolean;
  inventarioMensalCompletoDeclarado: false;
  contagens: {
    emitidas: number;
    recebidas: number;
    intermediadas: number;
    eventos: number;
    naoClassificados: number;
  } | null;
  persistencia: {
    persistidos: number;
    duplicadosPersistencia: number;
    semXml: number;
    xmlsInvalidosPersistidos: number;
    bytesEstimados: number;
  } | null;
  xmlsInvalidos: number;
  duplicidades: number;
  checkpointGravado: boolean;
  ultimoNsuConfirmado: number | null;
  raizHomologacao: string | null;
  motivoParada: string | null;
  maxRequests: number | null;
  rateLimitMs: number | null;
  maxBytesCnpj: number | null;
  caminhoRelatorio: string | null;
  interrompido: boolean;
}

export interface RelatorioConsolidadoAdn {
  cnpj: string;
  ambiente: AmbienteAdn;
  atualizadoEm: string;
  inventarioMensalCompletoDeclarado: false;
  totais: {
    execucoes: number;
    requests: number;
    lotesProcessados: number;
    persistidos: number;
    duplicadosPersistencia: number;
    xmlsInvalidos: number;
    bytesEstimados: number;
  };
  ultimaExecucao: ResumoSyncControladaAdnSanitizado;
  execucoes: ResumoSyncControladaAdnSanitizado[];
}

export type ResumoSyncControladaAdnSanitizado = Omit<
  ResumoSyncControladaAdn,
  'caminhoRelatorio'
> & { executadoEm: string };

function resumoFalha(
  codigo: string,
  motivo: string,
  parcial: Partial<ResumoSyncControladaAdn> = {}
): ResumoSyncControladaAdn {
  return {
    ok: false,
    codigoErro: codigo,
    motivo,
    cnpj: parcial.cnpj ?? null,
    ambiente: parcial.ambiente ?? null,
    nsuInicial: parcial.nsuInicial ?? null,
    ultimoNsuProcessado: parcial.ultimoNsuProcessado ?? null,
    requests: parcial.requests ?? 0,
    lotesProcessados: parcial.lotesProcessados ?? 0,
    statusSync: parcial.statusSync ?? null,
    fimDistribuicaoConfirmado: parcial.fimDistribuicaoConfirmado ?? false,
    inventarioMensalCompletoDeclarado: false,
    contagens: parcial.contagens ?? null,
    persistencia: parcial.persistencia ?? null,
    xmlsInvalidos: parcial.xmlsInvalidos ?? 0,
    duplicidades: parcial.duplicidades ?? 0,
    checkpointGravado: parcial.checkpointGravado ?? false,
    ultimoNsuConfirmado: parcial.ultimoNsuConfirmado ?? null,
    raizHomologacao: parcial.raizHomologacao ?? null,
    motivoParada: parcial.motivoParada ?? null,
    maxRequests: parcial.maxRequests ?? null,
    rateLimitMs: parcial.rateLimitMs ?? null,
    maxBytesCnpj: parcial.maxBytesCnpj ?? null,
    caminhoRelatorio: parcial.caminhoRelatorio ?? null,
    interrompido: parcial.interrompido ?? false,
  };
}

export function normalizarLimitesHarnessAdn(entrada: {
  maxRequests?: number;
  rateLimitMs?: number;
  maxBytesCnpj?: number;
}): { maxRequests: number; rateLimitMs: number; maxBytesCnpj: number } {
  const maxRequests = entrada.maxRequests ?? 1;
  const rateLimitMs = entrada.rateLimitMs ?? MIN_RATE_LIMIT_MS_HARNESS_ADN;
  const maxBytesCnpj = entrada.maxBytesCnpj ?? MAX_BYTES_CNPJ_HARNESS_ADN;

  if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > MAX_REQUESTS_HARNESS_ADN) {
    throw new ErroAdn(
      'LIMITE_INVALIDO',
      'PERMANENTE',
      `--max-requests deve ser inteiro entre 1 e ${MAX_REQUESTS_HARNESS_ADN}.`
    );
  }
  if (!Number.isFinite(rateLimitMs) || rateLimitMs < MIN_RATE_LIMIT_MS_HARNESS_ADN) {
    throw new ErroAdn(
      'LIMITE_INVALIDO',
      'PERMANENTE',
      `--rate-limit-ms deve ser >= ${MIN_RATE_LIMIT_MS_HARNESS_ADN}.`
    );
  }
  if (
    !Number.isFinite(maxBytesCnpj) ||
    maxBytesCnpj < 1 ||
    maxBytesCnpj > MAX_BYTES_CNPJ_HARNESS_ADN
  ) {
    throw new ErroAdn(
      'LIMITE_INVALIDO',
      'PERMANENTE',
      `--max-bytes-cnpj deve ser entre 1 e ${MAX_BYTES_CNPJ_HARNESS_ADN}.`
    );
  }
  return { maxRequests, rateLimitMs, maxBytesCnpj };
}

export function resolverRaizHomologacaoAdn(params: {
  raizHomologacao?: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}): string {
  const env = params.env ?? process.env;
  const explicita = params.raizHomologacao?.trim();
  if (explicita) return path.resolve(explicita);
  const viaEnv = env[ENV_ADN_HOMOLOG_ROOT]?.trim();
  if (viaEnv) return path.resolve(viaEnv);
  return path.resolve(params.cwd ?? process.cwd(), '.adn-homologacao');
}

export function garantirArvoreHomologacaoAdn(raiz: string): {
  raiz: string;
  checkpoints: string;
  documentos: string;
  locks: string;
  relatorios: string;
} {
  const resolved = path.resolve(raiz);
  if (!resolved || resolved.includes('\0')) {
    throw new ErroAdn('RAIZ_INVALIDA', 'BLOQUEANTE', 'Raiz de homologação ADN inválida.');
  }
  const checkpoints = path.join(resolved, 'checkpoints');
  const documentos = path.join(resolved, 'documentos');
  const locks = path.join(resolved, 'locks');
  const relatorios = path.join(resolved, 'relatorios');
  for (const d of [resolved, checkpoints, documentos, locks, relatorios]) {
    fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  }
  return { raiz: resolved, checkpoints, documentos, locks, relatorios };
}

function somarBytesDir(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const atual = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(atual, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(atual, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) {
        try {
          total += fs.statSync(p).size;
        } catch {
          /* ignore */
        }
      }
    }
  }
  return total;
}

export function obterEspacoLivreBytesPadrao(raiz: string): number {
  const statfs = (fs as typeof fs & { statfsSync?: (p: string) => { bavail: number; bsize: number } })
    .statfsSync;
  if (typeof statfs === 'function') {
    const s = statfs(raiz);
    return Number(s.bavail) * Number(s.bsize);
  }
  // Fallback conservador: assume espaço suficiente se statfs indisponível.
  return Number.MAX_SAFE_INTEGER;
}

/**
 * Verifica cota CNPJ e espaço livre no filesystem antes da sync.
 */
export function verificarEspacoHomologacaoAdn(params: {
  raiz: string;
  documentosCnpjDir: string;
  maxBytesCnpj: number;
  obterEspacoLivreBytes?: (raiz: string) => number;
  margemMinimaLivreBytes?: number;
}): { ok: true; usadoBytes: number; livreBytes: number } | { ok: false; codigo: string; motivo: string; usadoBytes: number; livreBytes: number } {
  const usadoBytes = somarBytesDir(params.documentosCnpjDir);
  const livreBytes = (params.obterEspacoLivreBytes ?? obterEspacoLivreBytesPadrao)(params.raiz);
  const margem = params.margemMinimaLivreBytes ?? MIN_ESPACO_LIVRE_HARNESS_ADN;

  if (usadoBytes >= params.maxBytesCnpj) {
    return {
      ok: false,
      codigo: 'LIMITE_ARMAZENAMENTO',
      motivo: `Armazenamento CNPJ já no teto (${usadoBytes} >= ${params.maxBytesCnpj}).`,
      usadoBytes,
      livreBytes,
    };
  }
  if (livreBytes < margem) {
    return {
      ok: false,
      codigo: 'ESPACO_INSUFICIENTE',
      motivo: `Espaço livre insuficiente na raiz de homologação (${livreBytes} < ${margem}).`,
      usadoBytes,
      livreBytes,
    };
  }
  return { ok: true, usadoBytes, livreBytes };
}

function sanitizarResumoParaRelatorio(
  resumo: ResumoSyncControladaAdn
): ResumoSyncControladaAdnSanitizado {
  const { caminhoRelatorio: _c, ...resto } = resumo;
  return { ...resto, executadoEm: new Date().toISOString() };
}

export function caminhoRelatorioConsolidadoAdn(
  relatoriosDir: string,
  cnpj: string,
  ambiente: AmbienteAdn
): string {
  return path.join(relatoriosDir, `${cnpj.replace(/\D/g, '')}-${ambiente}.json`);
}

export function lerRelatorioConsolidadoAdn(
  file: string
): RelatorioConsolidadoAdn | null {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as RelatorioConsolidadoAdn;
  } catch {
    throw new ErroAdn('RELATORIO_CORROMPIDO', 'BLOQUEANTE', 'Relatório consolidado ADN ilegível.');
  }
}

export function consolidarRelatorioSyncAdn(params: {
  relatoriosDir: string;
  resumo: ResumoSyncControladaAdn;
}): { caminho: string; relatorio: RelatorioConsolidadoAdn } {
  if (!params.resumo.cnpj || !params.resumo.ambiente) {
    throw new ErroAdn('RELATORIO_INVALIDO', 'PERMANENTE', 'Resumo sem CNPJ/ambiente para relatório.');
  }
  const caminho = caminhoRelatorioConsolidadoAdn(
    params.relatoriosDir,
    params.resumo.cnpj,
    params.resumo.ambiente
  );
  const anterior = (() => {
    try {
      return lerRelatorioConsolidadoAdn(caminho);
    } catch {
      return null;
    }
  })();
  const entrada = sanitizarResumoParaRelatorio(params.resumo);
  const execucoes = [...(anterior?.execucoes ?? []), entrada];
  const totais = execucoes.reduce(
    (acc, e) => {
      acc.execucoes += 1;
      acc.requests += e.requests;
      acc.lotesProcessados += e.lotesProcessados;
      acc.persistidos += e.persistencia?.persistidos ?? 0;
      acc.duplicadosPersistencia += e.persistencia?.duplicadosPersistencia ?? 0;
      acc.xmlsInvalidos += e.xmlsInvalidos;
      acc.bytesEstimados += e.persistencia?.bytesEstimados ?? 0;
      return acc;
    },
    {
      execucoes: 0,
      requests: 0,
      lotesProcessados: 0,
      persistidos: 0,
      duplicadosPersistencia: 0,
      xmlsInvalidos: 0,
      bytesEstimados: 0,
    }
  );

  const relatorio: RelatorioConsolidadoAdn = {
    cnpj: params.resumo.cnpj,
    ambiente: params.resumo.ambiente,
    atualizadoEm: new Date().toISOString(),
    inventarioMensalCompletoDeclarado: false,
    totais,
    ultimaExecucao: entrada,
    execucoes,
  };

  const json = JSON.stringify(relatorio, null, 2);
  if (/ArquivoXml|nfseXmlGZip|BEGIN CERTIFICATE|passphrase|\.pfx\b/i.test(json)) {
    throw new ErroAdn('RELATORIO_SENSIVEL', 'BLOQUEANTE', 'Relatório bloqueado por sanitização.');
  }
  escreverArquivoAtomico(caminho, json, 0o600);
  return { caminho, relatorio };
}

/**
 * Executa sync controlada multi-lote sob gate/lock/limites.
 */
export async function executarSyncControladaAdn(
  entrada: EntradaSyncControladaAdn,
  deps: DependenciasSyncControladaAdn = {}
): Promise<ResumoSyncControladaAdn> {
  const gate = avaliarGateLiveAdn({
    confirmLive: entrada.confirmLive,
    env: entrada.env,
  });
  if (!gate.ok) {
    return resumoFalha(gate.codigo, gate.motivo);
  }

  let limitesNorm: { maxRequests: number; rateLimitMs: number; maxBytesCnpj: number };
  try {
    limitesNorm = normalizarLimitesHarnessAdn({
      maxRequests: entrada.maxRequests,
      rateLimitMs: entrada.rateLimitMs,
      maxBytesCnpj: entrada.maxBytesCnpj,
    });
  } catch (erro) {
    if (erro instanceof ErroAdn) return resumoFalha(erro.codigo, erro.message);
    return resumoFalha('LIMITE_INVALIDO', 'Limites do harness inválidos.');
  }

  const cnpj = entrada.cnpj.replace(/\D/g, '');
  if (!/^\d{14}$/.test(cnpj)) {
    return resumoFalha('CNPJ_INVALIDO', 'CNPJ deve ter 14 dígitos.', {
      maxRequests: limitesNorm.maxRequests,
      rateLimitMs: limitesNorm.rateLimitMs,
      maxBytesCnpj: limitesNorm.maxBytesCnpj,
    });
  }
  if (entrada.ambiente !== 'producao' && entrada.ambiente !== 'producao-restrita') {
    return resumoFalha('AMBIENTE_INVALIDO', 'Ambiente ADN inválido.');
  }

  let arvore: ReturnType<typeof garantirArvoreHomologacaoAdn>;
  try {
    arvore = garantirArvoreHomologacaoAdn(
      resolverRaizHomologacaoAdn({
        raizHomologacao: entrada.raizHomologacao,
        env: entrada.env,
      })
    );
  } catch (erro) {
    if (erro instanceof ErroAdn) return resumoFalha(erro.codigo, erro.message);
    return resumoFalha('RAIZ_INVALIDA', 'Falha ao preparar raiz de homologação.');
  }

  const docsCnpjDir = path.join(arvore.documentos, cnpj, entrada.ambiente);
  const espaco = verificarEspacoHomologacaoAdn({
    raiz: arvore.raiz,
    documentosCnpjDir: docsCnpjDir,
    maxBytesCnpj: limitesNorm.maxBytesCnpj,
    obterEspacoLivreBytes: deps.obterEspacoLivreBytes,
  });
  if (!espaco.ok) {
    return resumoFalha(espaco.codigo, espaco.motivo, {
      cnpj,
      ambiente: entrada.ambiente,
      raizHomologacao: arvore.raiz,
      maxRequests: limitesNorm.maxRequests,
      rateLimitMs: limitesNorm.rateLimitMs,
      maxBytesCnpj: limitesNorm.maxBytesCnpj,
    });
  }

  const obterCredencial =
    deps.obterCredencial ??
    (async (c: string) => criarProvedorA1DoCadastro().obter(c));

  let credencial: CredencialMtls;
  try {
    credencial = await obterCredencial(cnpj);
  } catch (erro) {
    const codigo =
      erro && typeof erro === 'object' && 'codigo' in erro
        ? String((erro as { codigo: string }).codigo)
        : 'CERTIFICADO_INDISPONIVEL';
    const motivo = erro instanceof Error ? erro.message : 'Falha ao carregar certificado A1.';
    return resumoFalha(codigo, motivo, {
      cnpj,
      ambiente: entrada.ambiente,
      raizHomologacao: arvore.raiz,
      maxRequests: limitesNorm.maxRequests,
      rateLimitMs: limitesNorm.rateLimitMs,
      maxBytesCnpj: limitesNorm.maxBytesCnpj,
    });
  }

  try {
    assertCnpjCompativelComCertificado(cnpj, credencial);
  } catch (erro) {
    if (erro instanceof ErroAdn) {
      return resumoFalha(erro.codigo, erro.message, {
        cnpj,
        ambiente: entrada.ambiente,
        raizHomologacao: arvore.raiz,
        maxRequests: limitesNorm.maxRequests,
        rateLimitMs: limitesNorm.rateLimitMs,
        maxBytesCnpj: limitesNorm.maxBytesCnpj,
      });
    }
    return resumoFalha('CNPJ_INCOMPATIVEL', 'CNPJ incompatível com o certificado.', {
      cnpj,
      ambiente: entrada.ambiente,
      raizHomologacao: arvore.raiz,
      maxRequests: limitesNorm.maxRequests,
      rateLimitMs: limitesNorm.rateLimitMs,
      maxBytesCnpj: limitesNorm.maxBytesCnpj,
    });
  }

  const limitesSessao: LimitesAdn = {
    ...LIMITES_SYNC_CONTROLADA_ADN,
    maxRequests: limitesNorm.maxRequests,
    rateLimitMs: limitesNorm.rateLimitMs,
    maxBytesArmazenamentoCnpj: limitesNorm.maxBytesCnpj,
  };

  const inner = deps.criarTransporte?.() ?? criarTransporteHttpsMtlsAdn();
  const transporte = new TransporteLimiteRequisicoesAdn(
    inner,
    limitesNorm.maxRequests,
    'LIMITE_REQUISICOES',
    `Harness ADN permite no máximo ${limitesNorm.maxRequests} requisição(ões) HTTP.`
  );
  const client = new AdnClient(transporte, credencial, limitesSessao);
  const checkpoint = new CheckpointStoreArquivo(arvore.checkpoints);
  const documentos = new DocumentStoreArquivoAdn(arvore.documentos, limitesSessao);
  const lock = new SyncLockCompostoAdn(new SyncLockArquivoAdn(arvore.locks));
  const sync = new SyncServiceAdn(client, checkpoint, limitesSessao, documentos, lock);

  const resume = entrada.resume !== false;
  const forcarNsu =
    entrada.nsu != null && Number.isInteger(entrada.nsu) && entrada.nsu >= 0
      ? entrada.nsu
      : undefined;

  const montarBase = (): Partial<ResumoSyncControladaAdn> => ({
    cnpj,
    ambiente: entrada.ambiente,
    raizHomologacao: arvore.raiz,
    maxRequests: limitesNorm.maxRequests,
    rateLimitMs: limitesNorm.rateLimitMs,
    maxBytesCnpj: limitesNorm.maxBytesCnpj,
  });

  try {
    const resultado = await sync.syncDistribuicao({
      cnpj,
      ambiente: entrada.ambiente,
      forcarNsu,
      resume: forcarNsu != null ? false : resume,
      maxRequests: limitesNorm.maxRequests,
      rateLimitMs: limitesNorm.rateLimitMs,
      descartarXmlEmMemoriaAposPersistir: true,
      deveInterromper: entrada.deveInterromper,
    });

    const tetoDocs = MAX_DOCS_POR_LOTE_SYNC_CONTROLADA * limitesNorm.maxRequests;
    if (resultado.documentos.length > tetoDocs) {
      return resumoFalha(
        'LIMITE_DOCUMENTOS',
        `Sync controlada aceita no máximo ${tetoDocs} documentos por execução.`,
        {
          ...montarBase(),
          nsuInicial: resultado.nsuInicial,
          ultimoNsuProcessado: resultado.ultimoNsuProcessado,
          requests: resultado.requests,
          lotesProcessados: resultado.lotesProcessados,
          statusSync: resultado.status,
          checkpointGravado: Boolean(resultado.checkpoint),
          ultimoNsuConfirmado: resultado.checkpoint?.ultimoNsuConfirmado ?? null,
          motivoParada: resultado.motivoParada,
        }
      );
    }

    const interrompido = resultado.motivoParada === 'interrupcao_solicitada';
    const ok = resultado.status !== 'ERRO';
    let resumo: ResumoSyncControladaAdn = {
      ok,
      codigoErro: ok ? null : 'SYNC_ERRO',
      motivo: ok ? null : resultado.motivoParada,
      cnpj,
      ambiente: entrada.ambiente,
      nsuInicial: resultado.nsuInicial,
      ultimoNsuProcessado: resultado.ultimoNsuProcessado,
      requests: resultado.requests,
      lotesProcessados: resultado.lotesProcessados,
      statusSync: resultado.status,
      fimDistribuicaoConfirmado: resultado.fimDistribuicaoConfirmado,
      inventarioMensalCompletoDeclarado: false,
      contagens: resultado.contagens,
      persistencia: resultado.persistencia
        ? {
            persistidos: resultado.persistencia.persistidos,
            duplicadosPersistencia: resultado.persistencia.duplicadosPersistencia,
            semXml: resultado.persistencia.semXml,
            xmlsInvalidosPersistidos: resultado.persistencia.xmlsInvalidosPersistidos,
            bytesEstimados: resultado.persistencia.bytesEstimados ?? 0,
          }
        : null,
      xmlsInvalidos: resultado.xmlsInvalidos,
      duplicidades: resultado.duplicidades,
      checkpointGravado: Boolean(resultado.checkpoint),
      ultimoNsuConfirmado: resultado.checkpoint?.ultimoNsuConfirmado ?? null,
      raizHomologacao: arvore.raiz,
      motivoParada: resultado.motivoParada,
      maxRequests: limitesNorm.maxRequests,
      rateLimitMs: limitesNorm.rateLimitMs,
      maxBytesCnpj: limitesNorm.maxBytesCnpj,
      caminhoRelatorio: null,
      interrompido,
    };

    if (entrada.gravarRelatorio !== false) {
      try {
        const { caminho } = consolidarRelatorioSyncAdn({
          relatoriosDir: arvore.relatorios,
          resumo,
        });
        resumo = { ...resumo, caminhoRelatorio: caminho };
      } catch (erro) {
        if (erro instanceof ErroAdn) {
          return resumoFalha(erro.codigo, erro.message, { ...resumo, ok: false });
        }
      }
    }

    return resumo;
  } catch (erro) {
    if (erro instanceof ErroAdn) {
      return resumoFalha(erro.codigo, erro.message, {
        ...montarBase(),
        requests: transporte.requisicoes,
      });
    }
    return resumoFalha(
      'FALHA_SYNC_CONTROLADA',
      erro instanceof Error ? erro.message : 'Falha na sync controlada ADN.',
      {
        ...montarBase(),
        requests: transporte.requisicoes,
      }
    );
  }
}

/** Saída sanitizada — sem XML, PFX, senha, rawBody ou caminhos de arquivo individuais. */
export function formatarResumoSyncControladaAdn(resumo: ResumoSyncControladaAdn): string {
  const linhas = [
    '=== Sync ADN controlada (sanitizado) ===',
    `ok: ${resumo.ok}`,
    `cnpj: ${resumo.cnpj ?? 'n/a'}`,
    `ambiente: ${resumo.ambiente ?? 'n/a'}`,
    `nsuInicial: ${resumo.nsuInicial ?? 'n/a'}`,
    `ultimoNsuProcessado: ${resumo.ultimoNsuProcessado ?? 'n/a'}`,
    `requests: ${resumo.requests}`,
    `lotesProcessados: ${resumo.lotesProcessados}`,
    `statusSync: ${resumo.statusSync ?? 'n/a'}`,
    `fimDistribuicaoConfirmado: ${resumo.fimDistribuicaoConfirmado}`,
    `inventarioMensalCompletoDeclarado: ${resumo.inventarioMensalCompletoDeclarado}`,
    `xmlsInvalidos: ${resumo.xmlsInvalidos}`,
    `duplicidades: ${resumo.duplicidades}`,
    `checkpointGravado: ${resumo.checkpointGravado}`,
    `ultimoNsuConfirmado: ${resumo.ultimoNsuConfirmado ?? 'n/a'}`,
    `raizHomologacao: ${resumo.raizHomologacao ?? 'n/a'}`,
    `motivoParada: ${resumo.motivoParada ?? 'n/a'}`,
    `maxRequests: ${resumo.maxRequests ?? 'n/a'}`,
    `rateLimitMs: ${resumo.rateLimitMs ?? 'n/a'}`,
    `maxBytesCnpj: ${resumo.maxBytesCnpj ?? 'n/a'}`,
    `interrompido: ${resumo.interrompido}`,
    `caminhoRelatorio: ${resumo.caminhoRelatorio ?? 'n/a'}`,
  ];
  if (resumo.contagens) {
    linhas.push(
      `contagens: emitidas=${resumo.contagens.emitidas} recebidas=${resumo.contagens.recebidas} intermediadas=${resumo.contagens.intermediadas} eventos=${resumo.contagens.eventos} naoClassificados=${resumo.contagens.naoClassificados}`
    );
  }
  if (resumo.persistencia) {
    linhas.push(
      `persistencia: persistidos=${resumo.persistencia.persistidos} duplicados=${resumo.persistencia.duplicadosPersistencia} semXml=${resumo.persistencia.semXml} xmlsInvalidosPersistidos=${resumo.persistencia.xmlsInvalidosPersistidos} bytesEstimados=${resumo.persistencia.bytesEstimados}`
    );
  }
  if (resumo.codigoErro) {
    linhas.push(`codigoErro: ${resumo.codigoErro}`);
    linhas.push(`motivo: ${resumo.motivo ?? ''}`);
  }
  const texto = linhas.join('\n');
  if (/ArquivoXml|nfseXmlGZip|BEGIN |password|passphrase|pfx/i.test(texto)) {
    return '=== Sync ADN controlada ===\nerro: saída bloqueada por sanitização.';
  }
  return texto;
}
