import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as forge from 'node-forge';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  criarDocumentoFiscal,
  type DirecaoDocumentoFiscal,
  type SituacaoDocumentoFiscal,
} from '../contracts/documento-fiscal';
import { montarInventario, type InventarioNfse } from '../contracts/inventario';
import { criarPeriodoConsultaPortal, type PeriodoConsultaPortal } from '../contracts/periodo';
import { inspecionarCredencialMtls } from '../recovery/mtls-provider';
import type { CredencialMtls } from '../recovery/types';
import {
  AdaptadorCertificadoA1,
  RepositorioFiscalNfse,
  calcularSnapshotId,
  criarFonteA1DoCadastro,
  criarProvedorA1DoCadastro,
  criarResolvedorRaizInjetada,
  listarSnapshotsAuditoria,
  mascararChaveNacional,
  montarAuditoriaFiscal,
  obterAuditoriaMaisRecente,
  persistirAuditoriaFiscal,
  raizFiscalDistintaDeDownloads,
  InfraestruturaNfseError,
} from './index';

const CNPJ = '12345678000199';
const OUTRO = '99888777000166';
const TOMADOR = '11222333000181';
const SENHA = 'SENHA-QUE-NAO-PODE-VAZAR';
const PERIODO = criarPeriodoConsultaPortal('01/09/2026', '30/09/2026');
const OUTRO_PERIODO = criarPeriodoConsultaPortal('01/10/2026', '31/10/2026');

let raiz: string;
let repositorio: RepositorioFiscalNfse;

beforeEach(async () => {
  raiz = await mkdtemp(path.join(tmpdir(), 'nfse-infra-'));
  repositorio = new RepositorioFiscalNfse(criarResolvedorRaizInjetada(raiz));
});

afterEach(async () => {
  await rm(raiz, { recursive: true, force: true });
});

describe('infraestrutura fiscal nativa', () => {
  it('01 carrega certificado por CNPJ sob demanda', async () => {
    let chamadas = 0;
    const pfxBuffer = pfxValido();
    const adaptador = new AdaptadorCertificadoA1({
      async carregar(cnpj) {
        chamadas += 1;
        expect(cnpj).toBe(CNPJ);
        return { pfx: pfxBuffer, passphrase: SENHA };
      },
    });

    expect(chamadas).toBe(0);
    const credencial = await adaptador.obter(CNPJ);
    expect(chamadas).toBe(1);
    expect(credencial.pfx.equals(pfxBuffer)).toBe(true);
    expect(credencial.pfx).not.toBe(pfxBuffer);
    expect(credencial.senha).toBe(SENHA);
    expect(() => inspecionarCredencialMtls(credencial)).not.toThrow();
  });

  it('02 CNPJ inválido é recusado', async () => {
    const adaptador = new AdaptadorCertificadoA1({
      async carregar() {
        throw new Error('não deveria carregar');
      },
    });
    await expect(adaptador.obter('123')).rejects.toMatchObject({ codigo: 'CNPJ_INVALIDO' });
  });

  it('03 certificado inexistente', async () => {
    const adaptador = new AdaptadorCertificadoA1({
      async carregar() {
        throw new Error('Certificado não encontrado para CNPJ 12345678000199');
      },
    });
    await expect(adaptador.obter(CNPJ)).rejects.toMatchObject({ codigo: 'CERTIFICADO_INEXISTENTE' });
  });

  it('04 erro de leitura do arquivo', async () => {
    const adaptador = new AdaptadorCertificadoA1({
      async carregar() {
        throw new Error('Falha ao baixar certificado: Arquivo não encontrado');
      },
    });
    await expect(adaptador.obter(CNPJ)).rejects.toMatchObject({ codigo: 'CERTIFICADO_INACESSIVEL' });
  });

  it('05 erro de descriptografia', async () => {
    const adaptador = new AdaptadorCertificadoA1({
      async carregar() {
        throw new Error('Falha ao descriptografar senha. Verifique CRYPTO_KEY');
      },
    });
    await expect(adaptador.obter(CNPJ)).rejects.toMatchObject({ codigo: 'ERRO_DESCRIPTOGRAFIA' });
  });

  it('06 senha indisponível', async () => {
    const adaptador = new AdaptadorCertificadoA1({
      async carregar() {
        throw new Error('Certificado para CNPJ x não possui senha armazenada. Reimporte');
      },
    });
    await expect(adaptador.obter(CNPJ)).rejects.toMatchObject({ codigo: 'SENHA_INDISPONIVEL' });
  });

  it('07 credencial entrega o formato do módulo recovery', async () => {
    const provedor = criarProvedorA1DoCadastro(async () => ({ pfx: pfxValido(), passphrase: SENHA }));
    const credencial: CredencialMtls = await provedor.obter(CNPJ);
    expect(Buffer.isBuffer(credencial.pfx)).toBe(true);
    expect(typeof credencial.senha).toBe('string');
    expect(Object.keys(credencial).sort()).toEqual(['pfx', 'senha']);
  });

  it('08 erros e fonte não expõem senha nem PFX', async () => {
    const adaptador = new AdaptadorCertificadoA1({
      async carregar() {
        throw new Error(`Falha com ${SENHA} no meio`);
      },
    });
    try {
      await adaptador.obter(CNPJ);
      expect.unreachable();
    } catch (erro) {
      expect(erro).toBeInstanceOf(InfraestruturaNfseError);
      expect(String(erro)).not.toContain(SENHA);
      expect(JSON.stringify(erro)).not.toContain(SENHA);
    }
  });

  it('09 carregamento apenas sob demanda', async () => {
    let chamadas = 0;
    const fonte = criarFonteA1DoCadastro(async () => {
      chamadas += 1;
      return { pfx: pfxValido(), passphrase: SENHA };
    });
    expect(chamadas).toBe(0);
    await fonte.carregar(CNPJ);
    expect(chamadas).toBe(1);
    await fonte.carregar(CNPJ);
    expect(chamadas).toBe(2);
  });

  it('10 importação do módulo não lê certificado', async () => {
    const diretorio = path.dirname(fileURLToPath(import.meta.url));
    const fontes = (await import('node:fs/promises')).readdir;
    const nomes = (await fontes(diretorio)).filter((n) => n.endsWith('.ts') && !n.endsWith('.test.ts'));
    for (const nome of nomes) {
      const texto = await readFile(path.join(diretorio, nome), 'utf8');
      expect(texto).not.toMatch(/carregarCertificadoPorCnpj\(/);
      if (nome === 'a1-adapter.ts') {
        expect(texto).toMatch(/await import\('..\/..\/..\/services\/certificate-loader'\)/);
      } else {
        expect(texto).not.toMatch(/certificate-loader/);
      }
    }
  });

  it('11 resolve raiz fiscal injetada', () => {
    const resolvedor = criarResolvedorRaizInjetada(raiz);
    expect(resolvedor.raiz()).toBe(path.resolve(raiz));
    expect(resolvedor.raizCheckpoints()).toBe(path.join(path.resolve(raiz), 'checkpoints'));
    expect(resolvedor.raizXml()).toBe(path.join(path.resolve(raiz), 'xml'));
    expect(resolvedor.raizAuditoria()).toBe(path.join(path.resolve(raiz), 'auditoria'));
  });

  it('12 empresa isolada no armazenamento', async () => {
    const invA = inventario([documento(chave(1))]);
    const invB = inventario([documento(chave(1), { cnpj: OUTRO })], 'COMPLETO', OUTRO);
    await repositorio.criarCheckpoint(invA, 'exec-a');
    await repositorio.criarCheckpoint(invB, 'exec-b');
    expect(existsSync(path.join(raiz, 'checkpoints', CNPJ))).toBe(true);
    expect(existsSync(path.join(raiz, 'checkpoints', OUTRO))).toBe(true);
    expect(path.join(raiz, 'checkpoints', CNPJ)).not.toBe(path.join(raiz, 'checkpoints', OUTRO));
  });

  it('13 período isolado no armazenamento', async () => {
    const invA = inventario([documento(chave(1))]);
    const invB = inventario([documento(chave(1), { periodo: OUTRO_PERIODO })], 'COMPLETO', CNPJ, OUTRO_PERIODO);
    await repositorio.criarCheckpoint(invA, 'exec-p1');
    await repositorio.criarCheckpoint(invB, 'exec-p2');
    const pastaA = criarResolvedorRaizInjetada(raiz).diretorioPeriodo(CNPJ, PERIODO);
    const pastaB = criarResolvedorRaizInjetada(raiz).diretorioPeriodo(CNPJ, OUTRO_PERIODO);
    expect(pastaA).not.toBe(pastaB);
  });

  it('14 reutiliza checkpoint do Commit 05', async () => {
    const inv = inventario([documento(chave(1))]);
    const primeiro = await repositorio.criarCheckpoint(inv, 'exec-orig');
    const segundo = await repositorio.criarCheckpoint(inv, 'exec-nova');
    expect(segundo.execucaoId).toBe('exec-orig');
    expect(segundo.fingerprintInventario).toBe(primeiro.fingerprintInventario);
  });

  it('15 XML íntegro persiste com hash', async () => {
    const inv = inventario([documento(chave(1))]);
    const xml = xmlFiscal(chave(1));
    await repositorio.criarCheckpoint(inv, 'exec-xml');
    const checkpoint = await repositorio.persistirXml(inv, chave(1), xml);
    const doc = checkpoint.documentos[0];
    expect(doc.estado).toBe('PERSISTIDO');
    expect(doc.hashSha256).toBe(createHash('sha256').update(xml, 'utf8').digest('hex'));
  });

  it('16 XML ausente não entra na exportação', async () => {
    const inv = inventario([documento(chave(1))]);
    await repositorio.criarCheckpoint(inv, 'exec-ausente');
    const lista = await repositorio.listarDocumentosExportaveis(inv);
    expect(lista.aptos).toEqual([]);
  });

  it('17 XML corrompido não é exportável', async () => {
    const inv = inventario([documento(chave(1))]);
    const xml = xmlFiscal(chave(1));
    await repositorio.criarCheckpoint(inv, 'exec-corr');
    await repositorio.persistirXml(inv, chave(1), xml);
    await writeFile(repositorio.caminhoXml(CNPJ, PERIODO, chave(1)), 'xxxx');
    const lista = await repositorio.listarDocumentosExportaveis(inv);
    expect(lista.aptos).toEqual([]);
  });

  it('18 conflito de hash não sobrescreve', async () => {
    const inv = inventario([documento(chave(1))]);
    await repositorio.criarCheckpoint(inv, 'exec-conflito');
    await repositorio.persistirXml(inv, chave(1), xmlFiscal(chave(1), { dCompet: '2026-01' }));
    await expect(
      repositorio.persistirXml(inv, chave(1), xmlFiscal(chave(1), { dCompet: '2026-02' }))
    ).rejects.toMatchObject({ codigo: 'CONFLITO_HASH' });
  });

  it('19 idempotência da persistência', async () => {
    const inv = inventario([documento(chave(1))]);
    const xml = xmlFiscal(chave(1));
    await repositorio.criarCheckpoint(inv, 'exec-idemp');
    await repositorio.persistirXml(inv, chave(1), xml);
    await repositorio.persistirXml(inv, chave(1), xml);
    const arquivos = await repositorio.verificarArquivos(inv);
    expect(arquivos).toHaveLength(1);
    expect(arquivos[0].existe).toBe(true);
  });

  it('20 caminho inválido na raiz', () => {
    expect(() => criarResolvedorRaizInjetada('')).toThrow(InfraestruturaNfseError);
    expect(() => criarResolvedorRaizInjetada('')).toThrow(expect.objectContaining({ codigo: 'RAIZ_INVALIDA' }));
  });

  it('21 path traversal é recusado', () => {
    const resolvedor = criarResolvedorRaizInjetada(raiz);
    expect(() => resolvedor.diretorioPeriodo('../', PERIODO)).toThrow();
    expect(() =>
      resolvedor.diretorioPeriodo(CNPJ, { tipo: 'PERIODO_CONSULTA_PORTAL', inicio: '../01/2026', fim: '30/09/2026' })
    ).toThrow();
  });

  it('22 falha de escrita não publica XML', async () => {
    const resolvedor = criarResolvedorRaizInjetada(raiz);
    const xmlStore = new (await import('../checkpoint')).XmlStore(resolvedor.raizXml(), {
      antesDaEscrita: () => {
        throw new Error('disco');
      },
    });
    const local = new (await import('../checkpoint')).CheckpointService(
      new (await import('../checkpoint')).CheckpointStore(resolvedor.raizCheckpoints()),
      xmlStore
    );
    const inv = inventario([documento(chave(1))]);
    await local.criarCheckpoint(inv, 'exec-disco');
    await expect(local.persistirXml(inv, chave(1), xmlFiscal(chave(1)))).rejects.toMatchObject({
      codigo: 'FALHA_ESCRITA',
    });
    expect(existsSync(path.join(raiz, 'xml', CNPJ))).toBe(false);
  });

  it('23 arquivo legado fora da raiz fiscal permanece intacto', async () => {
    const legado = path.join(raiz, '..', `legado-${path.basename(raiz)}.bin`);
    await writeFile(legado, 'conteudo-legado');
    try {
      const inv = inventario([documento(chave(1))]);
      await repositorio.criarCheckpoint(inv, 'exec-legado');
      await repositorio.persistirXml(inv, chave(1), xmlFiscal(chave(1)));
      expect(await readFile(legado, 'utf8')).toBe('conteudo-legado');
      expect(raizFiscalDistintaDeDownloads(raiz, path.join(raiz, 'downloads'))).toBe(true);
      expect(raizFiscalDistintaDeDownloads(raiz, raiz)).toBe(false);
    } finally {
      await rm(legado, { force: true });
    }
  });

  it('24 auditoria de inventário completo', async () => {
    const inv = inventario([documento(chave(1)), documento(chave(2), { situacao: 'CANCELADA' })]);
    await repositorio.criarCheckpoint(inv, 'exec-aud-completa');
    await repositorio.persistirXml(inv, chave(1), xmlFiscal(chave(1)));
    const { checkpoint, relatorio } = await repositorio.reconciliar(inv);
    const auditoria = montarAuditoriaFiscal({
      inventario: inv,
      checkpoint,
      reconciliacao: relatorio,
      execucaoId: 'exec-aud-completa',
    });
    expect(auditoria.descobertos).toBe(2);
    expect(auditoria.estado).toBe('RECONCILIADA');
  });

  it('25 inventário parcial na auditoria', () => {
    const inv = montarInventario({
      id: 'inv-parcial',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      documentos: [documento(chave(1))],
      completude: 'PARCIAL',
    });
    const checkpoint = {
      versaoFormato: 1,
      execucaoId: 'x',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      fingerprintInventario: 'a'.repeat(64),
      createdAt: 't',
      updatedAt: 't',
      documentos: [],
    };
    const reconciliacao = reconciliacaoVazia(inv);
    const auditoria = montarAuditoriaFiscal({
      inventario: inv,
      checkpoint,
      reconciliacao: { ...reconciliacao, conclusao: 'NAO_RECONCILIADA', motivos: ['incompleto'] },
      execucaoId: 'exec-parcial',
    });
    expect(auditoria.diagnosticos.some((d) => d.codigo === 'DESCOBERTA_INCOMPLETA')).toBe(true);
    expect(auditoria.estado).toBe('PARCIAL');
  });

  it('26 notas vigentes na auditoria', async () => {
    const inv = inventario([documento(chave(1)), documento(chave(2))]);
    await repositorio.criarCheckpoint(inv, 'exec-vig');
    await repositorio.persistirXml(inv, chave(1), xmlFiscal(chave(1)));
    const { checkpoint, relatorio } = await repositorio.reconciliar(inv);
    const auditoria = montarAuditoriaFiscal({
      inventario: inv,
      checkpoint,
      reconciliacao: relatorio,
      execucaoId: 'exec-vig',
    });
    expect(auditoria.vigentes).toBe(2);
    expect(auditoria.persistidasVerificadas).toBe(1);
  });

  it('27 notas canceladas na auditoria', async () => {
    const inv = inventario([documento(chave(1), { situacao: 'CANCELADA' })]);
    await repositorio.criarCheckpoint(inv, 'exec-canc');
    const { checkpoint, relatorio } = await repositorio.reconciliar(inv);
    const auditoria = montarAuditoriaFiscal({
      inventario: inv,
      checkpoint,
      reconciliacao: relatorio,
      execucaoId: 'exec-canc',
    });
    expect(auditoria.canceladas).toBe(1);
    expect(auditoria.vigentes).toBe(0);
    expect(auditoria.estado).toBe('RECONCILIADA');
  });

  it('28 notas indeterminadas geram auditoria PARCIAL (API-03M)', async () => {
    const inv = inventario([
      documento(chave(1)),
      documento(chave(2), { situacao: 'INDETERMINADA' }),
    ]);
    await repositorio.criarCheckpoint(inv, 'exec-indet');
    const { checkpoint, relatorio } = await repositorio.reconciliar(inv);
    const auditoria = montarAuditoriaFiscal({
      inventario: inv,
      checkpoint,
      reconciliacao: relatorio,
      execucaoId: 'exec-indet',
    });
    expect(auditoria.indeterminadas).toBe(1);
    expect(auditoria.estado).toBe('PARCIAL');
  });

  it('29 falha transitória aparece na auditoria', async () => {
    const inv = inventario([documento(chave(1))]);
    await repositorio.criarCheckpoint(inv, 'exec-ft');
    await repositorio.servico.registrarFalha(inv, chave(1), 'TRANSITORIA', 'timeout', 'TIMEOUT');
    const { checkpoint, relatorio } = await repositorio.reconciliar(inv);
    const auditoria = montarAuditoriaFiscal({
      inventario: inv,
      checkpoint,
      reconciliacao: relatorio,
      execucaoId: 'exec-ft',
    });
    expect(auditoria.falhaTransitoria).toBe(1);
    expect(auditoria.diagnosticos.some((d) => d.codigo === 'TIMEOUT')).toBe(true);
    expect(auditoria.estado).toBe('PARCIAL');
  });

  it('30 falha permanente aparece na auditoria', async () => {
    const inv = inventario([documento(chave(1))]);
    await repositorio.criarCheckpoint(inv, 'exec-fp');
    await repositorio.servico.registrarFalha(inv, chave(1), 'PERMANENTE', '404', 'HTTP_404');
    const { checkpoint, relatorio } = await repositorio.reconciliar(inv);
    const auditoria = montarAuditoriaFiscal({
      inventario: inv,
      checkpoint,
      reconciliacao: relatorio,
      execucaoId: 'exec-fp',
    });
    expect(auditoria.falhaPermanente).toBe(1);
    expect(auditoria.estado).toBe('PARCIAL');
  });

  it('31 cobertura 100%', async () => {
    const inv = inventario([documento(chave(1))]);
    await repositorio.criarCheckpoint(inv, 'exec-100');
    await repositorio.persistirXml(inv, chave(1), xmlFiscal(chave(1)));
    const { checkpoint, relatorio } = await repositorio.reconciliar(inv);
    const auditoria = montarAuditoriaFiscal({
      inventario: inv,
      checkpoint,
      reconciliacao: relatorio,
      execucaoId: 'exec-100',
    });
    expect(auditoria.coberturaPercentual).toBe(100);
    expect(auditoria.estado).toBe('RECONCILIADA');
  });

  it('32 cobertura parcial', async () => {
    const inv = inventario([documento(chave(1)), documento(chave(2))]);
    await repositorio.criarCheckpoint(inv, 'exec-50');
    await repositorio.persistirXml(inv, chave(1), xmlFiscal(chave(1)));
    const { checkpoint, relatorio } = await repositorio.reconciliar(inv);
    const auditoria = montarAuditoriaFiscal({
      inventario: inv,
      checkpoint,
      reconciliacao: relatorio,
      execucaoId: 'exec-50',
    });
    expect(auditoria.coberturaPercentual).toBe(50);
    expect(auditoria.estado).toBe('PARCIAL');
  });

  it('33 zero vigentes', async () => {
    const inv = inventario([documento(chave(1), { situacao: 'CANCELADA' })]);
    await repositorio.criarCheckpoint(inv, 'exec-zero');
    const { checkpoint, relatorio } = await repositorio.reconciliar(inv);
    const auditoria = montarAuditoriaFiscal({
      inventario: inv,
      checkpoint,
      reconciliacao: relatorio,
      execucaoId: 'exec-zero',
    });
    expect(auditoria.vigentes).toBe(0);
    expect(auditoria.coberturaPercentual).toBe(100);
    expect(auditoria.estado).toBe('RECONCILIADA');
  });

  it('34 inconsistência de hash na auditoria', async () => {
    const inv = inventario([documento(chave(1))]);
    await repositorio.criarCheckpoint(inv, 'exec-hash');
    await repositorio.persistirXml(inv, chave(1), xmlFiscal(chave(1), { dCompet: '2026-01' }));
    await writeFile(repositorio.caminhoXml(CNPJ, PERIODO, chave(1)), xmlFiscal(chave(1), { dCompet: '2026-02' }));
    const { checkpoint, relatorio } = await repositorio.reconciliar(inv);
    const auditoria = montarAuditoriaFiscal({
      inventario: inv,
      checkpoint,
      reconciliacao: relatorio,
      execucaoId: 'exec-hash',
    });
    expect(auditoria.inconsistencias).toBeGreaterThan(0);
    expect(auditoria.diagnosticos.some((d) => d.codigo === 'HASH_DIVERGENTE')).toBe(true);
    expect(auditoria.estado).toBe('PARCIAL');
  });

  it('35 auditoria parcial persistida', async () => {
    const inv = inventario([documento(chave(1)), documento(chave(2))]);
    await repositorio.criarCheckpoint(inv, 'exec-ap');
    await repositorio.persistirXml(inv, chave(1), xmlFiscal(chave(1)));
    const { checkpoint, relatorio } = await repositorio.reconciliar(inv);
    const auditoria = montarAuditoriaFiscal({
      inventario: inv,
      checkpoint,
      reconciliacao: relatorio,
      execucaoId: 'exec-ap',
    });
    expect(auditoria.estado).toBe('PARCIAL');
    const destino = await persistirAuditoriaFiscal(criarResolvedorRaizInjetada(raiz), auditoria);
    expect(existsSync(destino)).toBe(true);
    expect(JSON.parse(await readFile(destino, 'utf8')).estado).toBe('PARCIAL');
  });

  it('36 auditoria com indeterminada persistida como PARCIAL (API-03M)', async () => {
    const inv = inventario([documento(chave(1), { situacao: 'INDETERMINADA' })]);
    await repositorio.criarCheckpoint(inv, 'exec-ab');
    const { checkpoint, relatorio } = await repositorio.reconciliar(inv);
    const auditoria = montarAuditoriaFiscal({
      inventario: inv,
      checkpoint,
      reconciliacao: relatorio,
      execucaoId: 'exec-ab',
    });
    expect(auditoria.estado).toBe('PARCIAL');
    const destino = await persistirAuditoriaFiscal(criarResolvedorRaizInjetada(raiz), auditoria);
    expect(JSON.parse(await readFile(destino, 'utf8')).estado).toBe('PARCIAL');
  });

  it('37 auditoria reconciliada persistida e idempotente', async () => {
    const inv = inventario([documento(chave(1))]);
    await repositorio.criarCheckpoint(inv, 'exec-ar');
    await repositorio.persistirXml(inv, chave(1), xmlFiscal(chave(1)));
    const { checkpoint, relatorio } = await repositorio.reconciliar(inv);
    const auditoria = montarAuditoriaFiscal({
      inventario: inv,
      checkpoint,
      reconciliacao: relatorio,
      execucaoId: 'exec-ar',
      agora: () => '2026-10-20T12:00:00.000Z',
    });
    expect(auditoria.estado).toBe('RECONCILIADA');
    const resolvedor = criarResolvedorRaizInjetada(raiz);
    const destino = await persistirAuditoriaFiscal(resolvedor, auditoria);
    const deNovo = await persistirAuditoriaFiscal(resolvedor, auditoria);
    expect(deNovo).toBe(destino);
    const parcial = {
      ...auditoria,
      coberturaPercentual: 0,
      persistidasVerificadas: 0,
      pendentes: 1,
      estado: 'PARCIAL' as const,
      conclusaoReconciliacao: 'NAO_RECONCILIADA' as const,
      auditadoEm: '2026-10-20T11:00:00.000Z',
    };
    const snapshotParcial = { ...parcial, snapshotId: calcularSnapshotId(parcial) };
    const destinoParcial = await persistirAuditoriaFiscal(resolvedor, snapshotParcial);
    expect(destinoParcial).not.toBe(destino);
    const snaps = await listarSnapshotsAuditoria(resolvedor, CNPJ, PERIODO, 'exec-ar');
    expect(snaps).toHaveLength(2);
  });

  it('38 relatório sem segredos', async () => {
    const inv = inventario([documento(chave(1))]);
    await repositorio.criarCheckpoint(inv, 'exec-seg');
    await repositorio.persistirXml(inv, chave(1), xmlFiscal(chave(1)));
    const { checkpoint, relatorio } = await repositorio.reconciliar(inv);
    const auditoria = montarAuditoriaFiscal({
      inventario: inv,
      checkpoint,
      reconciliacao: relatorio,
      execucaoId: 'exec-seg',
    });
    const texto = JSON.stringify(auditoria);
    expect(texto).not.toMatch(/senha|passphrase|BEGIN|pfx|<NFSe|PRIVATE/i);
    expect(texto).not.toContain(chave(1));
    expect(mascararChaveNacional(chave(1))).toBe('7777…7771');
  });

  it('39 lista documentos aptos à exportação', async () => {
    const inv = inventario([documento(chave(1)), documento(chave(2))]);
    await repositorio.criarCheckpoint(inv, 'exec-exp');
    await repositorio.persistirXml(inv, chave(1), xmlFiscal(chave(1)));
    await repositorio.persistirXml(inv, chave(2), xmlFiscal(chave(2)));
    const lista = await repositorio.listarDocumentosExportaveis(inv);
    expect(lista.lote.bloqueadoPorIndeterminada).toBe(false);
    expect(lista.lote.liberado).toBe(true);
    expect(lista.aptos).toHaveLength(2);
  });

  it('40 cancelada excluída da exportação', async () => {
    const inv = inventario([
      documento(chave(1)),
      documento(chave(2), { situacao: 'CANCELADA' }),
    ]);
    await repositorio.criarCheckpoint(inv, 'exec-exc');
    await repositorio.persistirXml(inv, chave(1), xmlFiscal(chave(1)));
    const lista = await repositorio.listarDocumentosExportaveis(inv);
    expect(lista.aptos.map((d) => d.chaveNacional)).toEqual([chave(1)]);
    expect(lista.lote.liberado).toBe(true);
  });

  it('41 indeterminada bloqueia o lote contábil', async () => {
    const inv = inventario([
      documento(chave(1)),
      documento(chave(2), { situacao: 'INDETERMINADA' }),
    ]);
    await repositorio.criarCheckpoint(inv, 'exec-bloq');
    const lista = await repositorio.listarDocumentosExportaveis(inv);
    expect(lista.lote.bloqueadoPorIndeterminada).toBe(true);
    expect(lista.lote.liberado).toBe(false);
    expect(lista.aptos).toEqual([]);
  });

  it('42 XML ausente não exportável', async () => {
    const inv = inventario([documento(chave(1))]);
    await repositorio.criarCheckpoint(inv, 'exec-xa');
    expect((await repositorio.listarDocumentosExportaveis(inv)).aptos).toEqual([]);
  });

  it('43 hash divergente não exportável', async () => {
    const inv = inventario([documento(chave(1))]);
    await repositorio.criarCheckpoint(inv, 'exec-hd');
    await repositorio.persistirXml(inv, chave(1), xmlFiscal(chave(1)));
    await writeFile(repositorio.caminhoXml(CNPJ, PERIODO, chave(1)), 'quebrado');
    expect((await repositorio.listarDocumentosExportaveis(inv)).aptos).toEqual([]);
  });

  it('44 documento íntegro exportável', async () => {
    const inv = inventario([documento(chave(1), { direcao: 'RECEBIDA' })]);
    const xml = xmlFiscal(chave(1), { emitente: OUTRO, tomador: CNPJ });
    await repositorio.criarCheckpoint(inv, 'exec-ok');
    await repositorio.persistirXml(inv, chave(1), xml);
    const lista = await repositorio.listarDocumentosExportaveis(inv);
    expect(lista.aptos).toEqual([
      expect.objectContaining({
        chaveNacional: chave(1),
        direcao: 'RECEBIDA',
        situacao: 'VIGENTE',
        hashSha256: createHash('sha256').update(xml, 'utf8').digest('hex'),
      }),
    ]);
  });

  it('senha inválida e certificado expirado são distinguidos', async () => {
    const senhaRuim = new AdaptadorCertificadoA1({
      async carregar() {
        return { pfx: pfxValido(), passphrase: 'errada' };
      },
    });
    await expect(senhaRuim.obter(CNPJ)).rejects.toMatchObject({ codigo: 'SENHA_INVALIDA' });

    const expirado = new AdaptadorCertificadoA1({
      async carregar() {
        return { pfx: pfxExpirado(), passphrase: SENHA };
      },
    });
    await expect(expirado.obter(CNPJ)).rejects.toMatchObject({ codigo: 'CERTIFICADO_EXPIRADO' });
  });

  it('45 snapshot inicial parcial e 46 posterior reconciliado preservam histórico', async () => {
    const inv = inventario([documento(chave(1)), documento(chave(2))]);
    await repositorio.criarCheckpoint(inv, 'exec-evolucao');
    await repositorio.persistirXml(inv, chave(1), xmlFiscal(chave(1)));
    const parcial = await repositorio.reconciliar(inv);
    const snapA = montarAuditoriaFiscal({
      inventario: inv,
      checkpoint: parcial.checkpoint,
      reconciliacao: parcial.relatorio,
      execucaoId: 'exec-evolucao',
      agora: () => '2026-10-20T10:00:00.000Z',
    });
    expect(snapA.estado).toBe('PARCIAL');
    expect(snapA.coberturaPercentual).toBe(50);

    const resolvedor = criarResolvedorRaizInjetada(raiz);
    await persistirAuditoriaFiscal(resolvedor, snapA);

    await repositorio.persistirXml(inv, chave(2), xmlFiscal(chave(2)));
    const final = await repositorio.reconciliar(inv);
    const snapB = montarAuditoriaFiscal({
      inventario: inv,
      checkpoint: final.checkpoint,
      reconciliacao: final.relatorio,
      execucaoId: 'exec-evolucao',
      agora: () => '2026-10-20T11:00:00.000Z',
    });
    expect(snapB.estado).toBe('RECONCILIADA');
    expect(snapB.coberturaPercentual).toBe(100);
    expect(snapB.snapshotId).not.toBe(snapA.snapshotId);

    await persistirAuditoriaFiscal(resolvedor, snapB);
    const historico = await listarSnapshotsAuditoria(resolvedor, CNPJ, PERIODO, 'exec-evolucao');
    expect(historico.map((s) => s.coberturaPercentual)).toEqual([50, 100]);
    expect(existsSync(path.join(raiz, 'auditoria', CNPJ))).toBe(true);
  });

  it('47 mesmo snapshot é idempotente', async () => {
    const inv = inventario([documento(chave(1))]);
    await repositorio.criarCheckpoint(inv, 'exec-idem-snap');
    await repositorio.persistirXml(inv, chave(1), xmlFiscal(chave(1)));
    const { checkpoint, relatorio } = await repositorio.reconciliar(inv);
    const snap = montarAuditoriaFiscal({
      inventario: inv,
      checkpoint,
      reconciliacao: relatorio,
      execucaoId: 'exec-idem-snap',
      agora: () => '2026-10-20T12:00:00.000Z',
    });
    const resolvedor = criarResolvedorRaizInjetada(raiz);
    const a = await persistirAuditoriaFiscal(resolvedor, snap);
    const b = await persistirAuditoriaFiscal(resolvedor, {
      ...snap,
      auditadoEm: '2026-10-20T13:00:00.000Z',
    });
    expect(a).toBe(b);
    expect(await listarSnapshotsAuditoria(resolvedor, CNPJ, PERIODO, 'exec-idem-snap')).toHaveLength(1);
  });

  it('48 empresa e 49 período diferentes isolam auditoria', async () => {
    const casos: Array<{ inv: InventarioNfse; exec: string }> = [
      { inv: inventario([documento(chave(1))]), exec: 'exec-emp-a' },
      { inv: inventario([documento(chave(1), { cnpj: OUTRO })], 'COMPLETO', OUTRO), exec: 'exec-emp-b' },
      {
        inv: inventario([documento(chave(1), { periodo: OUTRO_PERIODO })], 'COMPLETO', CNPJ, OUTRO_PERIODO),
        exec: 'exec-per-c',
      },
    ];
    const resolvedor = criarResolvedorRaizInjetada(raiz);
    const repo = new RepositorioFiscalNfse(resolvedor);
    for (const { inv, exec } of casos) {
      await repo.criarCheckpoint(inv, exec);
      await repo.persistirXml(inv, chave(1), xmlFiscal(chave(1), { emitente: inv.cnpj }));
      const { checkpoint, relatorio } = await repo.reconciliar(inv);
      await persistirAuditoriaFiscal(
        resolvedor,
        montarAuditoriaFiscal({ inventario: inv, checkpoint, reconciliacao: relatorio, execucaoId: exec })
      );
    }
    expect(await listarSnapshotsAuditoria(resolvedor, CNPJ, PERIODO, 'exec-emp-a')).toHaveLength(1);
    expect(await listarSnapshotsAuditoria(resolvedor, OUTRO, PERIODO, 'exec-emp-b')).toHaveLength(1);
    expect(await listarSnapshotsAuditoria(resolvedor, CNPJ, OUTRO_PERIODO, 'exec-per-c')).toHaveLength(1);
    expect(await listarSnapshotsAuditoria(resolvedor, CNPJ, PERIODO, 'exec-emp-b')).toEqual([]);
  });

  it('50 execução diferente e 51 conflito de conteúdo no mesmo snapshotId', async () => {
    const inv = inventario([documento(chave(1))]);
    await repositorio.criarCheckpoint(inv, 'exec-x1');
    await repositorio.persistirXml(inv, chave(1), xmlFiscal(chave(1)));
    const { checkpoint, relatorio } = await repositorio.reconciliar(inv);
    const snap = montarAuditoriaFiscal({
      inventario: inv,
      checkpoint,
      reconciliacao: relatorio,
      execucaoId: 'exec-x1',
      agora: () => '2026-10-20T12:00:00.000Z',
    });
    const resolvedor = criarResolvedorRaizInjetada(raiz);
    await persistirAuditoriaFiscal(resolvedor, snap);
    const outraExec = montarAuditoriaFiscal({
      inventario: inv,
      checkpoint,
      reconciliacao: relatorio,
      execucaoId: 'exec-x2',
      agora: () => '2026-10-20T12:00:00.000Z',
    });
    await persistirAuditoriaFiscal(resolvedor, outraExec);
    expect(await listarSnapshotsAuditoria(resolvedor, CNPJ, PERIODO, 'exec-x1')).toHaveLength(1);
    expect(await listarSnapshotsAuditoria(resolvedor, CNPJ, PERIODO, 'exec-x2')).toHaveLength(1);

    await expect(
      persistirAuditoriaFiscal(resolvedor, {
        ...snap,
        diagnosticos: [{ codigo: 'X', mensagem: 'alterado' }],
        snapshotId: snap.snapshotId,
      })
    ).rejects.toMatchObject({ codigo: 'AUDITORIA_INCOMPATIVEL' });
  });

  it('52 consulta ao snapshot mais recente', async () => {
    const inv = inventario([documento(chave(1)), documento(chave(2))]);
    await repositorio.criarCheckpoint(inv, 'exec-recente');
    await repositorio.persistirXml(inv, chave(1), xmlFiscal(chave(1)));
    const resolvedor = criarResolvedorRaizInjetada(raiz);
    const a = await repositorio.reconciliar(inv);
    await persistirAuditoriaFiscal(
      resolvedor,
      montarAuditoriaFiscal({
        inventario: inv,
        checkpoint: a.checkpoint,
        reconciliacao: a.relatorio,
        execucaoId: 'exec-recente',
        agora: () => '2026-10-20T09:00:00.000Z',
      })
    );
    await repositorio.persistirXml(inv, chave(2), xmlFiscal(chave(2)));
    const b = await repositorio.reconciliar(inv);
    await persistirAuditoriaFiscal(
      resolvedor,
      montarAuditoriaFiscal({
        inventario: inv,
        checkpoint: b.checkpoint,
        reconciliacao: b.relatorio,
        execucaoId: 'exec-recente',
        agora: () => '2026-10-20T10:00:00.000Z',
      })
    );
    const recente = await obterAuditoriaMaisRecente(resolvedor, CNPJ, PERIODO, 'exec-recente');
    expect(recente.coberturaPercentual).toBe(100);
    expect(recente.estado).toBe('RECONCILIADA');
  });

  it('53 exportação exige validação fiscal CONFIRMADA além do hash', async () => {
    const inv = inventario([documento(chave(1))]);
    await repositorio.criarCheckpoint(inv, 'exec-fiscal-exp');
    await repositorio.persistirXml(inv, chave(1), xmlFiscal(chave(1)));
    expect((await repositorio.listarDocumentosExportaveis(inv)).aptos).toHaveLength(1);

    const inimigo = xmlFiscal(chave(1), { emitente: OUTRO });
    await writeFile(repositorio.caminhoXml(CNPJ, PERIODO, chave(1)), inimigo);
    await alinharMetadadosCheckpointComArquivo(chave(1), inimigo);
    expect((await repositorio.listarDocumentosExportaveis(inv)).aptos).toEqual([]);
  });

  it('54 XML com chave divergente não é exportável', async () => {
    const inv = inventario([documento(chave(1))]);
    await repositorio.criarCheckpoint(inv, 'exec-chave-exp');
    await repositorio.persistirXml(inv, chave(1), xmlFiscal(chave(1)));
    const xmlDivergente = xmlFiscal(chave(1), { chaveXml: chave(2) });
    await writeFile(repositorio.caminhoXml(CNPJ, PERIODO, chave(1)), xmlDivergente);
    await alinharMetadadosCheckpointComArquivo(chave(1), xmlDivergente);
    expect((await repositorio.listarDocumentosExportaveis(inv)).aptos).toEqual([]);
  });

  it('55 XML de outra empresa não é exportável', async () => {
    const inv = inventario([documento(chave(1))]);
    await repositorio.criarCheckpoint(inv, 'exec-emp-exp');
    await repositorio.persistirXml(inv, chave(1), xmlFiscal(chave(1)));
    const outro = xmlFiscal(chave(1), { emitente: OUTRO });
    await writeFile(repositorio.caminhoXml(CNPJ, PERIODO, chave(1)), outro);
    await alinharMetadadosCheckpointComArquivo(chave(1), outro);
    expect((await repositorio.listarDocumentosExportaveis(inv)).aptos).toEqual([]);
  });

  it('56 XML com direção divergente não é exportável', async () => {
    const inv = inventario([documento(chave(1), { direcao: 'RECEBIDA' })]);
    await repositorio.criarCheckpoint(inv, 'exec-dir-exp');
    await repositorio.persistirXml(inv, chave(1), xmlFiscal(chave(1), { emitente: OUTRO, tomador: CNPJ }));
    const emitida = xmlFiscal(chave(1), { emitente: CNPJ, tomador: TOMADOR });
    await writeFile(repositorio.caminhoXml(CNPJ, PERIODO, chave(1)), emitida);
    await alinharMetadadosCheckpointComArquivo(chave(1), emitida);
    expect((await repositorio.listarDocumentosExportaveis(inv)).aptos).toEqual([]);
  });

  it('57 XML malformado não é exportável', async () => {
    const inv = inventario([documento(chave(1))]);
    await repositorio.criarCheckpoint(inv, 'exec-mal-exp');
    await repositorio.persistirXml(inv, chave(1), xmlFiscal(chave(1)));
    await writeFile(repositorio.caminhoXml(CNPJ, PERIODO, chave(1)), '<NFSe><infNFSe>');
    expect((await repositorio.listarDocumentosExportaveis(inv)).aptos).toEqual([]);
  });

  it('58 lote parcial versus 59 lote reconciliado', async () => {
    const inv = inventario([documento(chave(1)), documento(chave(2))]);
    await repositorio.criarCheckpoint(inv, 'exec-lote');
    await repositorio.persistirXml(inv, chave(1), xmlFiscal(chave(1)));
    const parcial = await repositorio.listarDocumentosExportaveis(inv);
    expect(parcial.aptos).toHaveLength(1);
    expect(parcial.lote.liberado).toBe(false);
    expect(parcial.lote.motivos.length).toBeGreaterThan(0);

    await repositorio.persistirXml(inv, chave(2), xmlFiscal(chave(2)));
    const completo = await repositorio.listarDocumentosExportaveis(inv);
    expect(completo.aptos).toHaveLength(2);
    expect(completo.lote.liberado).toBe(true);
    expect(completo.lote.motivos).toEqual([]);
  });

  it('60 nenhum XML apto', async () => {
    const inv = inventario([documento(chave(1), { situacao: 'CANCELADA' })]);
    await repositorio.criarCheckpoint(inv, 'exec-nenhum');
    const lista = await repositorio.listarDocumentosExportaveis(inv);
    expect(lista.aptos).toEqual([]);
    expect(lista.lote.liberado).toBe(true);
  });

  it('61 PFX original não é mutado pelo adaptador', async () => {
    const original = pfxValido();
    const copia = Buffer.from(original);
    const adaptador = new AdaptadorCertificadoA1({
      async carregar() {
        return { pfx: original, passphrase: SENHA };
      },
    });
    const credencial = await adaptador.obter(CNPJ);
    credencial.pfx.fill(0);
    expect(original.equals(copia)).toBe(true);
    expect(credencial.pfx.equals(original)).toBe(false);
  });

  it('62 carregamento sob demanda sem cache de credencial', async () => {
    let chamadas = 0;
    const material = pfxValido();
    const adaptador = new AdaptadorCertificadoA1({
      async carregar() {
        chamadas += 1;
        return { pfx: material, passphrase: SENHA };
      },
    });
    const a = await adaptador.obter(CNPJ);
    const b = await adaptador.obter(CNPJ);
    expect(chamadas).toBe(2);
    expect(a.pfx).not.toBe(b.pfx);
    expect(a.pfx).not.toBe(material);
    expect(a.pfx.equals(b.pfx)).toBe(true);
  });

  it('63 falha A1 sem vazamento e 64 snapshotId no relatório', async () => {
    const adaptador = new AdaptadorCertificadoA1({
      async carregar() {
        throw new Error(`boom ${SENHA}`);
      },
    });
    await expect(adaptador.obter(CNPJ)).rejects.toSatisfy((erro: unknown) => {
      const texto = JSON.stringify(erro) + String(erro);
      return erro instanceof InfraestruturaNfseError && !texto.includes(SENHA);
    });

    const inv = inventario([documento(chave(1))]);
    await repositorio.criarCheckpoint(inv, 'exec-sid');
    await repositorio.persistirXml(inv, chave(1), xmlFiscal(chave(1)));
    const { checkpoint, relatorio } = await repositorio.reconciliar(inv);
    const aud = montarAuditoriaFiscal({
      inventario: inv,
      checkpoint,
      reconciliacao: relatorio,
      execucaoId: 'exec-sid',
    });
    expect(aud.snapshotId).toMatch(/^[a-f0-9]{32}$/);
    expect(aud.snapshotId).toBe(calcularSnapshotId(aud));
  });
});

function chave(final: number): string {
  return String(final).padStart(50, '7');
}

function xmlFiscal(
  chaveValor: string,
  opcoes: { emitente?: string; tomador?: string; dCompet?: string; chaveXml?: string } = {}
): string {
  const chaveXml = opcoes.chaveXml ?? chaveValor;
  return `<?xml version="1.0" encoding="UTF-8"?>
<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse">
  <infNFSe Id="NFS${chaveXml}">
    <chNFSe>${chaveXml}</chNFSe>
    <dCompet>${opcoes.dCompet ?? '2026-08'}</dCompet>
    <emit><CNPJ>${opcoes.emitente ?? CNPJ}</CNPJ></emit>
    <toma><CNPJ>${opcoes.tomador ?? TOMADOR}</CNPJ></toma>
  </infNFSe>
</NFSe>`;
}

function documento(
  chaveValor: string,
  opcoes: {
    cnpj?: string;
    direcao?: DirecaoDocumentoFiscal;
    situacao?: SituacaoDocumentoFiscal;
    periodo?: PeriodoConsultaPortal;
  } = {}
) {
  return criarDocumentoFiscal({
    chaveNacional: chaveValor,
    cnpj: opcoes.cnpj ?? CNPJ,
    direcao: opcoes.direcao ?? 'EMITIDA',
    situacao: opcoes.situacao ?? 'VIGENTE',
    periodoConsulta: opcoes.periodo ?? PERIODO,
  });
}

function inventario(
  documentos: ReturnType<typeof documento>[],
  completude: 'COMPLETO' | 'PARCIAL' = 'COMPLETO',
  cnpj = CNPJ,
  periodo = PERIODO
): InventarioNfse {
  return montarInventario({
    id: 'inv-infra',
    cnpj,
    periodoConsulta: periodo,
    documentos,
    completude,
  });
}

function reconciliacaoVazia(inv: InventarioNfse) {
  return {
    descobertos: inv.totais.descobertos,
    vigentes: inv.totais.vigentes,
    canceladas: inv.totais.canceladas,
    indeterminadas: inv.totais.indeterminadas,
    persistidosIntegros: 0,
    pendentes: inv.totais.vigentes,
    falhaTransitoria: 0,
    falhaPermanente: 0,
    inconsistencias: 0,
    cobertura: 0,
    chavesFaltantes: [],
    chavesExcedentes: [],
    chavesDuplicadas: [],
    divergenciasHash: [],
    identidadeConsistente: false,
    conclusao: 'NAO_RECONCILIADA' as const,
    motivos: [],
  };
}

function pfxValido(): Buffer {
  return montarPfx(new Date('2035-01-01T00:00:00Z'));
}

function pfxExpirado(): Buffer {
  return montarPfx(new Date('2020-01-01T00:00:00Z'));
}

function montarPfx(notAfter: Date): Buffer {
  const chaves = forge.pki.rsa.generateKeyPair(512);
  const certificado = forge.pki.createCertificate();
  certificado.publicKey = chaves.publicKey;
  certificado.serialNumber = '01';
  certificado.validity.notBefore = new Date('2020-01-01T00:00:00Z');
  certificado.validity.notAfter = notAfter;
  const atributos = [{ name: 'commonName', value: 'teste-infra' }];
  certificado.setSubject(atributos);
  certificado.setIssuer(atributos);
  certificado.sign(chaves.privateKey, forge.md.sha256.create());
  const asn1 = forge.pkcs12.toPkcs12Asn1(chaves.privateKey, [certificado], SENHA);
  return Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary');
}

/** Alinha hash/tamanho do checkpoint ao arquivo já gravado, sem validação fiscal. */
async function alinharMetadadosCheckpointComArquivo(chaveValor: string, xml: string): Promise<void> {
  const arquivo = path.join(raiz, 'checkpoints', CNPJ, '01-09-2026_30-09-2026', 'checkpoint.json');
  const json = JSON.parse(await readFile(arquivo, 'utf8'));
  const doc = json.documentos.find((item: { chaveNacional: string }) => item.chaveNacional === chaveValor);
  const bytes = Buffer.from(xml, 'utf8');
  doc.hashSha256 = createHash('sha256').update(bytes).digest('hex');
  doc.tamanhoBytes = bytes.length;
  doc.estado = 'PERSISTIDO';
  await writeFile(arquivo, `${JSON.stringify(json, null, 2)}\n`);
}
