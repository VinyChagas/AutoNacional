/**
 * Cliente ADN Contribuintes — GET /DFe/{NSU}.
 * Sem Playwright. Transporte mTLS injetável (testes offline).
 */
import type { CredencialMtls } from '../recovery/types';
import { ErroAdn } from './errors';
import { montarUrlDistribuicaoDfe, type AmbienteAdn } from './endpoints';
import {
  interpretarRespostaDistribuicao,
  type InterpretacaoDistribuicaoAdn,
} from './distribuicao-result';
import type {
  LimitesAdn,
  LoteDistribuicaoNsuResponse,
  TransporteHttpAdn,
} from './types';
import { LIMITES_ADN_PADRAO } from './types';

export interface ConsultaDfeAdnOptions {
  nsu: number;
  cnpjConsulta: string;
  lote?: boolean;
  ambiente: AmbienteAdn;
  /** Override de base (somente testes). */
  baseUrl?: string;
}

export interface ResultadoConsultaDfeAdn {
  data?: LoteDistribuicaoNsuResponse;
  statusHttp: number;
  durationMs: number;
  url: string;
  rawBody: string;
  interpretacao: InterpretacaoDistribuicaoAdn;
}

export class AdnClient {
  constructor(
    private readonly transporte: TransporteHttpAdn,
    private readonly credencial: CredencialMtls,
    private readonly limites: LimitesAdn = LIMITES_ADN_PADRAO
  ) {}

  async consultarDFe(opts: ConsultaDfeAdnOptions): Promise<ResultadoConsultaDfeAdn> {
    if (!Number.isInteger(opts.nsu) || opts.nsu < 0) {
      throw new ErroAdn('NSU_INVALIDO', 'PERMANENTE', 'NSU inválido.');
    }
    const cnpj = opts.cnpjConsulta.replace(/\D/g, '');
    if (!/^\d{14}$/.test(cnpj)) {
      throw new ErroAdn('CNPJ_INVALIDO', 'PERMANENTE', 'cnpjConsulta deve ter 14 dígitos.');
    }

    const url = montarUrlDistribuicaoDfe({
      ambiente: opts.ambiente,
      nsu: opts.nsu,
      cnpjConsulta: cnpj,
      lote: opts.lote ?? true,
      baseUrl: opts.baseUrl,
    });

    const resposta = await this.transporte.get(url, this.credencial, this.limites);
    const rawBody = resposta.body.toString('utf8');
    let data: LoteDistribuicaoNsuResponse | undefined;
    if (rawBody) {
      try {
        data = JSON.parse(rawBody) as LoteDistribuicaoNsuResponse;
      } catch {
        // raw preservado
      }
    }

    const interpretacao = interpretarRespostaDistribuicao({
      statusHttp: resposta.status,
      data,
      rawBody,
    });

    if (interpretacao.classificacao === 'nao_autorizado') {
      throw new ErroAdn('NAO_AUTORIZADO', 'BLOQUEANTE', interpretacao.explicacao);
    }
    if (interpretacao.classificacao === 'rate_limit') {
      throw new ErroAdn('RATE_LIMIT', 'TRANSITORIO', interpretacao.explicacao);
    }
    if (interpretacao.classificacao === 'erro_servidor') {
      throw new ErroAdn('ERRO_SERVIDOR', 'TRANSITORIO', interpretacao.explicacao);
    }
    if (interpretacao.classificacao === 'endpoint_ou_recurso_inexistente') {
      throw new ErroAdn('ENDPOINT_INVALIDO', 'BLOQUEANTE', interpretacao.explicacao);
    }

    return {
      data,
      statusHttp: resposta.status,
      durationMs: resposta.durationMs,
      url: resposta.url,
      rawBody,
      interpretacao,
    };
  }
}
