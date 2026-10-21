/**
 * Transporte HTTPS mTLS para o ADN.
 * Reutiliza CredencialMtls e o padrão Agent-por-requisição do recovery SEFIN.
 * Hosts restritos ao ADN; injetável em testes (sem rede real).
 */
import https from 'node:https';
import type { CredencialMtls } from '../recovery/types';
import { inspecionarCredencialMtls } from '../recovery/mtls-provider';
import { ErroAdn } from './errors';
import { hostAdnPermitido } from './endpoints';
import type { LimitesAdn, RespostaHttpAdn, TransporteHttpAdn } from './types';

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

export interface ClienteHttpsMtlsAdn {
  Agent: new (opcoes: https.AgentOptions) => AgenteMtls;
  request(
    opcoes: https.RequestOptions,
    callback: (resposta: RespostaHttpsMinima) => void
  ): RequisicaoHttpsMinima;
}

export function classificarFalhaTransporteAdn(erro: unknown): ErroAdn {
  if (erro instanceof ErroAdn) return erro;
  const codigo = erro && typeof erro === 'object' && 'code' in erro ? String(erro.code) : '';
  const mensagem = erro instanceof Error ? erro.message : String(erro);
  const texto = `${codigo} ${mensagem}`;
  if (/ETIMEDOUT|ESOCKETTIMEDOUT|timeout/i.test(texto)) {
    return new ErroAdn('TIMEOUT', 'TRANSITORIO', 'Tempo esgotado na consulta ADN.');
  }
  if (/certificate|SSL|TLS|CERT_|UNABLE_TO_VERIFY|handshake/i.test(texto)) {
    return new ErroAdn('HANDSHAKE_TLS', 'BLOQUEANTE', 'Falha no handshake TLS da consulta ADN.');
  }
  if (/ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|socket hang up/i.test(texto)) {
    return new ErroAdn('FALHA_CONEXAO', 'TRANSITORIO', 'Falha de conexão com o ADN.');
  }
  return new ErroAdn('FALHA_CONEXAO', 'TRANSITORIO', 'Falha de transporte na consulta ADN.');
}

export function criarTransporteHttpsMtlsAdn(
  cliente: ClienteHttpsMtlsAdn = https as unknown as ClienteHttpsMtlsAdn
): TransporteHttpAdn {
  let lastRequestAt = 0;

  return {
    async get(url, credencial, limites) {
      if (url.protocol !== 'https:' || !hostAdnPermitido(url.hostname)) {
        throw new ErroAdn('URL_ADN_INVALIDA', 'BLOQUEANTE', 'Host ADN não autorizado.');
      }
      try {
        inspecionarCredencialMtls(credencial);
      } catch (erro) {
        if (erro instanceof Error && 'codigo' in erro) {
          const sefin = erro as { codigo: string; message: string };
          throw new ErroAdn(sefin.codigo, 'BLOQUEANTE', sefin.message);
        }
        throw new ErroAdn('CERTIFICADO_INDISPONIVEL', 'BLOQUEANTE', 'Certificado A1 indisponível para ADN.');
      }

      const rateMs = (limites as LimitesAdn).rateLimitMs ?? 0;
      if (rateMs > 0 && lastRequestAt) {
        const elapsed = Date.now() - lastRequestAt;
        if (elapsed < rateMs) {
          await new Promise((r) => setTimeout(r, rateMs - elapsed));
        }
      }
      lastRequestAt = Date.now();

      return consultarHttps(url, credencial, limites, cliente);
    },
  };
}

function consultarHttps(
  url: URL,
  credencial: CredencialMtls,
  limites: Pick<LimitesAdn, 'timeoutMs' | 'maxBytesResposta'>,
  cliente: ClienteHttpsMtlsAdn
): Promise<RespostaHttpAdn> {
  return new Promise((resolve, reject) => {
    let agente: AgenteMtls | null = null;
    let encerrado = false;
    const started = Date.now();
    const limite = new ErroAdn(
      'LIMITE_RESPOSTA',
      'PERMANENTE',
      'Resposta do ADN excede o limite configurado.'
    );
    const concluir = (acao: () => void) => {
      if (encerrado) return;
      encerrado = true;
      const atual = agente;
      agente = null;
      try {
        atual?.destroy();
      } catch {
        // não vazar material criptográfico
      }
      acao();
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
          headers: { Accept: 'application/json, application/xml, text/plain, */*' },
          rejectUnauthorized: true,
          timeout: limites.timeoutMs,
        },
        (resposta) => {
          try {
            const declarado = Number(resposta.headers['content-length'] ?? 0);
            if (declarado > limites.maxBytesResposta) {
              concluir(() => reject(limite));
              try {
                resposta.destroy();
              } catch {
                /* ignore */
              }
              return;
            }
            const partes: Buffer[] = [];
            let total = 0;
            resposta.on('data', (valor) => {
              try {
                const pedaco = valor as Buffer;
                total += pedaco.length;
                if (total > limites.maxBytesResposta) {
                  concluir(() => reject(limite));
                  try {
                    resposta.destroy();
                  } catch {
                    /* ignore */
                  }
                  return;
                }
                partes.push(pedaco);
              } catch (erro) {
                concluir(() => reject(classificarFalhaTransporteAdn(erro)));
              }
            });
            resposta.on('end', () => {
              concluir(() =>
                resolve({
                  status: resposta.statusCode ?? 0,
                  body: Buffer.concat(partes, total),
                  durationMs: Date.now() - started,
                  url: url.toString(),
                })
              );
            });
            resposta.on('error', (erro) => {
              concluir(() => reject(classificarFalhaTransporteAdn(erro)));
            });
          } catch (erro) {
            concluir(() => reject(classificarFalhaTransporteAdn(erro)));
          }
        }
      );
      requisicao.on('timeout', () => {
        const erro = Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
        concluir(() => reject(classificarFalhaTransporteAdn(erro)));
        try {
          requisicao.destroy(erro);
        } catch {
          /* ignore */
        }
      });
      requisicao.on('error', (erro) => {
        concluir(() => reject(classificarFalhaTransporteAdn(erro)));
      });
      requisicao.end();
    } catch (erro) {
      concluir(() => reject(classificarFalhaTransporteAdn(erro)));
    }
  });
}
