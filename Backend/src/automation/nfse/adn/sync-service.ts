/**
 * Sincronização incremental ADN por cursor UltimoNSU.
 * COMPLETO = fim da distribuição NSU; NÃO declara inventário mensal completo.
 * Lock CNPJ+ambiente; checkpoint só após lote persistido com sucesso.
 */
import type { AmbienteAdn } from './endpoints';
import { ErroAdn } from './errors';
import { analisarLote, dedupeKeyDistribuicao, MAX_LOTE_DOCUMENTADO } from './lote-analyzer';
import { processarItemDistribuicao } from './classifier';
import {
  commitCheckpointAposLote,
  type PersistenciaCheckpointAdn,
} from './checkpoint-store';
import type { PersistenciaDocumentosAdn } from './document-store';
import type { SyncLockAdn } from './sync-lock';
import { SyncLockMemoriaAdn } from './sync-lock';
import type { AdnClient } from './adn-client';
import type {
  DocumentoDistribuidoAdn,
  LimitesAdn,
  ResultadoSyncAdn,
  StatusSyncAdn,
} from './types';
import { LIMITES_ADN_PADRAO } from './types';

export interface SyncAdnOptions {
  cnpj: string;
  ambiente: AmbienteAdn;
  nsuInicial?: number;
  maxRequests?: number;
  resume?: boolean;
  /** Cursor forçado (sobrescreve checkpoint). */
  forcarNsu?: number;
  /**
   * Se true (default), remove o XML do objeto em memória após persistir
   * (mantém caminhoArquivo / metadados).
   */
  descartarXmlEmMemoriaAposPersistir?: boolean;
  /** Override pontual do rate limit (ms). */
  rateLimitMs?: number;
  /**
   * Se retornar true antes de iniciar nova requisição, encerra com PARCIAL
   * após concluir o lote corrente (não aborta persistência em andamento).
   */
  deveInterromper?: () => boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class SyncServiceAdn {
  private readonly lock: SyncLockAdn;

  constructor(
    private readonly client: AdnClient,
    private readonly checkpoint: PersistenciaCheckpointAdn,
    private readonly limites: LimitesAdn = LIMITES_ADN_PADRAO,
    private readonly documentosStore: PersistenciaDocumentosAdn | null = null,
    lock?: SyncLockAdn | null
  ) {
    this.lock = lock ?? new SyncLockMemoriaAdn();
  }

  resolveCursorInicial(opts: SyncAdnOptions): number {
    if (opts.forcarNsu != null) return opts.forcarNsu;
    if (opts.nsuInicial != null) return opts.nsuInicial;
    if (opts.resume !== false) {
      const cp = this.checkpoint.ler(opts.cnpj, opts.ambiente);
      if (cp) return cp.ultimoNsuConfirmado;
    }
    return 1;
  }

  async syncDistribuicao(opts: SyncAdnOptions): Promise<ResultadoSyncAdn> {
    const cnpj = opts.cnpj.replace(/\D/g, '');
    const liberar = await this.lock.adquirir(cnpj, opts.ambiente);
    try {
      return await this.executarSyncSobLock(opts, cnpj);
    } finally {
      liberar();
    }
  }

  private async executarSyncSobLock(
    opts: SyncAdnOptions,
    cnpj: string
  ): Promise<ResultadoSyncAdn> {
    if (this.documentosStore?.reconciliar) {
      await this.documentosStore.reconciliar(cnpj, opts.ambiente);
    }

    const nsuInicial = this.resolveCursorInicial(opts);
    let cursor = nsuInicial;
    let requests = 0;
    let lotesProcessados = 0;
    let documentosDistribuidos = 0;
    let duplicidades = 0;
    let xmlsInvalidos = 0;
    let emitidas = 0;
    let recebidas = 0;
    let intermediadas = 0;
    let eventos = 0;
    let naoClassificados = 0;
    let persistidos = 0;
    let duplicadosPersistencia = 0;
    let semXml = 0;
    let xmlsInvalidosPersistidos = 0;
    let bytesEstimados = 0;
    let ultimoNsuProcessado = cursor;
    let fimDistribuicaoConfirmado = false;
    let status: StatusSyncAdn = 'PARCIAL';
    let motivoParada = 'limite_max_requests';
    let ultimoCheckpoint = this.checkpoint.ler(cnpj, opts.ambiente) ?? undefined;

    const maxRequests = opts.maxRequests ?? this.limites.maxRequests;
    const rateLimitMs = opts.rateLimitMs ?? this.limites.rateLimitMs ?? 0;
    let ultimoRequestAt = 0;
    const documentos: DocumentoDistribuidoAdn[] = [];
    const seenKeys = new Set<string>(
      this.documentosStore
        ? [...(await this.documentosStore.carregarChavesDedupe(cnpj, opts.ambiente))]
        : []
    );
    const descartarXml = opts.descartarXmlEmMemoriaAposPersistir !== false;

    while (requests < maxRequests) {
      if (opts.deveInterromper?.()) {
        status = 'PARCIAL';
        motivoParada = 'interrupcao_solicitada';
        break;
      }

      try {
        if (rateLimitMs > 0 && ultimoRequestAt > 0) {
          const elapsed = Date.now() - ultimoRequestAt;
          if (elapsed < rateLimitMs) {
            await sleep(rateLimitMs - elapsed);
          }
          // Reavalia após espera: não inicia nova GET se SIGINT chegou no sleep.
          if (opts.deveInterromper?.()) {
            status = 'PARCIAL';
            motivoParada = 'interrupcao_solicitada';
            break;
          }
        }

        const result = await this.client.consultarDFe({
          nsu: cursor,
          cnpjConsulta: cnpj,
          lote: true,
          ambiente: opts.ambiente,
        });
        ultimoRequestAt = Date.now();
        requests += 1;

        const analise = analisarLote(result.data, cursor, result.statusHttp);

        if (result.data?.StatusProcessamento === 'REJEICAO' || result.statusHttp === 400) {
          status = 'ERRO';
          motivoParada = 'rejeicao_adn';
          break;
        }

        if (analise.fimDistribuicao) {
          fimDistribuicaoConfirmado = true;
          status = 'COMPLETO';
          motivoParada = 'nenhum_documento_localizado';
          ultimoCheckpoint = commitCheckpointAposLote(this.checkpoint, {
            cnpj,
            ambiente: opts.ambiente,
            cursorConfirmado: cursor,
            lotesProcessados,
            documentosProcessados: documentosDistribuidos,
            nsuInicialSessao: nsuInicial,
            status,
            motivoParada,
            fimDistribuicaoConfirmado: true,
          });
          break;
        }

        const lote = result.data?.LoteDFe ?? [];
        if (lote.length === 0) {
          status = 'ERRO';
          motivoParada = 'lote_vazio_sem_status_fim';
          break;
        }

        if (lote.length > MAX_LOTE_DOCUMENTADO) {
          motivoParada = 'lote_acima_do_documentado';
        }

        if (analise.proximoCursor == null) {
          status = 'ERRO';
          motivoParada = 'ausencia_cursor_continuidade';
          break;
        }

        let falhaPersistencia = false;

        for (const item of lote) {
          const key = dedupeKeyDistribuicao(item);
          if (seenKeys.has(key)) {
            duplicidades += 1;
            continue;
          }
          seenKeys.add(key);
          documentosDistribuidos += 1;

          const doc = await processarItemDistribuicao({
            empresaCnpj: cnpj,
            item,
            limites: this.limites,
          });
          if (!doc.xmlValido) xmlsInvalidos += 1;

          if (this.documentosStore) {
            try {
              const salvo = await this.documentosStore.salvar(cnpj, opts.ambiente, doc);
              if (salvo.duplicado) {
                duplicadosPersistencia += 1;
                duplicidades += 1;
              } else if (salvo.caminho) {
                persistidos += 1;
                doc.caminhoArquivo = salvo.caminho;
                bytesEstimados += salvo.bytesGravados;
              } else {
                semXml += 1;
              }
              if (salvo.xmlInvalidoPersistido) xmlsInvalidosPersistidos += 1;
              if (descartarXml && doc.xml) {
                delete doc.xml;
              }
            } catch (persistErr) {
              falhaPersistencia = true;
              status = 'ERRO';
              if (persistErr instanceof ErroAdn) {
                motivoParada = `falha_persistencia:${persistErr.codigo.toLowerCase()}`;
              } else {
                motivoParada = 'falha_persistencia';
              }
              // Não avança checkpoint deste lote — documentos já gravados
              // permanecem e serão deduplicados na retomada.
              break;
            }
          }

          switch (doc.classificacao) {
            case 'emitida':
              emitidas += 1;
              break;
            case 'recebida':
              recebidas += 1;
              break;
            case 'intermediada':
              intermediadas += 1;
              break;
            case 'evento':
              eventos += 1;
              break;
            default:
              naoClassificados += 1;
          }
          documentos.push(doc);
        }

        if (falhaPersistencia) {
          break;
        }

        lotesProcessados += 1;
        ultimoNsuProcessado = analise.proximoCursor;

        // Checkpoint somente após lote processado e persistido com sucesso.
        ultimoCheckpoint = commitCheckpointAposLote(this.checkpoint, {
          cnpj,
          ambiente: opts.ambiente,
          cursorConfirmado: analise.proximoCursor,
          lotesProcessados,
          documentosProcessados: documentosDistribuidos,
          nsuInicialSessao: nsuInicial,
          status: 'PARCIAL',
          motivoParada: analise.loteCheio ? 'lote_cheio_continuar' : 'lote_parcial_continuar',
          fimDistribuicaoConfirmado: false,
        });

        if (!analise.progresso && analise.proximoCursor === cursor) {
          status = 'ERRO';
          motivoParada = 'cursor_sem_avanco';
          break;
        }

        cursor = analise.proximoCursor;
      } catch (err) {
        if (err instanceof ErroAdn) {
          if (err.codigo === 'HANDSHAKE_TLS' || err.codigo === 'NAO_AUTORIZADO') {
            status = 'ERRO';
            motivoParada = err.codigo.toLowerCase();
            throw err;
          }
          if (err.codigo === 'SYNC_EM_ANDAMENTO') {
            throw err;
          }
          if (err.codigo === 'RATE_LIMIT') {
            status = 'PARCIAL';
            motivoParada = 'rate_limit';
            break;
          }
          if (err.codigo === 'CHECKPOINT_CORROMPIDO' || err.codigo === 'CHECKPOINT_INVALIDO') {
            status = 'ERRO';
            motivoParada = err.codigo.toLowerCase();
            throw err;
          }
          if (err.classe === 'TRANSITORIO') {
            status = 'PARCIAL';
            motivoParada = err.codigo.toLowerCase();
            break;
          }
          status = 'ERRO';
          motivoParada = err.codigo.toLowerCase();
          break;
        }
        status = 'ERRO';
        motivoParada = 'erro_http_ou_processamento';
        break;
      }
    }

    if (!fimDistribuicaoConfirmado && status !== 'ERRO') {
      status = 'PARCIAL';
      if (motivoParada !== 'interrupcao_solicitada' && requests >= maxRequests) {
        motivoParada = 'limite_max_requests';
      }
    }
    if (status === 'COMPLETO' && !fimDistribuicaoConfirmado) {
      status = 'PARCIAL';
    }

    return {
      cnpj,
      ambiente: opts.ambiente,
      documentos,
      nsuInicial,
      ultimoNsuProcessado,
      lotesProcessados,
      requests,
      status,
      fimDistribuicaoConfirmado,
      inventarioMensalCompletoDeclarado: false,
      motivoParada,
      duplicidades,
      xmlsInvalidos,
      contagens: {
        emitidas,
        recebidas,
        intermediadas,
        eventos,
        naoClassificados,
      },
      persistencia: this.documentosStore
        ? {
            persistidos,
            duplicadosPersistencia,
            semXml,
            xmlsInvalidosPersistidos,
            bytesEstimados,
          }
        : undefined,
      checkpoint: ultimoCheckpoint,
    };
  }
}
