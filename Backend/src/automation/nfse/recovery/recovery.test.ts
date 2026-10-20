import { gzipSync } from 'node:zlib';
import * as forge from 'node-forge';
import { beforeAll, describe, expect, it } from 'vitest';
import { criarDocumentoFiscal } from '../contracts/documento-fiscal';
import { ContratoNfseError } from '../contracts/erros';
import { montarInventario } from '../contracts/inventario';
import { criarPeriodoConsultaPortal } from '../contracts/periodo';
import { classificarFalhaTransporte, criarTransporteHttpsMtls, montarUrlConsultaSefin } from './sefin-client';
import type { ClienteHttpsMtls } from './sefin-client';
import { recuperarXmlNfse, planejarRecuperacaoSefin } from './recovery-service';
import { ErroRecuperacaoSefin, LIMITES_RECUPERACAO_PADRAO, type CredencialMtls, type TransporteHttpMtls } from './types';

const CNPJ = '12345678000199';
const TOMADOR = '11222333000181';
const OUTRO = '99888777000155';
const SENHA = 'SENHA-QUE-NAO-PODE-VAZAR';
const PERIODO = criarPeriodoConsultaPortal('01/09/2026', '30/09/2026');

function chave(final: number): string {
  return String(final).padStart(50, '4');
}

function xmlNota(opcoes: { chave: string; emitente?: string; tomador?: string; dCompet?: string }): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse">
  <infNFSe Id="NFS${opcoes.chave}">
    <chNFSe>${opcoes.chave}</chNFSe>
    <dCompet>${opcoes.dCompet ?? '2026-08'}</dCompet>
    <emit><CNPJ>${opcoes.emitente ?? CNPJ}</CNPJ></emit>
    <toma><CNPJ>${opcoes.tomador ?? TOMADOR}</CNPJ></toma>
  </infNFSe>
</NFSe>`;
}

function corpoSefin(xml: string): Buffer {
  return Buffer.from(JSON.stringify({ nfseXmlGZipB64: gzipSync(Buffer.from(xml)).toString('base64') }));
}

function pfx(senha: string, notAfter: Date): Buffer {
  const chaves = forge.pki.rsa.generateKeyPair(512);
  const certificado = forge.pki.createCertificate();
  certificado.publicKey = chaves.publicKey;
  certificado.serialNumber = '01';
  certificado.validity.notBefore = new Date('2020-01-01T00:00:00Z');
  certificado.validity.notAfter = notAfter;
  const atributos = [{ name: 'commonName', value: 'teste-local' }];
  certificado.setSubject(atributos);
  certificado.setIssuer(atributos);
  certificado.sign(chaves.privateKey, forge.md.sha256.create());
  const asn1 = forge.pkcs12.toPkcs12Asn1(chaves.privateKey, [certificado], senha);
  return Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary');
}

function pfxComCadeia(senha: string, folhaExpira: Date, caExpira: Date): Buffer {
  const caChaves = forge.pki.rsa.generateKeyPair(512);
  const folhaChaves = forge.pki.rsa.generateKeyPair(512);
  const ca = forge.pki.createCertificate();
  ca.publicKey = caChaves.publicKey;
  ca.serialNumber = '01';
  ca.validity.notBefore = new Date('2020-01-01T00:00:00Z');
  ca.validity.notAfter = caExpira;
  ca.setSubject([{ name: 'commonName', value: 'ca-teste' }]);
  ca.setIssuer([{ name: 'commonName', value: 'ca-teste' }]);
  ca.setExtensions([{ name: 'basicConstraints', cA: true }]);
  ca.sign(caChaves.privateKey, forge.md.sha256.create());

  const folha = forge.pki.createCertificate();
  folha.publicKey = folhaChaves.publicKey;
  folha.serialNumber = '02';
  folha.validity.notBefore = new Date('2020-01-01T00:00:00Z');
  folha.validity.notAfter = folhaExpira;
  folha.setSubject([{ name: 'commonName', value: 'cliente-teste' }]);
  folha.setIssuer([{ name: 'commonName', value: 'ca-teste' }]);
  folha.setExtensions([{ name: 'basicConstraints', cA: false }]);
  folha.sign(caChaves.privateKey, forge.md.sha256.create());

  const asn1 = forge.pkcs12.toPkcs12Asn1(folhaChaves.privateKey, [ca, folha], senha);
  return Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary');
}

function xmlPrefixado(chaveValor: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<nfse:NFSe xmlns:nfse="http://www.sped.fazenda.gov.br/nfse">
  <nfse:infNFSe Id="NFS${chaveValor}">
    <nfse:chNFSe>${chaveValor}</nfse:chNFSe>
    <nfse:dCompet>2026-08</nfse:dCompet>
    <nfse:emit><nfse:CNPJ>${CNPJ}</nfse:CNPJ></nfse:emit>
    <nfse:toma><nfse:CNPJ>${TOMADOR}</nfse:CNPJ></nfse:toma>
  </nfse:infNFSe>
</nfse:NFSe>`;
}

function xmlComIntermediario(chaveValor: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse">
  <infNFSe>
    <chNFSe>${chaveValor}</chNFSe>
    <dCompet>2026-01</dCompet>
    <interm>
      <CNPJ>${CNPJ}</CNPJ>
      <emit><CNPJ>${CNPJ}</CNPJ></emit>
    </interm>
    <emit><CNPJ>${OUTRO}</CNPJ></emit>
    <toma><CNPJ>${TOMADOR}</CNPJ></toma>
  </infNFSe>
</NFSe>`;
}

function xmlPrestador(chaveValor: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse">
  <infNFSe>
    <chNFSe>${chaveValor}</chNFSe>
    <prestador><CNPJ>${CNPJ}</CNPJ></prestador>
    <tomador><CNPJ>${TOMADOR}</CNPJ></tomador>
  </infNFSe>
</NFSe>`;
}

function clienteHttpsFalso(modo: 'construtor' | 'pedido' | 'timeout' | 'socket' | 'corpo' | 'tamanho' | 'ok'): {
  cliente: ClienteHttpsMtls;
  destruido: () => boolean;
  pedidos: () => number;
  opcoesAgente: () => { rejectUnauthorized?: boolean; keepAlive?: boolean; minVersion?: string; maxVersion?: string; passphrase?: string; pfx?: Buffer };
  opcoesPedido: () => { rejectUnauthorized?: boolean; agent?: unknown };
} {
  let destruido = false;
  let pedidos = 0;
  let opcoesAgente: { rejectUnauthorized?: boolean; keepAlive?: boolean; minVersion?: string; maxVersion?: string; passphrase?: string; pfx?: Buffer } = {};
  let opcoesPedido: { rejectUnauthorized?: boolean; agent?: unknown } = {};
  const cliente: ClienteHttpsMtls = {
    Agent: class {
      constructor(opcoes: {
        rejectUnauthorized?: boolean;
        keepAlive?: boolean;
        minVersion?: string;
        maxVersion?: string;
        passphrase?: string;
        pfx?: Buffer;
      }) {
        opcoesAgente = opcoes;
        if (modo === 'construtor') throw new Error(`falha ao criar agente ${SENHA}`);
      }
      destroy() {
        destruido = true;
      }
    },
    request(opcoes, callback) {
      pedidos += 1;
      opcoesPedido = opcoes;
      if (modo === 'pedido') throw new Error(`ECONNRESET ${SENHA}`);
      const ouvintes: Record<string, Array<(valor?: unknown) => void>> = {};
      return {
        on(evento, ouvinte) {
          (ouvintes[evento] ??= []).push(ouvinte);
        },
        destroy(erro) {
          for (const ouvinte of ouvintes.error ?? []) ouvinte(erro);
        },
        end() {
          if (modo === 'timeout') {
            for (const ouvinte of ouvintes.timeout ?? []) ouvinte();
            return;
          }
          if (modo === 'socket') {
            for (const ouvinte of ouvintes.error ?? []) {
              ouvinte(Object.assign(new Error(`socket hang up ${SENHA}`), { code: 'ECONNRESET' }));
            }
            return;
          }
          const respostaOuvintes: Record<string, Array<(valor?: unknown) => void>> = {};
          callback({
            statusCode: 200,
            headers: modo === 'tamanho' ? { 'content-length': '999999' } : {},
            destroy() {},
            on(evento, ouvinte) {
              (respostaOuvintes[evento] ??= []).push(ouvinte);
            },
          });
          if (modo === 'corpo') {
            for (const ouvinte of respostaOuvintes.data ?? []) ouvinte(Buffer.alloc(80, 1));
          }
          if (modo === 'ok') {
            for (const ouvinte of respostaOuvintes.end ?? []) ouvinte();
          }
        },
      };
    },
  };
  return {
    cliente,
    destruido: () => destruido,
    pedidos: () => pedidos,
    opcoesAgente: () => opcoesAgente,
    opcoesPedido: () => opcoesPedido,
  };
}

function transporteDe(status: number, body: Buffer): { transporte: TransporteHttpMtls; chamadas: string[] } {
  const chamadas: string[] = [];
  return {
    chamadas,
    transporte: {
      async consultar(url) {
        chamadas.push(url.href);
        return { status, body };
      },
    },
  };
}

describe('recuperação SEFIN', () => {
  let credencial: CredencialMtls;

  beforeAll(() => {
    credencial = { pfx: pfx(SENHA, new Date('2035-01-01T00:00:00Z')), senha: SENHA };
  });

  async function consultar(
    parcial: Partial<Parameters<typeof recuperarXmlNfse>[0]> & { body?: Buffer; status?: number } = {}
  ) {
    const { body, status, transporte, ...entrada } = parcial;
    const simulado = transporteDe(status ?? 200, body ?? corpoSefin(xmlNota({ chave: chave(1) })));
    const registros: string[] = [];
    const resultado = await recuperarXmlNfse({
      chave: chave(1),
      cnpj: CNPJ,
      direcao: 'EMITIDA',
      credencial,
      transporte: transporte ?? simulado.transporte,
      periodoConsulta: PERIODO,
      log: {
        info(dados, mensagem) {
          registros.push(JSON.stringify(dados) + mensagem);
        },
        warn(dados, mensagem) {
          registros.push(JSON.stringify(dados) + mensagem);
        },
      },
      ...entrada,
    });
    return { resultado, chamadas: simulado.chamadas, registros };
  }

  it('recupera XML de chave nacional válida', async () => {
    const { resultado, chamadas } = await consultar();
    expect(resultado.resultado).toBe('RECUPERADO');
    expect(resultado.validacaoXml).toBe('CONFIRMADA');
    expect(resultado.xml).toContain('<chNFSe>');
    expect(chamadas[0]).toBe(`https://sefin.nfse.gov.br/SefinNacional/nfse/${chave(1)}`);
  });

  it('rejeita chave de 44 dígitos', async () => {
    await expect(consultar({ chave: '1'.repeat(44) })).rejects.toThrow(ContratoNfseError);
  });

  it('rejeita chave com letras, vazia ou com espaço', async () => {
    await expect(consultar({ chave: `${'A'.repeat(50)}` })).rejects.toThrow(ContratoNfseError);
    await expect(consultar({ chave: '' })).rejects.toThrow(ContratoNfseError);
    await expect(consultar({ chave: `${chave(1)} ` })).rejects.toThrow(ContratoNfseError);
  });

  it('rejeita CNPJ inválido', async () => {
    await expect(consultar({ cnpj: '123' })).rejects.toThrow(/CNPJ/);
  });

  it('interpreta HTTP 200 com nfseXmlGZipB64', async () => {
    const { resultado } = await consultar();
    expect(resultado.hashSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(resultado.chaveNacional).toBe(chave(1));
  });

  it('recusa HTTP 200 sem nfseXmlGZipB64', async () => {
    const { resultado } = await consultar({ body: Buffer.from('{"ok":true}') });
    expect(resultado.codigo).toBe('CAMPO_XML_AUSENTE');
    expect(resultado.xml).toBeNull();
  });

  it('recusa JSON inválido', async () => {
    const { resultado } = await consultar({ body: Buffer.from('nao-json') });
    expect(resultado.codigo).toBe('JSON_INVALIDO');
  });

  it('recusa Base64 inválido', async () => {
    const { resultado } = await consultar({ body: Buffer.from('{"nfseXmlGZipB64":"***"}') });
    expect(resultado.codigo).toBe('BASE64_INVALIDO');
  });

  it('recusa GZIP corrompido', async () => {
    const bruto = Buffer.concat([Buffer.from([0x1f, 0x8b]), Buffer.from('quebrado')]).toString('base64');
    const { resultado } = await consultar({ body: Buffer.from(JSON.stringify({ nfseXmlGZipB64: bruto })) });
    expect(resultado.codigo).toBe('GZIP_INVALIDO');
  });

  it('recusa XML vazio e XML malformado', async () => {
    const vazio = await consultar({ body: corpoSefin('   ') });
    const quebrado = await consultar({ body: corpoSefin('<NFSe><infNFSe></NFSe>') });
    expect(vazio.resultado.codigo).toBe('XML_VAZIO');
    expect(quebrado.resultado.codigo).toBe('XML_MALFORMADO');
  });

  it('recusa HTML no lugar de XML', async () => {
    const { resultado } = await consultar({ body: Buffer.from('<html><body>erro</body></html>') });
    expect(resultado.codigo).toBe('HTML_NO_LUGAR_DE_XML');
    expect(resultado.xml).toBeNull();
  });

  it('recusa XML de outra chave e de outro CNPJ', async () => {
    const outraChave = await consultar({ body: corpoSefin(xmlNota({ chave: chave(99) })) });
    const outroCnpj = await consultar({ body: corpoSefin(xmlNota({ chave: chave(1), emitente: OUTRO })) });
    expect(outraChave.resultado.codigo).toBe('CHAVE_DIVERGENTE');
    expect(outroCnpj.resultado.codigo).toBe('CNPJ_DIVERGENTE');
    expect(outraChave.resultado.xml).toBeNull();
  });

  it('confirma nota emitida pelo CNPJ do emitente', async () => {
    const { resultado } = await consultar({ direcao: 'EMITIDA' });
    expect(resultado.resultado).toBe('RECUPERADO');
    expect(resultado.direcao).toBe('EMITIDA');
  });

  it('confirma nota recebida pelo CNPJ do tomador', async () => {
    const { resultado } = await consultar({
      direcao: 'RECEBIDA',
      cnpj: TOMADOR,
      body: corpoSefin(xmlNota({ chave: chave(1), emitente: OUTRO, tomador: TOMADOR })),
    });
    expect(resultado.resultado).toBe('RECUPERADO');
    expect(resultado.direcao).toBe('RECEBIDA');
  });

  it('reconhece XML com namespace padrão e com prefixo', async () => {
    const padrao = await consultar();
    expect(padrao.resultado.resultado).toBe('RECUPERADO');
    expect(padrao.resultado.chaveNacional).toBe(chave(1));
    expect(chave(1)).toHaveLength(50);
    expect(padrao.resultado.xml).toContain('xmlns="http://www.sped.fazenda.gov.br/nfse"');

    const prefixado = await consultar({ body: corpoSefin(xmlPrefixado(chave(1))) });
    expect(prefixado.resultado.resultado).toBe('RECUPERADO');
    expect(prefixado.resultado.chaveNacional).toHaveLength(50);
    expect(prefixado.resultado.xml).toContain(`<nfse:chNFSe>${chave(1)}</nfse:chNFSe>`);
  });

  it('rejeita CNPJ de intermediário e de emitente aninhado', async () => {
    const xml = corpoSefin(xmlComIntermediario(chave(1)));
    const emitida = await consultar({ body: xml, direcao: 'EMITIDA', cnpj: CNPJ });
    const recebida = await consultar({ body: xml, direcao: 'RECEBIDA', cnpj: CNPJ });
    const emitenteReal = await consultar({ body: xml, direcao: 'EMITIDA', cnpj: OUTRO });
    const tomadorReal = await consultar({ body: xml, direcao: 'RECEBIDA', cnpj: TOMADOR });
    expect(emitida.resultado.codigo).toBe('CNPJ_DIVERGENTE');
    expect(recebida.resultado.codigo).toBe('CNPJ_DIVERGENTE');
    expect(emitenteReal.resultado.resultado).toBe('RECUPERADO');
    expect(tomadorReal.resultado.resultado).toBe('RECUPERADO');
    expect(tomadorReal.resultado.dCompet).toBe('2026-01');
    expect(tomadorReal.resultado.periodoConsulta).toEqual(PERIODO);
  });

  it('confirma emitida pelo prestador e recebida pelo tomador', async () => {
    const xml = corpoSefin(xmlPrestador(chave(1)));
    const emitida = await consultar({ body: xml, direcao: 'EMITIDA', cnpj: CNPJ });
    const recebida = await consultar({ body: xml, direcao: 'RECEBIDA', cnpj: TOMADOR });
    const recebidaPeloEmitente = await consultar({ body: xml, direcao: 'RECEBIDA', cnpj: CNPJ });
    expect(emitida.resultado.resultado).toBe('RECUPERADO');
    expect(recebida.resultado.resultado).toBe('RECUPERADO');
    expect(recebidaPeloEmitente.resultado.codigo).toBe('CNPJ_DIVERGENTE');
  });

  it('preserva o período consultado quando dCompet é de outro mês', async () => {
    const { resultado } = await consultar({
      body: corpoSefin(xmlNota({ chave: chave(1), dCompet: '2026-08' })),
    });
    expect(resultado.resultado).toBe('RECUPERADO');
    expect(resultado.dCompet).toBe('2026-08');
    expect(resultado.periodoConsulta).toEqual(PERIODO);
  });

  it('bloqueia certificado indisponível, senha incorreta e certificado expirado', async () => {
    const indisponivel = await consultar({ credencial: null });
    const senha = await consultar({ credencial: { pfx: credencial.pfx, senha: 'outra-senha' } });
    const expirado = await consultar({
      credencial: { pfx: pfx(SENHA, new Date('2020-02-01T00:00:00Z')), senha: SENHA },
    });
    expect(indisponivel.resultado.codigo).toBe('CERTIFICADO_INDISPONIVEL');
    expect(indisponivel.chamadas).toHaveLength(0);
    expect(senha.resultado.codigo).toBe('SENHA_INVALIDA');
    expect(senha.resultado.mensagem).not.toContain('outra-senha');
    expect(senha.resultado.mensagem).not.toContain(SENHA);
    expect(senha.chamadas).toHaveLength(0);
    expect(expirado.resultado.codigo).toBe('CERTIFICADO_EXPIRADO');
    expect(expirado.resultado.mensagem).not.toContain(SENHA);
    expect(expirado.chamadas).toHaveLength(0);
  });

  it('prefere o certificado de cliente quando a CA intermediária vem primeiro', async () => {
    const folhaVencida = await consultar({
      credencial: {
        pfx: pfxComCadeia(SENHA, new Date('2020-02-01T00:00:00Z'), new Date('2035-01-01T00:00:00Z')),
        senha: SENHA,
      },
    });
    expect(folhaVencida.resultado.codigo).toBe('CERTIFICADO_EXPIRADO');
    expect(folhaVencida.chamadas).toHaveLength(0);
    expect(folhaVencida.resultado.mensagem).not.toContain(SENHA);

    const caVencida = await consultar({
      credencial: {
        pfx: pfxComCadeia(SENHA, new Date('2035-01-01T00:00:00Z'), new Date('2020-02-01T00:00:00Z')),
        senha: SENHA,
      },
    });
    expect(caVencida.resultado.resultado).toBe('RECUPERADO');
    expect(caVencida.chamadas).toHaveLength(1);
    expect(caVencida.resultado.mensagem).not.toContain(SENHA);
  });

  it('libera o agente quando a criação ou o transporte falha sem rede', async () => {
    const url = montarUrlConsultaSefin(chave(1));
    const limites = { ...LIMITES_RECUPERACAO_PADRAO, maxBytesResposta: 20 };
    const cenarios = ['construtor', 'pedido', 'timeout', 'socket', 'corpo', 'tamanho', 'ok'] as const;
    const codigos = {
      construtor: 'FALHA_CONEXAO',
      pedido: 'FALHA_CONEXAO',
      timeout: 'TIMEOUT',
      socket: 'FALHA_CONEXAO',
      corpo: 'LIMITE_RESPOSTA',
      tamanho: 'LIMITE_RESPOSTA',
      ok: null,
    } as const;

    for (const modo of cenarios) {
      const falso = clienteHttpsFalso(modo);
      let falha: unknown;
      let resposta: { status: number } | null = null;
      try {
        resposta = await criarTransporteHttpsMtls(falso.cliente).consultar(url, credencial, limites);
      } catch (erro) {
        falha = erro;
      }
      if (modo === 'ok') {
        expect(falha).toBeUndefined();
        expect(resposta?.status).toBe(200);
      } else {
        expect(falha).toBeInstanceOf(ErroRecuperacaoSefin);
        expect((falha as ErroRecuperacaoSefin).codigo).toBe(codigos[modo]);
        expect((falha as ErroRecuperacaoSefin).message).not.toContain(SENHA);
      }
      expect(falso.pedidos()).toBe(modo === 'construtor' ? 0 : 1);
      expect(falso.destruido()).toBe(modo !== 'construtor');
      if (modo === 'ok') {
        expect(falso.opcoesAgente()).toMatchObject({
          rejectUnauthorized: true,
          keepAlive: false,
          minVersion: 'TLSv1.2',
          maxVersion: 'TLSv1.3',
          passphrase: SENHA,
          pfx: credencial.pfx,
        });
        expect(falso.opcoesPedido().rejectUnauthorized).toBe(true);
        expect(falso.opcoesPedido().agent).toBeDefined();
      }
    }
  });

  it('classifica handshake e timeout sem consultar outro host', async () => {
    const handshake = await consultar({
      transporte: {
        async consultar() {
          throw new Error('UNABLE_TO_VERIFY_LEAF_SIGNATURE');
        },
      },
    });
    const timeout = await consultar({
      transporte: {
        async consultar() {
          throw Object.assign(new Error('tempo'), { code: 'ETIMEDOUT' });
        },
      },
    });
    expect(handshake.resultado.codigo).toBe('HANDSHAKE_TLS');
    expect(handshake.resultado.classeErro).toBe('BLOQUEANTE');
    expect(timeout.resultado.codigo).toBe('TIMEOUT');
    expect(timeout.resultado.classeErro).toBe('TRANSITORIO');
    expect(classificarFalhaTransporte(new Error('ECONNRESET')).codigo).toBe('FALHA_CONEXAO');
  });

  it('classifica HTTP 401, 403, 404, 429 e 500', async () => {
    const codigos = [401, 403, 404, 429, 500];
    const respostas = await Promise.all(codigos.map((status) => consultar({ status, body: Buffer.from('{}') })));
    expect(respostas.map((item) => item.resultado.codigo)).toEqual([
      'HTTP_401',
      'HTTP_403',
      'HTTP_404',
      'HTTP_429',
      'HTTP_500',
    ]);
    expect(respostas[0].resultado.classeErro).toBe('BLOQUEANTE');
    expect(respostas[3].resultado.classeErro).toBe('TRANSITORIO');
    expect(respostas[4].resultado.classeErro).toBe('TRANSITORIO');
  });

  it('interrompe resposta e XML acima do limite', async () => {
    const resposta = await consultar({
      body: Buffer.alloc(80, 1),
      limites: { maxBytesResposta: 20 },
    });
    const grande = gzipSync(Buffer.alloc(300, 65)).toString('base64');
    const xml = await consultar({
      body: Buffer.from(JSON.stringify({ nfseXmlGZipB64: grande })),
      limites: { maxBytesXml: 40 },
    });
    expect(resposta.resultado.codigo).toBe('LIMITE_RESPOSTA');
    expect(xml.resultado.codigo).toBe('LIMITE_XML');
    expect(xml.resultado.xml).toBeNull();
  });

  it('não grava segredo em log e não chama a SEFIN real', async () => {
    const { registros, chamadas, resultado } = await consultar();
    const texto = registros.join('\n');
    expect(texto).not.toContain(SENHA);
    expect(texto).not.toContain('MARCADOR');
    expect(texto).not.toContain('<NFSe');
    expect(resultado.xml).toContain('infNFSe');
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].startsWith('https://sefin.nfse.gov.br/')).toBe(true);
    expect(() => montarUrlConsultaSefin(chave(1), 'https://exemplo.invalid/SefinNacional')).toThrow(
      /sefin\.nfse\.gov\.br/
    );
  });
});

describe('plano de recuperação', () => {
  function documento(final: number, situacao: 'VIGENTE' | 'CANCELADA' | 'INDETERMINADA', direcao: 'EMITIDA' | 'RECEBIDA' = 'EMITIDA') {
    return criarDocumentoFiscal({
      chaveNacional: chave(final),
      cnpj: CNPJ,
      direcao,
      situacao,
      periodoConsulta: PERIODO,
      origemClassificacao: 'PORTAL',
    });
  }

  it('exclui cancelada, bloqueia indeterminada e inventário incompleto', () => {
    const misto = montarInventario({
      id: 'misto',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      completude: 'COMPLETO',
      documentos: [documento(1, 'VIGENTE'), documento(2, 'CANCELADA')],
    });
    const plano = planejarRecuperacaoSefin(misto);
    expect(plano.podeIniciar).toBe(true);
    expect(plano.elegiveis.map((item) => item.chaveNacional)).toEqual([chave(1)]);
    expect(plano.excluidas).toEqual([chave(2)]);

    const indeterminado = montarInventario({
      id: 'ind',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      completude: 'COMPLETO',
      documentos: [documento(3, 'VIGENTE'), documento(4, 'INDETERMINADA', 'RECEBIDA')],
    });
    expect(planejarRecuperacaoSefin(indeterminado).podeIniciar).toBe(false);
    expect(planejarRecuperacaoSefin(indeterminado).codigo).toBe('SITUACAO_INDETERMINADA');

    const incompleto = montarInventario({
      id: 'parcial',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      completude: 'PARCIAL',
      documentos: [documento(5, 'VIGENTE')],
    });
    expect(planejarRecuperacaoSefin(incompleto).codigo).toBe('DESCOBERTA_INCOMPLETA');
  });

  it('gera plano para inventário válido', () => {
    const inventario = montarInventario({
      id: 'ok',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      completude: 'COMPLETO',
      documentos: [documento(7, 'VIGENTE'), documento(8, 'VIGENTE', 'RECEBIDA')],
    });
    const plano = planejarRecuperacaoSefin(inventario);
    expect(plano.podeIniciar).toBe(true);
    expect(plano.elegiveis).toHaveLength(2);
    expect(plano.excluidas).toEqual([]);
  });
});
