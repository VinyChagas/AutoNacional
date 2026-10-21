/**
 * Harness de sincronização ADN controlada (homologação).
 * Gate duplo + 1 GET + persistência isolada + lock. Sem Iniciar/SEFIN/Playwright.
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
import { avaliarGateLiveAdn } from './live-gate';
import { criarTransporteHttpsMtlsAdn } from './mtls-transport';
import { TransporteUmaRequisicaoAdn } from './smoke-service';
import { SyncLockCompostoAdn, SyncLockArquivoAdn } from './sync-lock';
import { SyncServiceAdn } from './sync-service';
import type { LimitesAdn, TransporteHttpAdn } from './types';

/** Limites do harness controlado: 1 requisição, lote ≤50 docs. */
export const LIMITES_SYNC_CONTROLADA_ADN: LimitesAdn = {
  timeoutMs: 20_000,
  maxBytesResposta: 4_000_000,
  maxBytesGzip: 1_500_000,
  maxBytesXml: 4_000_000,
  rateLimitMs: 250,
  maxRequests: 1,
  maxBytesArmazenamentoCnpj: 512 * 1024 * 1024,
};

export const ENV_ADN_HOMOLOG_ROOT = 'ADN_HOMOLOG_ROOT';
export const MAX_DOCS_SYNC_CONTROLADA = 50;

export interface EntradaSyncControladaAdn {
  cnpj: string;
  ambiente: AmbienteAdn;
  confirmLive: boolean;
  /** NSU inicial; se omitido e resume=true, usa checkpoint. */
  nsu?: number;
  resume?: boolean;
  /** Raiz de homologação isolada (checkpoints/documentos/locks). */
  raizHomologacao?: string;
  env?: NodeJS.ProcessEnv;
}

export interface DependenciasSyncControladaAdn {
  obterCredencial?: (cnpj: string) => Promise<CredencialMtls>;
  criarTransporte?: () => TransporteHttpAdn;
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
}

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
  };
}

/**
 * Resolve raiz de homologação isolada.
 * Prioridade: parâmetro explícito → ADN_HOMOLOG_ROOT → .adn-homologacao no cwd.
 */
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
} {
  const resolved = path.resolve(raiz);
  if (!resolved || resolved.includes('\0')) {
    throw new ErroAdn('RAIZ_INVALIDA', 'BLOQUEANTE', 'Raiz de homologação ADN inválida.');
  }
  const checkpoints = path.join(resolved, 'checkpoints');
  const documentos = path.join(resolved, 'documentos');
  const locks = path.join(resolved, 'locks');
  for (const d of [resolved, checkpoints, documentos, locks]) {
    fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  }
  return { raiz: resolved, checkpoints, documentos, locks };
}

/**
 * Executa sync controlada: gate → A1 → 1 GET → persistência sob lock.
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

  const cnpj = entrada.cnpj.replace(/\D/g, '');
  if (!/^\d{14}$/.test(cnpj)) {
    return resumoFalha('CNPJ_INVALIDO', 'CNPJ deve ter 14 dígitos.');
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
      });
    }
    return resumoFalha('CNPJ_INCOMPATIVEL', 'CNPJ incompatível com o certificado.', {
      cnpj,
      ambiente: entrada.ambiente,
      raizHomologacao: arvore.raiz,
    });
  }

  const inner = deps.criarTransporte?.() ?? criarTransporteHttpsMtlsAdn();
  const transporte = new TransporteUmaRequisicaoAdn(inner);
  const client = new AdnClient(transporte, credencial, LIMITES_SYNC_CONTROLADA_ADN);
  const checkpoint = new CheckpointStoreArquivo(arvore.checkpoints);
  const documentos = new DocumentStoreArquivoAdn(arvore.documentos, LIMITES_SYNC_CONTROLADA_ADN);
  const lock = new SyncLockCompostoAdn(new SyncLockArquivoAdn(arvore.locks));
  const sync = new SyncServiceAdn(
    client,
    checkpoint,
    LIMITES_SYNC_CONTROLADA_ADN,
    documentos,
    lock
  );

  const resume = entrada.resume !== false;
  const forcarNsu =
    entrada.nsu != null && Number.isInteger(entrada.nsu) && entrada.nsu >= 0
      ? entrada.nsu
      : undefined;

  try {
    const resultado = await sync.syncDistribuicao({
      cnpj,
      ambiente: entrada.ambiente,
      forcarNsu,
      resume: forcarNsu != null ? false : resume,
      maxRequests: 1,
      rateLimitMs: LIMITES_SYNC_CONTROLADA_ADN.rateLimitMs,
      descartarXmlEmMemoriaAposPersistir: true,
    });

    if (resultado.documentos.length > MAX_DOCS_SYNC_CONTROLADA) {
      return resumoFalha(
        'LIMITE_DOCUMENTOS',
        `Sync controlada aceita no máximo ${MAX_DOCS_SYNC_CONTROLADA} documentos por execução.`,
        {
          cnpj,
          ambiente: entrada.ambiente,
          nsuInicial: resultado.nsuInicial,
          ultimoNsuProcessado: resultado.ultimoNsuProcessado,
          requests: resultado.requests,
          lotesProcessados: resultado.lotesProcessados,
          statusSync: resultado.status,
          raizHomologacao: arvore.raiz,
          checkpointGravado: Boolean(resultado.checkpoint),
          ultimoNsuConfirmado: resultado.checkpoint?.ultimoNsuConfirmado ?? null,
          motivoParada: resultado.motivoParada,
        }
      );
    }

    const ok = resultado.status !== 'ERRO';
    return {
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
    };
  } catch (erro) {
    if (erro instanceof ErroAdn) {
      return resumoFalha(erro.codigo, erro.message, {
        cnpj,
        ambiente: entrada.ambiente,
        requests: transporte.requisicoes,
        raizHomologacao: arvore.raiz,
      });
    }
    return resumoFalha(
      'FALHA_SYNC_CONTROLADA',
      erro instanceof Error ? erro.message : 'Falha na sync controlada ADN.',
      {
        cnpj,
        ambiente: entrada.ambiente,
        requests: transporte.requisicoes,
        raizHomologacao: arvore.raiz,
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
  if (/ArquivoXml|nfseXmlGZip|BEGIN |password|passphrase|pfx|\.xml\b/i.test(texto)) {
    return '=== Sync ADN controlada ===\nerro: saída bloqueada por sanitização.';
  }
  return texto;
}
