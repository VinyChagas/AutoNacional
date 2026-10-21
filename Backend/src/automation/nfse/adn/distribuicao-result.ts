/**
 * Classificação semântica de GET /DFe/{NSU}.
 * HTTP 404 sozinho não prova ausência global de documentos.
 */
import type { LoteDistribuicaoNsuResponse } from './types';

export type ClassificacaoDistribuicaoAdn =
  | 'documentos_localizados'
  | 'nenhum_documento_neste_nsu'
  | 'rejeicao_negocio'
  | 'nao_autorizado'
  | 'endpoint_ou_recurso_inexistente'
  | 'resposta_inesperada'
  | 'erro_cliente'
  | 'erro_servidor'
  | 'rate_limit';

export interface InterpretacaoDistribuicaoAdn {
  classificacao: ClassificacaoDistribuicaoAdn;
  statusHttp: number;
  statusProcessamento?: string;
  quantidadeLote: number;
  explicacao: string;
  autenticacaoOk: boolean;
}

export function interpretarRespostaDistribuicao(params: {
  statusHttp: number;
  data?: LoteDistribuicaoNsuResponse;
  rawBody?: string;
}): InterpretacaoDistribuicaoAdn {
  const { statusHttp, data, rawBody } = params;
  const statusProcessamento = data?.StatusProcessamento;
  const quantidadeLote = data?.LoteDFe?.length ?? 0;

  if (statusHttp === 401 || statusHttp === 403) {
    return {
      classificacao: 'nao_autorizado',
      statusHttp,
      statusProcessamento,
      quantidadeLote,
      explicacao: 'Falha de autenticação/autorização no ADN.',
      autenticacaoOk: false,
    };
  }

  if (statusHttp === 429) {
    return {
      classificacao: 'rate_limit',
      statusHttp,
      statusProcessamento,
      quantidadeLote,
      explicacao: 'Limite de requisições (HTTP 429).',
      autenticacaoOk: true,
    };
  }

  if (statusHttp >= 500) {
    return {
      classificacao: 'erro_servidor',
      statusHttp,
      statusProcessamento,
      quantidadeLote,
      explicacao: 'Erro temporário do servidor ADN.',
      autenticacaoOk: true,
    };
  }

  if (statusHttp === 400) {
    return {
      classificacao: statusProcessamento === 'REJEICAO' ? 'rejeicao_negocio' : 'erro_cliente',
      statusHttp,
      statusProcessamento,
      quantidadeLote,
      explicacao:
        statusProcessamento === 'REJEICAO'
          ? 'Requisição rejeitada pelo ADN.'
          : 'HTTP 400 sem StatusProcessamento claro.',
      autenticacaoOk: true,
    };
  }

  if (statusHttp === 200) {
    if (statusProcessamento === 'DOCUMENTOS_LOCALIZADOS' || quantidadeLote > 0) {
      return {
        classificacao: 'documentos_localizados',
        statusHttp,
        statusProcessamento,
        quantidadeLote,
        explicacao: 'Documentos retornados para o NSU informado.',
        autenticacaoOk: true,
      };
    }
    if (statusProcessamento === 'NENHUM_DOCUMENTO_LOCALIZADO') {
      return {
        classificacao: 'nenhum_documento_neste_nsu',
        statusHttp,
        statusProcessamento,
        quantidadeLote,
        explicacao:
          'ADN autenticou e respondeu que não há DF-e neste NSU. Não implica ausência em outros NSUs nem inventário mensal completo.',
        autenticacaoOk: true,
      };
    }
    if (statusProcessamento === 'REJEICAO') {
      return {
        classificacao: 'rejeicao_negocio',
        statusHttp,
        statusProcessamento,
        quantidadeLote,
        explicacao: 'HTTP 200 com REJEICAO.',
        autenticacaoOk: true,
      };
    }
    return {
      classificacao: 'resposta_inesperada',
      statusHttp,
      statusProcessamento,
      quantidadeLote,
      explicacao: 'HTTP 200 sem StatusProcessamento reconhecido.',
      autenticacaoOk: true,
    };
  }

  if (statusHttp === 404) {
    if (statusProcessamento === 'NENHUM_DOCUMENTO_LOCALIZADO' || quantidadeLote === 0) {
      const temCorpoAdn =
        Boolean(statusProcessamento) || Boolean(rawBody?.includes('StatusProcessamento'));
      if (temCorpoAdn || statusProcessamento === 'NENHUM_DOCUMENTO_LOCALIZADO') {
        return {
          classificacao: 'nenhum_documento_neste_nsu',
          statusHttp,
          statusProcessamento: statusProcessamento ?? 'NENHUM_DOCUMENTO_LOCALIZADO',
          quantidadeLote,
          explicacao:
            'HTTP 404 com corpo ADN: nenhum DF-e neste NSU. Não prova inventário mensal completo.',
          autenticacaoOk: true,
        };
      }
    }
    if (!rawBody || (!rawBody.includes('StatusProcessamento') && !rawBody.includes('LoteDFe'))) {
      return {
        classificacao: 'endpoint_ou_recurso_inexistente',
        statusHttp,
        statusProcessamento,
        quantidadeLote,
        explicacao: 'HTTP 404 sem corpo ADN reconhecível.',
        autenticacaoOk: false,
      };
    }
    return {
      classificacao: 'nenhum_documento_neste_nsu',
      statusHttp,
      statusProcessamento,
      quantidadeLote,
      explicacao: 'HTTP 404 na distribuição — ausência neste NSU.',
      autenticacaoOk: true,
    };
  }

  return {
    classificacao: 'resposta_inesperada',
    statusHttp,
    statusProcessamento,
    quantidadeLote,
    explicacao: `Status HTTP ${statusHttp} não mapeado.`,
    autenticacaoOk: statusHttp < 400,
  };
}
