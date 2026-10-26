/**
 * Testes offline do smoke ADN.
 * Sem rede, sem Portal, sem SEFIN, sem Playwright.
 */
import * as forge from 'node-forge';
import { describe, expect, it } from 'vitest';
import { assertCnpjCompativelComCertificado, extrairCnpjDoCertificadoA1 } from './cert-identity';
import { CheckpointStoreArquivo } from './checkpoint-store';
import { ErroAdn } from './errors';
import { avaliarGateLiveAdn } from './live-gate';
import {
  executarSmokeAdn,
  formatarResumoSmokeAdn,
  TransporteUmaRequisicaoAdn,
} from './smoke-service';
import type { CredencialMtls, LoteDistribuicaoNsuResponse, TransporteHttpAdn } from './types';

const CNPJ = '12345678000190';
const CNPJ_OUTRO = '99888777000166';
const SENHA = 'senha-teste';

function pfxComCnpj(cnpj: string, senha = SENHA, notAfter = new Date('2099-01-01T00:00:00Z')): Buffer {
  const chaves = forge.pki.rsa.generateKeyPair(512);
  const certificado = forge.pki.createCertificate();
  certificado.publicKey = chaves.publicKey;
  certificado.serialNumber = '01';
  certificado.validity.notBefore = new Date('2020-01-01T00:00:00Z');
  certificado.validity.notAfter = notAfter;
  const atributos = [{ name: 'commonName', value: `Empresa Teste:${cnpj}` }];
  certificado.setSubject(atributos);
  certificado.setIssuer(atributos);
  certificado.setExtensions([{ name: 'basicConstraints', cA: false }]);
  certificado.sign(chaves.privateKey, forge.md.sha256.create());
  const asn1 = forge.pkcs12.toPkcs12Asn1(chaves.privateKey, [certificado], senha);
  return Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary');
}

function credencialOk(cnpj = CNPJ): CredencialMtls {
  return { pfx: pfxComCnpj(cnpj), senha: SENHA };
}

function mockTransporte(
  resposta: { status: number; body: LoteDistribuicaoNsuResponse | string }
): TransporteHttpAdn {
  return {
    async get(url) {
      const body =
        typeof resposta.body === 'string'
          ? Buffer.from(resposta.body)
          : Buffer.from(JSON.stringify(resposta.body));
      return { status: resposta.status, body, durationMs: 12, url: url.toString() };
    },
  };
}

describe('live-gate ADN', () => {
  it('gate fechado sem env e sem confirm', () => {
    const g = avaliarGateLiveAdn({ confirmLive: false, env: {} });
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.codigo).toBe('GATE_FECHADO');
  });

  it('confirmação ausente com env true', () => {
    const g = avaliarGateLiveAdn({
      confirmLive: false,
      env: { NFSE_ALLOW_LIVE: 'true' },
    });
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.codigo).toBe('CONFIRMACAO_AUSENTE');
  });

  it('gate aberto com env + confirm', () => {
    const g = avaliarGateLiveAdn({
      confirmLive: true,
      env: { NFSE_ALLOW_LIVE: '1' },
    });
    expect(g.ok).toBe(true);
  });
});

describe('identidade certificado × CNPJ', () => {
  it('extrai CNPJ do subject', () => {
    expect(extrairCnpjDoCertificadoA1(credencialOk())).toBe(CNPJ);
  });

  it('CNPJ incompatível', () => {
    expect(() => assertCnpjCompativelComCertificado(CNPJ_OUTRO, credencialOk(CNPJ))).toThrow(
      ErroAdn
    );
    try {
      assertCnpjCompativelComCertificado(CNPJ_OUTRO, credencialOk(CNPJ));
    } catch (e) {
      expect(e).toMatchObject({ codigo: 'CNPJ_INCOMPATIVEL' });
    }
  });

  it('certificado inválido (PFX vazio)', () => {
    expect(() =>
      extrairCnpjDoCertificadoA1({ pfx: Buffer.alloc(0), senha: SENHA })
    ).toThrow(ErroAdn);
  });

  it('senha inválida', () => {
    expect(() =>
      extrairCnpjDoCertificadoA1({ pfx: pfxComCnpj(CNPJ), senha: 'errada' })
    ).toThrow(ErroAdn);
  });
});

describe('executarSmokeAdn offline', () => {
  const baseEntrada = {
    cnpj: CNPJ,
    nsu: 1,
    ambiente: 'producao' as const,
    confirmLive: true,
    env: { NFSE_ALLOW_LIVE: 'true' },
  };

  it('bloqueia com gate fechado sem chamar transporte', async () => {
    let hits = 0;
    const r = await executarSmokeAdn(
      { ...baseEntrada, confirmLive: false, env: {} },
      {
        obterCredencial: async () => {
          hits += 1;
          return credencialOk();
        },
        criarTransporte: () =>
          mockTransporte({
            status: 200,
            body: { StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS', LoteDFe: [{ NSU: 2 }] },
          }),
      }
    );
    expect(r.ok).toBe(false);
    expect(r.codigoErro).toBe('GATE_FECHADO');
    expect(r.requisicoesHttp).toBe(0);
    expect(hits).toBe(0);
    expect(r.checkpointGravado).toBe(false);
  });

  it('bloqueia confirmação ausente', async () => {
    const r = await executarSmokeAdn(
      { ...baseEntrada, confirmLive: false },
      {
        obterCredencial: async () => credencialOk(),
        criarTransporte: () => mockTransporte({ status: 200, body: {} }),
      }
    );
    expect(r.codigoErro).toBe('CONFIRMACAO_AUSENTE');
    expect(r.requisicoesHttp).toBe(0);
  });

  it('CNPJ incompatível com certificado', async () => {
    const r = await executarSmokeAdn(baseEntrada, {
      obterCredencial: async () => credencialOk(CNPJ_OUTRO),
      criarTransporte: () => mockTransporte({ status: 200, body: {} }),
    });
    expect(r.ok).toBe(false);
    expect(r.codigoErro).toBe('CNPJ_INCOMPATIVEL');
    expect(r.requisicoesHttp).toBe(0);
  });

  it('certificado inválido no carregamento', async () => {
    const r = await executarSmokeAdn(baseEntrada, {
      obterCredencial: async () => {
        throw Object.assign(new Error('Certificado A1 inacessível.'), {
          codigo: 'CERTIFICADO_INACESSIVEL',
        });
      },
      criarTransporte: () => mockTransporte({ status: 200, body: {} }),
    });
    expect(r.ok).toBe(false);
    expect(r.codigoErro).toBe('CERTIFICADO_INACESSIVEL');
  });

  it('sucesso sanitizado — 1 GET, sem rawBody/XML', async () => {
    const r = await executarSmokeAdn(baseEntrada, {
      obterCredencial: async () => credencialOk(),
      criarTransporte: () =>
        mockTransporte({
          status: 200,
          body: {
            StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS',
            LoteDFe: [
              { NSU: 2, ArquivoXml: 'SEGREDO_NAO_DEVE_APARECER' },
              { NSU: 3, ArquivoXml: 'OUTRO_XML' },
            ],
          },
        }),
    });
    expect(r.ok).toBe(true);
    expect(r.httpStatus).toBe(200);
    expect(r.statusProcessamento).toBe('DOCUMENTOS_LOCALIZADOS');
    expect(r.quantidadeDocumentos).toBe(2);
    expect(r.duracaoMs).toBe(12);
    expect(r.mtlsAutenticado).toBe(true);
    expect(r.requisicoesHttp).toBe(1);
    expect(r.checkpointGravado).toBe(false);

    const texto = formatarResumoSmokeAdn(r);
    expect(texto).toContain('httpStatus: 200');
    expect(texto).not.toMatch(/SEGREDO|ArquivoXml|rawBody|pfx|senha/i);
    expect(JSON.stringify(r)).not.toMatch(/SEGREDO|ArquivoXml/);
  });

  it('bloqueia segunda requisição HTTP', async () => {
    const wrap = new TransporteUmaRequisicaoAdn(
      mockTransporte({
        status: 200,
        body: { StatusProcessamento: 'NENHUM_DOCUMENTO_LOCALIZADO', LoteDFe: [] },
      })
    );
    await wrap.get(new URL('https://adn.nfse.gov.br/contribuintes/DFe/1'), credencialOk(), {
      timeoutMs: 1000,
      maxBytesResposta: 1000,
    });
    await expect(
      wrap.get(new URL('https://adn.nfse.gov.br/contribuintes/DFe/1'), credencialOk(), {
        timeoutMs: 1000,
        maxBytesResposta: 1000,
      })
    ).rejects.toMatchObject({ codigo: 'LIMITE_SMOKE' });
    expect(wrap.requisicoes).toBe(2);
  });

  it('não grava checkpoint (arquivo nunca chamado)', async () => {
    const dir = '/tmp/adn-smoke-checkpoint-nao-deve-existir-teste';
    const store = new CheckpointStoreArquivo(dir);
    let gravou = false;
    const original = store.gravar.bind(store);
    store.gravar = (cp) => {
      gravou = true;
      original(cp);
    };

    await executarSmokeAdn(baseEntrada, {
      obterCredencial: async () => credencialOk(),
      criarTransporte: () =>
        mockTransporte({
          status: 200,
          body: { StatusProcessamento: 'NENHUM_DOCUMENTO_LOCALIZADO', LoteDFe: [] },
        }),
    });
    expect(gravou).toBe(false);
  });

  it('erro TLS → mtlsAutenticado false', async () => {
    const r = await executarSmokeAdn(baseEntrada, {
      obterCredencial: async () => credencialOk(),
      criarTransporte: () => ({
        async get() {
          throw new ErroAdn('HANDSHAKE_TLS', 'BLOQUEANTE', 'Falha TLS');
        },
      }),
    });
    expect(r.ok).toBe(false);
    expect(r.codigoErro).toBe('HANDSHAKE_TLS');
    expect(r.mtlsAutenticado).toBe(false);
  });

  it('HTTP 401 → não autorizado', async () => {
    const r = await executarSmokeAdn(baseEntrada, {
      obterCredencial: async () => credencialOk(),
      criarTransporte: () => mockTransporte({ status: 401, body: 'denied' }),
    });
    expect(r.ok).toBe(false);
    expect(r.codigoErro).toBe('NAO_AUTORIZADO');
    expect(r.mtlsAutenticado).toBe(false);
  });
});
