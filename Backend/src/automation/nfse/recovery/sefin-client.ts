/**
 * URL da consulta e transporte HTTPS com mTLS por requisição.
 * O agente TLS não é global e a verificação do servidor permanece ligada.
 */
import https from 'node:https';
import { validarChaveNacional } from '../contracts/documento-fiscal';
import { ErroRecuperacaoSefin, HOST_SEFIN, URL_BASE_SEFIN } from './types';
import type {
  CredencialMtls,
  LimitesRecuperacaoSefin,
  RespostaHttpSefin,
  TransporteHttpMtls,
} from './types';

interface AgenteMtls {
  destroy(): void;
}

interface RespostaHttpsMinima {
  statusCode?: number;
  headers: NodeJS.Dict<string | string[] | undefined>;
  destroy(): void;
  on(evento: string, ouvinte: (valor?: unknown) => void): void;
}

interface RequisicaoHttpsMinima {
  on(evento: string, ouvinte: (valor?: unknown) => void): void;
  destroy(erro?: Error): void;
  end(): void;
}

/** Transporte injetável nos testes. A chamada real usa o módulo https do Node. */
export interface ClienteHttpsMtls {
  Agent: new (opcoes: https.AgentOptions) => AgenteMtls;
  request(opcoes: https.RequestOptions, callback: (resposta: RespostaHttpsMinima) => void): RequisicaoHttpsMinima;
}

export function montarUrlConsultaSefin(chave: string, baseUrl = URL_BASE_SEFIN): URL {
  const chaveNacional = validarChaveNacional(chave);
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    throw new ErroRecuperacaoSefin('URL_SEFIN_INVALIDA', 'BLOQUEANTE', 'URL base da SEFIN inválida.');
  }
  if (base.protocol !== 'https:' || base.hostname !== HOST_SEFIN) {
    throw new ErroRecuperacaoSefin(
      'URL_SEFIN_INVALIDA',
      'BLOQUEANTE',
      'A consulta só é permitida no host sefin.nfse.gov.br.'
    );
  }
  const prefixo = base.pathname.replace(/\/+$/, '') || '';
  if (prefixo !== '/SefinNacional') {
    throw new ErroRecuperacaoSefin(
      'URL_SEFIN_INVALIDA',
      'BLOQUEANTE',
      'A consulta só é permitida em /SefinNacional/nfse/{chave}.'
    );
  }
  return new URL(`${prefixo}/nfse/${chaveNacional}`, base.origin);
}

export function classificarFalhaTransporte(erro: unknown): ErroRecuperacaoSefin {
  if (erro instanceof ErroRecuperacaoSefin) return erro;
  const codigo = erro && typeof erro === 'object' && 'code' in erro ? String(erro.code) : '';
  const mensagem = erro instanceof Error ? erro.message : String(erro);
  const texto = `${codigo} ${mensagem}`;
  if (/ETIMEDOUT|ESOCKETTIMEDOUT|timeout/i.test(texto)) {
    return new ErroRecuperacaoSefin('TIMEOUT', 'TRANSITORIO', 'Tempo esgotado na consulta SEFIN.');
  }
  if (/certificate|SSL|TLS|CERT_|UNABLE_TO_VERIFY|handshake/i.test(texto)) {
    return new ErroRecuperacaoSefin('HANDSHAKE_TLS', 'BLOQUEANTE', 'Falha no handshake TLS da consulta SEFIN.');
  }
  if (/ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|socket hang up/i.test(texto)) {
    return new ErroRecuperacaoSefin('FALHA_CONEXAO', 'TRANSITORIO', 'Falha de conexão com a SEFIN.');
  }
  return new ErroRecuperacaoSefin('FALHA_CONEXAO', 'TRANSITORIO', 'Falha de transporte na consulta SEFIN.');
}

export function criarTransporteHttpsMtls(
  cliente: ClienteHttpsMtls = https as unknown as ClienteHttpsMtls
): TransporteHttpMtls {
  return {
    consultar(url, credencial, limites) {
      return consultarHttps(url, credencial, limites, cliente);
    },
  };
}

function consultarHttps(
  url: URL,
  credencial: CredencialMtls,
  limites: LimitesRecuperacaoSefin,
  cliente: ClienteHttpsMtls
): Promise<RespostaHttpSefin> {
  if (url.protocol !== 'https:' || url.hostname !== HOST_SEFIN || !/^\/SefinNacional\/nfse\/\d{50}$/.test(url.pathname)) {
    return Promise.reject(
      new ErroRecuperacaoSefin('URL_SEFIN_INVALIDA', 'BLOQUEANTE', 'Host da consulta SEFIN não autorizado.')
    );
  }

  return new Promise((resolve, reject) => {
    let agente: AgenteMtls | null = null;
    let encerrado = false;
    const limite = new ErroRecuperacaoSefin(
      'LIMITE_RESPOSTA',
      'PERMANENTE',
      'Resposta da SEFIN excede o limite configurado.'
    );
    const concluir = (acao: () => void) => {
      if (encerrado) return;
      encerrado = true;
      const atual = agente;
      agente = null;
      try {
        atual?.destroy();
      } catch {
        // A liberação não pode recolocar senha ou PFX na falha da consulta.
      }
      acao();
    };
    const soltar = (acao: () => void) => {
      try {
        acao();
      } catch {
        // Interromper o fluxo não pode devolver senha ou PFX.
      }
    };

    try {
      agente = new cliente.Agent({
        pfx: credencial.pfx,
        passphrase: credencial.senha,
        rejectUnauthorized: true,
        keepAlive: false,
        minVersion: 'TLSv1.2',
        maxVersion: 'TLSv1.3',
      });
      const requisicao = cliente.request(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || 443,
          path: `${url.pathname}${url.search}`,
          method: 'GET',
          agent: agente as https.Agent,
          headers: { Accept: 'application/json' },
          rejectUnauthorized: true,
          timeout: limites.timeoutMs,
        },
        (resposta) => {
          try {
            const declarado = Number(resposta.headers['content-length'] ?? 0);
            if (declarado > limites.maxBytesResposta) {
              concluir(() => reject(limite));
              soltar(() => resposta.destroy());
              return;
            }
            const partes: Buffer[] = [];
            let total = 0;
            resposta.on('data', (valor) => {
              try {
                const pedaço = valor as Buffer;
                total += pedaço.length;
                if (total > limites.maxBytesResposta) {
                  concluir(() => reject(limite));
                  soltar(() => resposta.destroy());
                  return;
                }
                partes.push(pedaço);
              } catch (erro) {
                concluir(() => reject(classificarFalhaTransporte(erro)));
                soltar(() => resposta.destroy());
              }
            });
            resposta.on('end', () => {
              concluir(() => resolve({ status: resposta.statusCode ?? 0, body: Buffer.concat(partes, total) }));
            });
            resposta.on('error', (erro) => {
              concluir(() => reject(classificarFalhaTransporte(erro)));
            });
          } catch (erro) {
            concluir(() => reject(classificarFalhaTransporte(erro)));
            soltar(() => resposta.destroy());
          }
        }
      );
      requisicao.on('timeout', () => {
        const erro = Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
        concluir(() => reject(classificarFalhaTransporte(erro)));
        soltar(() => requisicao.destroy(erro));
      });
      requisicao.on('error', (erro) => {
        concluir(() => reject(classificarFalhaTransporte(erro)));
      });
      requisicao.end();
    } catch (erro) {
      concluir(() => reject(classificarFalhaTransporte(erro)));
    }
  });
}
