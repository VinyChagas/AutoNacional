/**
 * Sincronização incremental ADN por cursor UltimoNSU.
 * COMPLETO = fim da distribuição NSU; NÃO declara inventário mensal completo.
 */
import type { AmbienteAdn } from './endpoints';
import { ErroAdn } from './errors';
import { analisarLote, dedupeKeyDistribuicao } from './lote-analyzer';
import { processarItemDistribuicao } from './classifier';
import {
  commitCheckpointAposLote,
  type PersistenciaCheckpointAdn,
} from './checkpoint-store';
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
}

export class SyncServiceAdn {
  constructor(
    private readonly client: AdnClient,
    private readonly checkpoint: PersistenciaCheckpointAdn,
    private readonly limites: LimitesAdn = LIMITES_ADN_PADRAO
  ) {}

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
    let ultimoNsuProcessado = cursor;
    let fimDistribuicaoConfirmado = false;
    let status: StatusSyncAdn = 'PARCIAL';
    let motivoParada = 'limite_max_requests';
    let ultimoCheckpoint = this.checkpoint.ler(cnpj, opts.ambiente) ?? undefined;

    const maxRequests = opts.maxRequests ?? this.limites.maxRequests;
    const documentos: DocumentoDistribuidoAdn[] = [];
    const seenKeys = new Set<string>();

    while (requests < maxRequests) {
      try {
        const result = await this.client.consultarDFe({
          nsu: cursor,
          cnpjConsulta: cnpj,
          lote: true,
          ambiente: opts.ambiente,
        });
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

        if (analise.proximoCursor == null) {
          status = 'ERRO';
          motivoParada = 'ausencia_cursor_continuidade';
          break;
        }

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

        lotesProcessados += 1;
        ultimoNsuProcessado = analise.proximoCursor;

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
          if (err.codigo === 'RATE_LIMIT') {
            status = 'PARCIAL';
            motivoParada = 'rate_limit';
            break;
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
      if (requests >= maxRequests) motivoParada = 'limite_max_requests';
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
      checkpoint: ultimoCheckpoint,
    };
  }
}
