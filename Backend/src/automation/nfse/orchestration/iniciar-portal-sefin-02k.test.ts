/**
 * API-02K — Portal + SEFIN padrão A1 no Iniciar (offline).
 * Sem Portal/SEFIN/Chromium/rede reais.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decidirMotorIniciar } from './iniciar-motor-routing';
import { decidirIntegracaoNativa, tentarFluxoNativoControlado } from './integration-adapter';
import { exportarSefinParaDownloadsOperacionais } from './exportar-downloads-operacionais';
import { NOME_FLAG_RECUPERACAO_NATIVA } from './feature-flag';
import {
  configAdnIniciarPadrao,
  resetConfigAdnIniciarParaTestes,
  setConfigAdnIniciarParaTestes,
} from '../adn/iniciar-config';
import { decidirAdnIniciar } from '../adn/iniciar-routing';
import { exportarXmlAdnIdempotente } from '../adn/exportar-downloads-operacionais';
import { criarPeriodoConsultaPortal } from '../contracts/periodo';
import { montarInventario } from '../contracts/inventario';
import {
  RepositorioFiscalNfse,
  criarResolvedorRaizInjetada,
} from '../infrastructure';

const CNPJ_A = '19903461000100';
const CNPJ_EXC = '46704878000109';
const CHAVE_E = '11223344556677889900112233445566778899001122334455';
const CHAVE_R = '55443322110099887766554433221100998877665544332211';

describe('API-02K — Roteamento Iniciar Portal+SEFIN', () => {
  beforeEach(() => {
    setConfigAdnIniciarParaTestes(configAdnIniciarPadrao());
  });
  afterEach(() => {
    resetConfigAdnIniciarParaTestes();
  });

  it('A1 → PORTAL_SEFIN (abrirChromium, sem ADN, sem flag)', () => {
    const d = decidirMotorIniciar({
      tipoAutenticacao: 'certificado',
      cnpj: CNPJ_A,
    });
    expect(d).toMatchObject({
      motor: 'PORTAL_SEFIN',
      executarPortalSefin: true,
      executarAdn: false,
      abrirChromium: true,
      situacao: 'PORTAL_SEFIN_PADRAO_A1',
    });
  });

  it('credenciais → PLAYWRIGHT legado', () => {
    const d = decidirMotorIniciar({
      tipoAutenticacao: 'credenciais',
      cnpj: CNPJ_A,
    });
    expect(d.motor).toBe('PLAYWRIGHT');
    expect(d.executarPortalSefin).toBe(false);
    expect(d.executarAdn).toBe(false);
  });

  it('exceção Playwright por empresa → PLAYWRIGHT', () => {
    setConfigAdnIniciarParaTestes({
      ...configAdnIniciarPadrao(),
      playwrightExcecaoCnpjs: [CNPJ_EXC],
    });
    const d = decidirMotorIniciar({
      tipoAutenticacao: 'certificado',
      cnpj: CNPJ_EXC,
    });
    expect(d.motor).toBe('PLAYWRIGHT');
    expect(d.situacao).toBe('LEGADO_EXCECAO_PLAYWRIGHT');
  });

  it('ADN só com autorização explícita (complementar)', () => {
    const d = decidirMotorIniciar({
      tipoAutenticacao: 'certificado',
      cnpj: CNPJ_A,
      autorizacaoAdnIniciar: { ativa: true, cnpj: CNPJ_A },
    });
    expect(d.motor).toBe('ADN');
    expect(d.executarAdn).toBe(true);
    expect(d.executarPortalSefin).toBe(false);
  });

  it('decidirAdnIniciar não ativa ADN automaticamente', () => {
    setConfigAdnIniciarParaTestes({
      ...configAdnIniciarPadrao(),
      adnPadraoA1: true,
    });
    const d = decidirAdnIniciar({
      tipoAutenticacao: 'certificado',
      cnpj: CNPJ_A,
      env: {},
    });
    expect(d.executarAdn).toBe(false);
  });
});

describe('API-02K — Integração nativa produto (sem flag)', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-sefin-02k-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('modoProdutoPortalSefin ativa nativo sem flag/autorização', () => {
    const page = { url: () => 'https://www.nfse.gov.br/' } as never;
    const d = decidirIntegracaoNativa({
      page,
      cnpj: CNPJ_A,
      dataInicio: '01/09/2026',
      dataFim: '30/09/2026',
      tipo: 'ambas',
      baixarPdf: true,
      execucaoId: 'exec-1',
      tipoAutenticacao: 'certificado',
      env: {},
      modoProdutoPortalSefin: true,
    });
    expect(d.executarNativo).toBe(true);
    expect(d.situacao).toBe('NATIVO_SOLICITADO');
    expect(d.compatibilidadePdf).toBe('PDF_NAO_RECUPERADO');
  });

  it('baixarPdf=true não recusa nativo produto', () => {
    const d = decidirIntegracaoNativa({
      page: {} as never,
      cnpj: CNPJ_A,
      dataInicio: '01/09/2026',
      dataFim: '30/09/2026',
      tipo: 'ambas',
      baixarPdf: true,
      execucaoId: 'exec-1',
      tipoAutenticacao: 'certificado',
      modoProdutoPortalSefin: true,
    });
    expect(d.codigoRecusa).toBeUndefined();
    expect(d.executarNativo).toBe(true);
  });

  it('credenciais + modo produto → NATIVO_RECUSADO', () => {
    const d = decidirIntegracaoNativa({
      page: {} as never,
      cnpj: CNPJ_A,
      dataInicio: '01/09/2026',
      dataFim: '30/09/2026',
      tipo: 'ambas',
      baixarPdf: false,
      execucaoId: 'exec-1',
      tipoAutenticacao: 'credenciais',
      modoProdutoPortalSefin: true,
    });
    expect(d.situacao).toBe('NATIVO_RECUSADO');
  });

  it('exportação SEFIN→downloads: emitidas/recebidas + idempotência', async () => {
    const raizFiscal = path.join(tmp, 'fiscal');
    const downloads = path.join(tmp, 'downloads');
    fs.mkdirSync(path.join(raizFiscal, 'xml'), { recursive: true });
    const periodo = criarPeriodoConsultaPortal('01/09/2026', '30/09/2026');
    const repositorio = new RepositorioFiscalNfse(criarResolvedorRaizInjetada(raizFiscal));

    // Grava XMLs diretamente no layout do XmlStore (sem SEFIN/rede)
    const caminhoE = repositorio.caminhoXml(CNPJ_A, periodo, CHAVE_E);
    const caminhoR = repositorio.caminhoXml(CNPJ_A, periodo, CHAVE_R);
    fs.mkdirSync(path.dirname(caminhoE), { recursive: true });
    fs.mkdirSync(path.dirname(caminhoR), { recursive: true });
    fs.writeFileSync(caminhoE, `<NFSe>${CHAVE_E}</NFSe>`);
    fs.writeFileSync(caminhoR, `<NFSe>${CHAVE_R}</NFSe>`);

    const inv = montarInventario({
      id: 'inv-02k',
      cnpj: CNPJ_A,
      periodoConsulta: periodo,
      completude: 'COMPLETO',
      documentos: [
        {
          chaveNacional: CHAVE_E,
          cnpj: CNPJ_A,
          direcao: 'EMITIDA',
          situacao: 'VIGENTE',
          periodoConsulta: periodo,
          origemClassificacao: 'PORTAL',
          evidencias: [{ origem: 'PORTAL', descricao: 'teste' }],
        },
        {
          chaveNacional: CHAVE_R,
          cnpj: CNPJ_A,
          direcao: 'RECEBIDA',
          situacao: 'VIGENTE',
          periodoConsulta: periodo,
          origemClassificacao: 'PORTAL',
          evidencias: [{ origem: 'PORTAL', descricao: 'teste' }],
        },
      ],
    });

    const aptos = [
      {
        chaveNacional: CHAVE_E,
        direcao: 'EMITIDA' as const,
        situacao: 'VIGENTE' as const,
        caminhoRelativo: caminhoE,
        hashSha256: 'a'.repeat(64),
        tamanhoBytes: 10,
      },
      {
        chaveNacional: CHAVE_R,
        direcao: 'RECEBIDA' as const,
        situacao: 'VIGENTE' as const,
        caminhoRelativo: caminhoR,
        hashSha256: 'b'.repeat(64),
        tamanhoBytes: 10,
      },
    ];

    const exp1 = await exportarSefinParaDownloadsOperacionais({
      inventario: inv,
      documentosAptos: aptos,
      repositorio,
      periodoConsulta: periodo,
      downloadsBasePath: downloads,
      nomeContabilidade: 'Contab Teste',
      mesExecucaoExtenso: 'outubro-2026',
      nomeEmpresa: 'Empresa A',
    });
    expect(exp1.ok).toBe(true);
    expect(exp1.copiados).toBe(2);
    expect(fs.existsSync(path.join(exp1.destinoEmitidas, `${CHAVE_E}.xml`))).toBe(true);
    expect(fs.existsSync(path.join(exp1.destinoRecebidas, `${CHAVE_R}.xml`))).toBe(true);

    const exp2 = await exportarSefinParaDownloadsOperacionais({
      inventario: inv,
      documentosAptos: aptos,
      repositorio,
      periodoConsulta: periodo,
      downloadsBasePath: downloads,
      nomeContabilidade: 'Contab Teste',
      mesExecucaoExtenso: 'outubro-2026',
      nomeEmpresa: 'Empresa A',
    });
    expect(exp2.ok).toBe(true);
    expect(exp2.jaIguais).toBe(2);
    expect(exp2.copiados).toBe(0);
  });

  it('exportação idempotente e conflito preserva origem', async () => {
    const origem = path.join(tmp, 'origem.xml');
    const destino = path.join(tmp, 'dest', 'nota.xml');
    fs.writeFileSync(origem, '<NFSe/>');
    expect(await exportarXmlAdnIdempotente(origem, destino)).toBe('copiado');
    expect(await exportarXmlAdnIdempotente(origem, destino)).toBe('ja_igual');
    fs.writeFileSync(destino, '<outro/>');
    expect(await exportarXmlAdnIdempotente(origem, destino)).toBe('conflito');
    expect(fs.readFileSync(origem, 'utf8')).toBe('<NFSe/>');
  });

  it('caminho piloto sem modo produto e sem flag → legado', async () => {
    const { resultado } = await tentarFluxoNativoControlado({
      page: {} as never,
      cnpj: CNPJ_A,
      dataInicio: '01/09/2026',
      dataFim: '30/09/2026',
      tipo: 'ambas',
      baixarPdf: false,
      execucaoId: 'exec-off',
      tipoAutenticacao: 'certificado',
      env: { [NOME_FLAG_RECUPERACAO_NATIVA]: 'false' },
    });
    expect(resultado).toBeNull();
  });
});

describe('API-02K — ausência de CAPTCHA no caminho A1 nativo', () => {
  it('decisão produto A1 não depende de CAPTCHA', () => {
    const d = decidirMotorIniciar({
      tipoAutenticacao: 'certificado',
      cnpj: CNPJ_A,
    });
    expect(d.motivo.toLowerCase()).not.toContain('captcha');
    expect(d.motor).toBe('PORTAL_SEFIN');
    expect(d.executarPortalSefin).toBe(true);
  });
});
