import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, open, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LIMITES_RECUPERACAO_PADRAO } from '../recovery/types';
import { criarDocumentoFiscal, type DirecaoDocumentoFiscal, type SituacaoDocumentoFiscal } from '../contracts/documento-fiscal';
import { montarInventario, type InventarioNfse } from '../contracts/inventario';
import { criarCompetenciaFiscalXml, criarPeriodoConsultaPortal, type PeriodoConsultaPortal } from '../contracts/periodo';
import {
  CheckpointNfseError,
  CheckpointService,
  CheckpointStore,
  XmlStore,
  calcularFingerprintInventario,
  hashSha256Conteudo,
  reconciliarNfse,
  resolverCaminhoSeguro,
  retomarExecucaoNfse,
  segmentoPeriodo,
  type ArquivoVerificadoNfse,
  type CheckpointNfse,
} from './index';

const CNPJ = '12345678000199';
const TOMADOR = '11222333000181';
const OUTRO_CNPJ = '99888777000166';
const PERIODO = criarPeriodoConsultaPortal('01/09/2026', '30/09/2026');
const OUTRO_PERIODO = criarPeriodoConsultaPortal('01/10/2026', '31/10/2026');

let raiz: string;
let checkpoints: CheckpointStore;
let xmls: XmlStore;
let servico: CheckpointService;

beforeEach(async () => {
  raiz = await mkdtemp(path.join(tmpdir(), 'nfse-checkpoint-'));
  checkpoints = new CheckpointStore(path.join(raiz, 'checkpoints'));
  xmls = new XmlStore(path.join(raiz, 'xml'));
  servico = new CheckpointService(checkpoints, xmls);
});

afterEach(async () => {
  await rm(raiz, { recursive: true, force: true });
});

describe('checkpoint nativo de NFS-e', () => {
  it('01 criação exige inventário válido e mapeia os estados iniciais', async () => {
    const inv = inventario([
      documento(chave(1)),
      documento(chave(2), { situacao: 'CANCELADA', direcao: 'RECEBIDA' }),
      documento(chave(3), { situacao: 'INDETERMINADA' }),
    ]);
    const checkpoint = await servico.criarCheckpoint(inv, 'exec-criacao');

    expect(estadoDe(checkpoint, chave(1)).estado).toBe('PENDENTE');
    expect(estadoDe(checkpoint, chave(2)).estado).toBe('EXCLUIDA_DA_RECUPERACAO');
    expect(estadoDe(checkpoint, chave(3)).estado).toBe('PENDENTE');
    expect(estadoDe(checkpoint, chave(3)).codigo).toBe('ATENCAO_SITUACAO_NAO_CONFIRMADA');
    expect(existsSync(checkpoints.caminhoArquivo(CNPJ, PERIODO))).toBe(true);

    const parcial = montarInventario({
      id: 'inv-parcial',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      documentos: [documento(chave(1))],
      completude: 'PARCIAL',
    });
    await expect(servico.criarCheckpoint(parcial, 'exec-parcial')).rejects.toMatchObject({
      codigo: 'DESCOBERTA_INCOMPLETA',
    });

    const base = inventario([documento(chave(1))]);
    await expect(
      servico.criarCheckpoint({ ...base, totais: { ...base.totais, descobertos: 9 } }, 'exec-totais')
    ).rejects.toMatchObject({ codigo: 'INCONSISTENCIA_INVENTARIO' });
    await expect(
      servico.criarCheckpoint(
        {
          ...base,
          documentos: [base.documentos[0], { ...base.documentos[0] }],
          totais: { ...base.totais, descobertos: 2, emitidas: 2, vigentes: 2 },
        },
        'exec-dup'
      )
    ).rejects.toMatchObject({ codigo: 'INCONSISTENCIA_INVENTARIO' });
  });

  it('02 identidade guarda execução, CNPJ, período, fingerprint, versão e datas', async () => {
    const checkpoint = await servico.criarCheckpoint(inventario([documento(chave(1))]), 'exec-identidade');
    const texto = await readFile(checkpoints.caminhoArquivo(CNPJ, PERIODO), 'utf8');

    expect(checkpoint.execucaoId).toBe('exec-identidade');
    expect(checkpoint.cnpj).toBe(CNPJ);
    expect(checkpoint.periodoConsulta).toEqual({
      tipo: 'PERIODO_CONSULTA_PORTAL',
      inicio: '01/09/2026',
      fim: '30/09/2026',
    });
    expect(checkpoint.versaoFormato).toBe(1);
    expect(checkpoint.fingerprintInventario).toMatch(/^[a-f0-9]{64}$/);
    expect(checkpoint.createdAt).toBe(checkpoint.updatedAt);
    expect(Number.isNaN(Date.parse(checkpoint.createdAt))).toBe(false);
    expect(texto).not.toMatch(/senha|pfx|dCompet|<NFSe/i);
  });

  it('03 fingerprint é SHA-256 determinístico e ignora dCompet', () => {
    const comCompetencia = inventario([
      documento(chave(2), { direcao: 'RECEBIDA', dCompet: '2020-01' }),
      documento(chave(1), { dCompet: '2024-05' }),
    ]);
    const semCompetencia = inventario([
      documento(chave(1)),
      documento(chave(2), { direcao: 'RECEBIDA' }),
    ]);
    const fingerprint = calcularFingerprintInventario(comCompetencia);

    expect(fingerprint).toBe(calcularFingerprintInventario(semCompetencia));
    expect(fingerprint).toBe(createHash('sha256').update(canonico(comCompetencia), 'utf8').digest('hex'));
    expect(canonico(comCompetencia)).not.toMatch(/dCompet|senha|pfx|<NFSe/i);
    expect(fingerprint).toBe(calcularFingerprintInventario(comCompetencia));
  });

  it('04 ordem diferente de descoberta produz o mesmo fingerprint', () => {
    const ida = inventario([documento(chave(1)), documento(chave(2), { direcao: 'RECEBIDA' })]);
    const volta = inventario([documento(chave(2), { direcao: 'RECEBIDA' }), documento(chave(1))]);
    expect(calcularFingerprintInventario(ida)).toBe(calcularFingerprintInventario(volta));
  });

  it('05 empresa diferente muda o fingerprint e não reutiliza o checkpoint', async () => {
    const daEmpresa = inventario([documento(chave(1))]);
    const deOutra = inventario([documento(chave(1), { cnpj: OUTRO_CNPJ })], 'COMPLETO', OUTRO_CNPJ);
    await servico.criarCheckpoint(daEmpresa, 'exec-a');

    expect(calcularFingerprintInventario(daEmpresa)).not.toBe(calcularFingerprintInventario(deOutra));
    await expect(retomarExecucaoNfse({ inventario: deOutra, checkpointStore: checkpoints, xmlStore: xmls })).rejects.toMatchObject({
      codigo: 'CHECKPOINT_AUSENTE',
    });
    expect((await checkpoints.carregar(CNPJ, PERIODO))?.cnpj).toBe(CNPJ);
  });

  it('06 período diferente muda o fingerprint e recusa o checkpoint', async () => {
    const atual = inventario([documento(chave(1))]);
    const outro = inventario([documento(chave(1), { periodo: OUTRO_PERIODO })], 'COMPLETO', CNPJ, OUTRO_PERIODO);
    await servico.criarCheckpoint(atual, 'exec-periodo');
    expect(calcularFingerprintInventario(atual)).not.toBe(calcularFingerprintInventario(outro));

    await expect(retomarExecucaoNfse({ inventario: outro, checkpointStore: checkpoints, xmlStore: xmls })).rejects.toMatchObject({
      codigo: 'CHECKPOINT_AUSENTE',
    });
    await reescrever((json) => {
      json.periodoConsulta = { ...json.periodoConsulta, fim: '31/10/2026' };
    });
    await expect(retomarExecucaoNfse({ inventario: atual, checkpointStore: checkpoints, xmlStore: xmls })).rejects.toMatchObject({
      codigo: 'IDENTIDADE_DIVERGENTE',
    });
  });

  it('07 inventário divergente não retoma e preserva o checkpoint anterior', async () => {
    const um = inventario([documento(chave(1))]);
    const dois = inventario([documento(chave(1)), documento(chave(2))]);
    const criado = await servico.criarCheckpoint(um, 'exec-inv');
    const antes = await readFile(checkpoints.caminhoArquivo(CNPJ, PERIODO), 'utf8');

    expect(calcularFingerprintInventario(um)).not.toBe(calcularFingerprintInventario(dois));
    await expect(retomarExecucaoNfse({ inventario: dois, checkpointStore: checkpoints, xmlStore: xmls })).rejects.toMatchObject({
      codigo: 'IDENTIDADE_DIVERGENTE',
    });
    expect(await readFile(checkpoints.caminhoArquivo(CNPJ, PERIODO), 'utf8')).toBe(antes);
    expect(reconciliarNfse(dois, criado, []).identidadeConsistente).toBe(false);
  });

  it('08 checkpoint corrompido falha com erro explícito e não é apagado', async () => {
    await servico.criarCheckpoint(inventario([documento(chave(1))]), 'exec-corrupto');
    const arquivo = checkpoints.caminhoArquivo(CNPJ, PERIODO);
    await writeFile(arquivo, '{');

    await expect(checkpoints.carregar(CNPJ, PERIODO)).rejects.toMatchObject({ codigo: 'CHECKPOINT_CORROMPIDO' });
    expect(await readFile(arquivo, 'utf8')).toBe('{');
  });

  it('09 versão incompatível é recusada', async () => {
    await servico.criarCheckpoint(inventario([documento(chave(1))]), 'exec-versao');
    await reescrever((json) => {
      json.versaoFormato = 99;
    });

    await expect(checkpoints.carregar(CNPJ, PERIODO)).rejects.toBeInstanceOf(CheckpointNfseError);
    await expect(checkpoints.carregar(CNPJ, PERIODO)).rejects.toMatchObject({ codigo: 'VERSAO_INCOMPATIVEL' });
  });

  it('10 XML persistido só depois do arquivo conferido', async () => {
    const inv = inventario([documento(chave(1))]);
    await servico.criarCheckpoint(inv, 'exec-xml');
    await expect(servico.persistirXml(inv, chave(1), '   ')).rejects.toMatchObject({ codigo: 'XML_VAZIO' });
    await expect(servico.persistirXml(inv, chave(1), '<NFSe></NFSe>')).rejects.toMatchObject({
      codigo: 'XML_NAO_CONFIRMADO',
    });
    await expect(servico.persistirXml(inv, chave(1), xmlTextoFraco(chave(1)))).rejects.toMatchObject({
      codigo: 'XML_NAO_CONFIRMADO',
    });
    expect(existsSync(xmls.caminhoArquivo(CNPJ, PERIODO, chave(1)))).toBe(false);

    const xml = xmlDe(chave(1));
    const checkpoint = await servico.persistirXml(inv, chave(1), xml);
    const doc = estadoDe(checkpoint, chave(1));
    const arquivo = xmls.caminhoArquivo(CNPJ, PERIODO, chave(1));

    expect(doc.estado).toBe('PERSISTIDO');
    expect(doc.tamanhoBytes).toBeGreaterThan(0);
    expect(existsSync(arquivo)).toBe(true);
    expect((await readFile(arquivo, 'utf8')).length).toBeGreaterThan(0);
  });

  it('11 hash SHA-256 do arquivo confere com o metadado', async () => {
    const inv = inventario([documento(chave(1))]);
    const xml = xmlDe(chave(1));
    await servico.criarCheckpoint(inv, 'exec-hash');
    const checkpoint = await servico.persistirXml(inv, chave(1), xml);
    const bytes = await readFile(xmls.caminhoArquivo(CNPJ, PERIODO, chave(1)));

    expect(estadoDe(checkpoint, chave(1)).hashSha256).toBe(hashSha256Conteudo(bytes));
    expect(estadoDe(checkpoint, chave(1)).hashSha256).toBe(hashSha256Conteudo(Buffer.from(xml, 'utf8')));
  });

  it('12 arquivo ausente volta a pendente e só reaproveita se o hash registrado bater', async () => {
    const inv = inventario([documento(chave(1))]);
    const xml = xmlDe(chave(1));
    await servico.criarCheckpoint(inv, 'exec-ausente');
    await servico.persistirXml(inv, chave(1), xml);
    const destino = xmls.caminhoArquivo(CNPJ, PERIODO, chave(1));
    await rm(destino);

    const retomado = await retomarExecucaoNfse({ inventario: inv, checkpointStore: checkpoints, xmlStore: xmls });
    const pendente = estadoDe(retomado.checkpoint, chave(1));
    expect(pendente.estado).toBe('PENDENTE');
    expect(pendente.hashSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(reconciliarNfse(inv, retomado.checkpoint, [await xmls.verificar(CNPJ, PERIODO, chave(1))]).conclusao).toBe(
      'NAO_RECONCILIADA'
    );

    await writeFile(destino, xml);
    const reaproveitado = await retomarExecucaoNfse({ inventario: inv, checkpointStore: checkpoints, xmlStore: xmls });
    expect(estadoDe(reaproveitado.checkpoint, chave(1)).estado).toBe('PERSISTIDO');
  });

  it('13 arquivo truncado fica inconsistente e não é sobrescrito', async () => {
    const inv = inventario([documento(chave(1))]);
    const xml = xmlDe(chave(1));
    await servico.criarCheckpoint(inv, 'exec-truncado');
    await servico.persistirXml(inv, chave(1), xml);
    const destino = xmls.caminhoArquivo(CNPJ, PERIODO, chave(1));
    await writeFile(destino, Buffer.from(xml).subarray(0, 4));

    const retomado = await retomarExecucaoNfse({ inventario: inv, checkpointStore: checkpoints, xmlStore: xmls });
    expect(estadoDe(retomado.checkpoint, chave(1)).estado).toBe('INCONSISTENTE');
    expect((await readFile(destino)).length).toBe(4);
    await expect(servico.persistirXml(inv, chave(1), xml)).rejects.toMatchObject({ codigo: 'DOCUMENTO_NAO_ELEGIVEL' });
    expect((await readFile(destino)).length).toBe(4);
  });

  it('14 hash divergente marca inconsistente e mantém os bytes', async () => {
    const inv = inventario([documento(chave(1))]);
    const original = xmlDe(chave(1), { dCompet: '2026-01' });
    const trocado = xmlDe(chave(1), { dCompet: '2026-02' });
    await servico.criarCheckpoint(inv, 'exec-hash-divergente');
    await servico.persistirXml(inv, chave(1), original);
    const destino = xmls.caminhoArquivo(CNPJ, PERIODO, chave(1));
    await writeFile(destino, trocado);

    const retomado = await retomarExecucaoNfse({ inventario: inv, checkpointStore: checkpoints, xmlStore: xmls });
    expect(estadoDe(retomado.checkpoint, chave(1)).estado).toBe('INCONSISTENTE');
    expect(await readFile(destino, 'utf8')).toBe(trocado);
  });

  it('15 arquivo já existente com o mesmo hash é reutilizado', async () => {
    const inv = inventario([documento(chave(1))]);
    const xml = xmlDe(chave(1));
    await servico.criarCheckpoint(inv, 'exec-existente');
    const destino = xmls.caminhoArquivo(CNPJ, PERIODO, chave(1));
    await mkdir(path.dirname(destino), { recursive: true });
    await writeFile(destino, xml);
    const antes = await readFile(destino);

    const checkpoint = await servico.persistirXml(inv, chave(1), xml);
    expect(estadoDe(checkpoint, chave(1)).estado).toBe('PERSISTIDO');
    expect((await readFile(destino)).equals(antes)).toBe(true);
    expect(await contarXml()).toBe(1);
  });

  it('16 o mesmo XML duas vezes não duplica arquivo nem corrompe o checkpoint', async () => {
    const inv = inventario([documento(chave(1))]);
    const xml = xmlDe(chave(1));
    await servico.criarCheckpoint(inv, 'exec-idempotente');
    const primeira = await servico.persistirXml(inv, chave(1), xml);
    const segunda = await servico.persistirXml(inv, chave(1), xml);
    const direto = await xmls.persistir(CNPJ, PERIODO, chave(1), xml, 'EMITIDA');

    expect(direto.reutilizado).toBe(true);
    expect(estadoDe(primeira, chave(1)).hashSha256).toBe(estadoDe(segunda, chave(1)).hashSha256);
    expect(estadoDe(segunda, chave(1)).estado).toBe('PERSISTIDO');
    expect(await contarXml()).toBe(1);
  });

  it('17 XML diferente na mesma chave é conflito e o arquivo permanece', async () => {
    const inv = inventario([documento(chave(1))]);
    const primeiro = xmlDe(chave(1), { dCompet: '2026-01' });
    const segundo = xmlDe(chave(1), { dCompet: '2026-02' });
    await servico.criarCheckpoint(inv, 'exec-conflito');
    await servico.persistirXml(inv, chave(1), primeiro);
    const destino = xmls.caminhoArquivo(CNPJ, PERIODO, chave(1));

    await expect(servico.persistirXml(inv, chave(1), segundo)).rejects.toMatchObject({ codigo: 'CONFLITO_HASH' });
    expect(await readFile(destino, 'utf8')).toBe(primeiro);
    expect(estadoDe((await checkpoints.carregar(CNPJ, PERIODO)) as CheckpointNfse, chave(1)).estado).toBe('PERSISTIDO');
    expect(await contarXml()).toBe(1);
  });

  it('18 interrupção antes do rename não publica o XML', async () => {
    const inv = inventario([documento(chave(1))]);
    const xmlStore = new XmlStore(path.join(raiz, 'xml'), {
      antesDoRename: () => {
        throw new Error('interrupcao-rename');
      },
    });
    const local = new CheckpointService(checkpoints, xmlStore);
    await local.criarCheckpoint(inv, 'exec-rename');

    await expect(local.persistirXml(inv, chave(1), xmlDe(chave(1)))).rejects.toMatchObject({ codigo: 'FALHA_ESCRITA' });
    expect(existsSync(xmlStore.caminhoArquivo(CNPJ, PERIODO, chave(1)))).toBe(false);
    expect(estadoDe((await checkpoints.carregar(CNPJ, PERIODO)) as CheckpointNfse, chave(1)).estado).toBe('PENDENTE');
  });

  it('19 interrupção depois do XML não marca persistido sem hash conferido', async () => {
    const inv = inventario([documento(chave(1))]);
    const xml = xmlDe(chave(1));
    let bloquear = false;
    const store = new CheckpointStore(path.join(raiz, 'checkpoints'), {
      antesDoRename: () => {
        if (bloquear) throw new Error('interrupcao-checkpoint');
      },
    });
    const local = new CheckpointService(store, xmls);
    await local.criarCheckpoint(inv, 'exec-pos-xml');
    bloquear = true;

    await expect(local.persistirXml(inv, chave(1), xml)).rejects.toMatchObject({ codigo: 'FALHA_ESCRITA' });
    expect(existsSync(xmls.caminhoArquivo(CNPJ, PERIODO, chave(1)))).toBe(true);
    expect(estadoDe((await store.carregar(CNPJ, PERIODO)) as CheckpointNfse, chave(1)).estado).toBe('PENDENTE');
    bloquear = false;

    const retomado = await retomarExecucaoNfse({ inventario: inv, checkpointStore: store, xmlStore: xmls });
    const revisto = estadoDe(retomado.checkpoint, chave(1));
    expect(revisto.estado).toBe('PERSISTIDO');
    expect(revisto.hashSha256).toBe(hashSha256Conteudo(Buffer.from(xml, 'utf8')));
    expect(await readFile(xmls.caminhoArquivo(CNPJ, PERIODO, chave(1)), 'utf8')).toBe(xml);
    expect(await contarXml()).toBe(1);

    const reutilizado = await local.persistirXml(inv, chave(1), xml);
    expect(estadoDe(reutilizado, chave(1)).estado).toBe('PERSISTIDO');
    expect(await contarXml()).toBe(1);
  });

  it('20 interrupção antes de salvar o checkpoint preserva o JSON anterior', async () => {
    const inv = inventario([documento(chave(1))]);
    let bloquear = false;
    const store = new CheckpointStore(path.join(raiz, 'checkpoints'), {
      antesDoRename: () => {
        if (bloquear) throw new Error('interrupcao-json');
      },
    });
    const local = new CheckpointService(store, xmls);
    await local.criarCheckpoint(inv, 'exec-json');
    const arquivo = store.caminhoArquivo(CNPJ, PERIODO);
    const anterior = await readFile(arquivo);

    bloquear = true;
    await expect(local.persistirXml(inv, chave(1), xmlDe(chave(1)))).rejects.toMatchObject({ codigo: 'FALHA_ESCRITA' });
    expect(await readFile(arquivo)).toEqual(anterior);
    expect(JSON.parse(anterior.toString('utf8')).documentos[0].estado).toBe('PENDENTE');
  });

  it('21 retomada mantém pendente sem consultar a SEFIN', async () => {
    const inv = inventario([documento(chave(1)), documento(chave(2))]);
    await servico.criarCheckpoint(inv, 'exec-pendente');
    await servico.persistirXml(inv, chave(1), xmlDe(chave(1)));

    const retomado = await retomarExecucaoNfse({ inventario: inv, checkpointStore: checkpoints, xmlStore: xmls });
    expect(estadoDe(retomado.checkpoint, chave(2)).estado).toBe('PENDENTE');
    expect(estadoDe(retomado.checkpoint, chave(1)).estado).toBe('PERSISTIDO');
    expect(retomado.podeRetomarAutomaticamente).toBe(true);
    expect(retomado.alteracoes).toEqual([]);
    expect(await contarXml()).toBe(1);
  });

  it('22 EM_PROCESSAMENTO com XML sem estrutura fiscal volta a pendente e não promove', async () => {
    const inv = inventario([documento(chave(1))]);
    await servico.criarCheckpoint(inv, 'exec-processando');
    await servico.marcarEmProcessamento(inv, chave(1));
    const xml = xmlTextoFraco(chave(1));
    const destino = await gravarXmlDireto(chave(1), xml);

    const retomado = await retomarExecucaoNfse({ inventario: inv, checkpointStore: checkpoints, xmlStore: xmls });
    const revisto = estadoDe(retomado.checkpoint, chave(1));
    expect(revisto.estado).toBe('PENDENTE');
    expect(revisto.hashSha256).toBeNull();
    expect(revisto.codigo).toBe('XML_NAO_CONFIRMADO');
    expect(retomado.alteracoes).toEqual([
      expect.objectContaining({ chaveNacional: chave(1), de: 'EM_PROCESSAMENTO', para: 'PENDENTE' }),
    ]);
    expect(await readFile(destino, 'utf8')).toBe(xml);
    const deNovo = await retomarExecucaoNfse({ inventario: inv, checkpointStore: checkpoints, xmlStore: xmls });
    expect(estadoDe(deNovo.checkpoint, chave(1)).estado).toBe('PENDENTE');
    expect(deNovo.alteracoes).toEqual([]);
  });

  it('23 falha transitória permanece elegível e a retomada não tenta de novo', async () => {
    const inv = inventario([documento(chave(1))]);
    const xml = xmlDe(chave(1));
    await servico.criarCheckpoint(inv, 'exec-transitoria');
    await servico.registrarFalha(inv, chave(1), 'TRANSITORIA', 'timeout simulado', 'TIMEOUT');

    const retomado = await retomarExecucaoNfse({ inventario: inv, checkpointStore: checkpoints, xmlStore: xmls });
    expect(estadoDe(retomado.checkpoint, chave(1)).estado).toBe('FALHA_TRANSITORIA');
    expect(estadoDe(retomado.checkpoint, chave(1)).diagnostico).toBe('timeout simulado');
    expect(await contarXml()).toBe(0);
    const segunda = await retomarExecucaoNfse({ inventario: inv, checkpointStore: checkpoints, xmlStore: xmls });
    expect(estadoDe(segunda.checkpoint, chave(1)).codigo).toBe('TIMEOUT');

    const controlada = await servico.persistirXml(inv, chave(1), xml);
    expect(estadoDe(controlada, chave(1)).estado).toBe('PERSISTIDO');
  });

  it('24 falha permanente preserva o diagnóstico', async () => {
    const inv = inventario([documento(chave(1))]);
    await servico.criarCheckpoint(inv, 'exec-permanente');
    await servico.registrarFalha(inv, chave(1), 'PERMANENTE', 'nota inexistente na SEFIN', 'HTTP_404');

    const retomado = await retomarExecucaoNfse({ inventario: inv, checkpointStore: checkpoints, xmlStore: xmls });
    const doc = estadoDe(retomado.checkpoint, chave(1));
    expect(doc.estado).toBe('FALHA_PERMANENTE');
    expect(doc.diagnostico).toBe('nota inexistente na SEFIN');
    expect(doc.codigo).toBe('HTTP_404');
    await expect(servico.persistirXml(inv, chave(1), xmlDe(chave(1)))).rejects.toMatchObject({
      codigo: 'DOCUMENTO_NAO_ELEGIVEL',
    });
    expect(estadoDe((await checkpoints.carregar(CNPJ, PERIODO)) as CheckpointNfse, chave(1)).diagnostico).toBe(
      'nota inexistente na SEFIN'
    );
  });

  it('API-03H — VALIDACAO_INSUFICIENTE sem XML reabre PENDENTE; íntegros ficam', async () => {
    const inv = inventario([documento(chave(1)), documento(chave(2)), documento(chave(3))]);
    await servico.criarCheckpoint(inv, 'exec-cts-reabertura');
    await servico.persistirXml(inv, chave(1), xmlDe(chave(1)));
    await servico.registrarFalha(
      inv,
      chave(2),
      'PERMANENTE',
      'O XML não permite confirmar a chave e o vínculo com o CNPJ.',
      'VALIDACAO_INSUFICIENTE'
    );
    await servico.registrarFalha(
      inv,
      chave(3),
      'PERMANENTE',
      'O XML não permite confirmar a chave e o vínculo com o CNPJ.',
      'VALIDACAO_INSUFICIENTE'
    );

    const retomado = await retomarExecucaoNfse({ inventario: inv, checkpointStore: checkpoints, xmlStore: xmls });
    expect(estadoDe(retomado.checkpoint, chave(1)).estado).toBe('PERSISTIDO');
    expect(estadoDe(retomado.checkpoint, chave(2)).estado).toBe('PENDENTE');
    expect(estadoDe(retomado.checkpoint, chave(2)).codigo).toBe('REABERTURA_VALIDACAO');
    expect(estadoDe(retomado.checkpoint, chave(3)).estado).toBe('PENDENTE');
    expect(retomado.alteracoes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ chaveNacional: chave(2), de: 'FALHA_PERMANENTE', para: 'PENDENTE' }),
        expect.objectContaining({ chaveNacional: chave(3), de: 'FALHA_PERMANENTE', para: 'PENDENTE' }),
      ])
    );
    // XML íntegro pré-existente não foi tocado.
    expect(await xmls.verificar(CNPJ, PERIODO, chave(1))).toMatchObject({
      existe: true,
      tamanhoBytes: expect.any(Number),
    });
    expect(await contarXml()).toBe(1);
  });

  it('API-03I — FALHA_TRANSITORIA VALIDACAO_INSUFICIENTE também reabre (CTS 178/180)', async () => {
    const inv = inventario([documento(chave(1)), documento(chave(2))]);
    await servico.criarCheckpoint(inv, 'exec-cts-transitoria');
    await servico.persistirXml(inv, chave(1), xmlDe(chave(1)));
    await servico.registrarFalha(
      inv,
      chave(2),
      'TRANSITORIA',
      'O XML não permite confirmar a chave e o vínculo com o CNPJ.',
      'VALIDACAO_INSUFICIENTE'
    );

    const retomado = await retomarExecucaoNfse({ inventario: inv, checkpointStore: checkpoints, xmlStore: xmls });
    expect(estadoDe(retomado.checkpoint, chave(1)).estado).toBe('PERSISTIDO');
    expect(estadoDe(retomado.checkpoint, chave(2))).toMatchObject({
      estado: 'PENDENTE',
      codigo: 'REABERTURA_VALIDACAO',
    });
    expect(retomado.alteracoes).toEqual([
      expect.objectContaining({ chaveNacional: chave(2), de: 'FALHA_TRANSITORIA', para: 'PENDENTE' }),
    ]);
  });

  it('API-03H — checkpoint inconsistente PERSISTIDO sem arquivo volta a PENDENTE', async () => {
    const inv = inventario([documento(chave(1))]);
    await servico.criarCheckpoint(inv, 'exec-inconsistente-ausente');
    await servico.persistirXml(inv, chave(1), xmlDe(chave(1)));
    await rm(xmls.caminhoArquivo(CNPJ, PERIODO, chave(1)), { force: true });

    const retomado = await retomarExecucaoNfse({ inventario: inv, checkpointStore: checkpoints, xmlStore: xmls });
    expect(estadoDe(retomado.checkpoint, chave(1)).estado).toBe('PENDENTE');
    expect(estadoDe(retomado.checkpoint, chave(1)).codigo).toBe('XML_AUSENTE');
  });

  it('25 cancelada fica fora da recuperação e do denominador da cobertura', async () => {
    const inv = inventario([documento(chave(1)), documento(chave(2), { situacao: 'CANCELADA' })]);
    await servico.criarCheckpoint(inv, 'exec-cancelada');
    await expect(servico.persistirXml(inv, chave(2), xmlDe(chave(2)))).rejects.toMatchObject({
      codigo: 'DOCUMENTO_NAO_ELEGIVEL',
    });
    const checkpoint = await servico.persistirXml(inv, chave(1), xmlDe(chave(1)));
    const relatorio = reconciliarNfse(inv, checkpoint, [await xmls.verificar(CNPJ, PERIODO, chave(1))]);

    expect(estadoDe(checkpoint, chave(2)).estado).toBe('EXCLUIDA_DA_RECUPERACAO');
    expect(relatorio.canceladas).toBe(1);
    expect(relatorio.vigentes).toBe(1);
    expect(relatorio.cobertura).toBe(1);
    expect(relatorio.falhaPermanente).toBe(0);
    expect(relatorio.conclusao).toBe('RECONCILIADA');
  });

  it('26 indeterminada permite retomada e persiste XML com atenção (API-03M)', async () => {
    const inv = inventario([documento(chave(1)), documento(chave(2), { situacao: 'INDETERMINADA' })]);
    const criado = await servico.criarCheckpoint(inv, 'exec-atencao');
    expect(estadoDe(criado, chave(2)).estado).toBe('PENDENTE');
    expect(estadoDe(criado, chave(2)).codigo).toBe('ATENCAO_SITUACAO_NAO_CONFIRMADA');

    const vigente = await servico.persistirXml(inv, chave(1), xmlDe(chave(1)));
    expect(estadoDe(vigente, chave(1)).estado).toBe('PERSISTIDO');
    const indeterminada = await servico.persistirXml(inv, chave(2), xmlDe(chave(2)));
    expect(estadoDe(indeterminada, chave(2)).estado).toBe('PERSISTIDO');
    expect(estadoDe(indeterminada, chave(2)).codigo).toBe('ATENCAO_SITUACAO_NAO_CONFIRMADA');

    const retomado = await retomarExecucaoNfse({ inventario: inv, checkpointStore: checkpoints, xmlStore: xmls });
    expect(retomado.podeRetomarAutomaticamente).toBe(true);
    expect(retomado.codigoBloqueio).toBeNull();
    expect(await contarXml()).toBe(2);

    const arquivos = [
      await xmls.verificar(CNPJ, PERIODO, chave(1)),
      await xmls.verificar(CNPJ, PERIODO, chave(2)),
    ];
    const relatorio = reconciliarNfse(inv, indeterminada, arquivos);
    expect(relatorio.persistidosIntegros).toBe(1);
    expect(relatorio.xmlsComAtencaoFiscal).toBe(1);
    expect(relatorio.conclusao).toBe('NAO_RECONCILIADA');
  });

  it('27 reconciliação completa ignora dCompet e não usa sucesso HTTP', async () => {
    const inv = inventario([
      documento(chave(1), { dCompet: '2024-01' }),
      documento(chave(2), { direcao: 'RECEBIDA' }),
      documento(chave(3), { situacao: 'CANCELADA' }),
    ]);
    await servico.criarCheckpoint(inv, 'exec-completa');
    await servico.persistirXml(inv, chave(1), xmlDe(chave(1)));
    const checkpoint = await servico.persistirXml(
      inv,
      chave(2),
      xmlDe(chave(2), { emitente: OUTRO_CNPJ, tomador: CNPJ })
    );
    const relatorio = reconciliarNfse(inv, checkpoint, await verificarVigentes(inv, checkpoint));

    expect(relatorio.conclusao).toBe('RECONCILIADA');
    expect(relatorio.descobertos).toBe(3);
    expect(relatorio.vigentes).toBe(2);
    expect(relatorio.canceladas).toBe(1);
    expect(relatorio.indeterminadas).toBe(0);
    expect(relatorio.persistidosIntegros).toBe(2);
    expect(relatorio.pendentes).toBe(0);
    expect(relatorio.chavesFaltantes).toEqual([]);
    expect(relatorio.chavesExcedentes).toEqual([]);
    expect(relatorio.divergenciasHash).toEqual([]);
    expect(relatorio.identidadeConsistente).toBe(true);
  });

  it('28 reconciliação parcial não conclui', async () => {
    const inv = inventario([documento(chave(1)), documento(chave(2))]);
    await servico.criarCheckpoint(inv, 'exec-parcial-rec');
    const checkpoint = await servico.persistirXml(inv, chave(1), xmlDe(chave(1)));
    const relatorio = reconciliarNfse(inv, checkpoint, await verificarVigentes(inv, checkpoint));

    expect(relatorio.conclusao).toBe('NAO_RECONCILIADA');
    expect(relatorio.pendentes).toBe(1);
    expect(relatorio.persistidosIntegros).toBe(1);
  });

  it('29 inconsistência impede a conclusão', async () => {
    const inv = inventario([documento(chave(1))]);
    await servico.criarCheckpoint(inv, 'exec-inconsistencia');
    const checkpoint = await servico.persistirXml(inv, chave(1), xmlDe(chave(1), { dCompet: '2026-01' }));
    const divergente = xmlDe(chave(1), { dCompet: '2026-02' });
    const relatorio = reconciliarNfse(inv, checkpoint, [arquivoDe(chave(1), divergente)]);

    expect(relatorio.conclusao).toBe('NAO_RECONCILIADA');
    expect(relatorio.inconsistencias).toBeGreaterThan(0);
    expect(relatorio.divergenciasHash).toContain(chave(1));
  });

  it('30 cobertura de 100% quando todos os vigentes estão íntegros', async () => {
    const inv = inventario([documento(chave(1)), documento(chave(2))]);
    await servico.criarCheckpoint(inv, 'exec-cem');
    await servico.persistirXml(inv, chave(1), xmlDe(chave(1)));
    const checkpoint = await servico.persistirXml(inv, chave(2), xmlDe(chave(2)));
    const relatorio = reconciliarNfse(inv, checkpoint, await verificarVigentes(inv, checkpoint));

    expect(relatorio.cobertura).toBe(1);
    expect(relatorio.persistidosIntegros).toBe(2);
    expect(relatorio.conclusao).toBe('RECONCILIADA');
  });

  it('31 cobertura parcial é a fração dos vigentes íntegros', async () => {
    const inv = inventario([documento(chave(1)), documento(chave(2))]);
    await servico.criarCheckpoint(inv, 'exec-meia');
    const checkpoint = await servico.persistirXml(inv, chave(1), xmlDe(chave(1)));
    const relatorio = reconciliarNfse(inv, checkpoint, await verificarVigentes(inv, checkpoint));

    expect(relatorio.cobertura).toBe(0.5);
    expect(relatorio.conclusao).toBe('NAO_RECONCILIADA');
  });

  it('32 zero vigentes usa cobertura 1 só sem inconsistência bloqueante', async () => {
    const soCancelada = inventario([documento(chave(1), { situacao: 'CANCELADA' })]);
    const checkpointCancelada = await servico.criarCheckpoint(soCancelada, 'exec-zero');
    const relatorio = reconciliarNfse(soCancelada, checkpointCancelada, []);
    expect(relatorio.vigentes).toBe(0);
    expect(relatorio.cobertura).toBe(1);
    expect(relatorio.conclusao).toBe('RECONCILIADA');

    const soIndeterminada = inventario([documento(chave(4), { situacao: 'INDETERMINADA' })]);
    const storeIndeterminada = new CheckpointStore(path.join(raiz, 'checkpoints-ind'));
    const criada = await new CheckpointService(storeIndeterminada, xmls).criarCheckpoint(soIndeterminada, 'exec-ind');
    const bloqueada = reconciliarNfse(soIndeterminada, criada, []);
    expect(bloqueada.cobertura).toBe(1);
    expect(bloqueada.conclusao).toBe('NAO_RECONCILIADA');
    expect(bloqueada.indeterminadas).toBe(1);

    const comExcedente = reconciliarNfse(soCancelada, checkpointCancelada, [arquivoDe(chave(9), xmlDe(chave(9)))]);
    expect(comExcedente.vigentes).toBe(0);
    expect(comExcedente.cobertura).toBe(0);
    expect(comExcedente.conclusao).toBe('NAO_RECONCILIADA');
  });

  it('33 chave excedente não justificada impede a conclusão', async () => {
    const inv = inventario([documento(chave(1))]);
    await servico.criarCheckpoint(inv, 'exec-excedente');
    const checkpoint = await servico.persistirXml(inv, chave(1), xmlDe(chave(1)));
    const relatorio = reconciliarNfse(inv, checkpoint, [
      ...(await verificarVigentes(inv, checkpoint)),
      arquivoDe(chave(9), xmlDe(chave(9))),
    ]);

    expect(relatorio.chavesExcedentes).toContain(chave(9));
    expect(relatorio.cobertura).toBe(1);
    expect(relatorio.conclusao).toBe('NAO_RECONCILIADA');
  });

  it('34 chave faltante no checkpoint impede a conclusão', async () => {
    const inv = inventario([documento(chave(1)), documento(chave(2))]);
    await servico.criarCheckpoint(inv, 'exec-faltante');
    const checkpoint = await servico.persistirXml(inv, chave(1), xmlDe(chave(1)));
    const semASegunda: CheckpointNfse = {
      ...checkpoint,
      documentos: checkpoint.documentos.filter((documento) => documento.chaveNacional !== chave(2)),
    };
    const relatorio = reconciliarNfse(inv, semASegunda, await verificarVigentes(inv, checkpoint));

    expect(relatorio.chavesFaltantes).toEqual([chave(2)]);
    expect(relatorio.conclusao).toBe('NAO_RECONCILIADA');
  });

  it('35 duplicidade de chave impede a conclusão', async () => {
    const inv = inventario([documento(chave(1))]);
    await servico.criarCheckpoint(inv, 'exec-duplicada');
    const checkpoint = await servico.persistirXml(inv, chave(1), xmlDe(chave(1)));
    const arquivo = arquivoDe(chave(1), xmlDe(chave(1)));
    const porArquivo = reconciliarNfse(inv, checkpoint, [arquivo, { ...arquivo }]);
    const porCheckpoint = reconciliarNfse(
      inv,
      { ...checkpoint, documentos: [...checkpoint.documentos, checkpoint.documentos[0]] },
      [arquivo]
    );

    expect(porArquivo.chavesDuplicadas).toContain(chave(1));
    expect(porCheckpoint.chavesDuplicadas).toContain(chave(1));
    expect(porArquivo.conclusao).toBe('NAO_RECONCILIADA');
    expect(porCheckpoint.conclusao).toBe('NAO_RECONCILIADA');
  });

  it('36 path traversal é recusado e não escreve fora da raiz', async () => {
    expect(codigoSincrono(() => resolverCaminhoSeguro(raiz, ['..']))).toBe('CAMINHO_INVALIDO');
    expect(codigoSincrono(() => resolverCaminhoSeguro(raiz, ['/etc/passwd']))).toBe('CAMINHO_INVALIDO');
    expect(codigoSincrono(() => resolverCaminhoSeguro(raiz, ['a/b']))).toBe('CAMINHO_INVALIDO');
    expect(codigoSincrono(() => resolverCaminhoSeguro(raiz, ['a\\b']))).toBe('CAMINHO_INVALIDO');
    expect(
      codigoSincrono(() => segmentoPeriodo({ tipo: 'PERIODO_CONSULTA_PORTAL', inicio: '../08/2026', fim: '30/09/2026' }))
    ).toBe('CAMINHO_INVALIDO');
    await expect(xmls.persistir('..', PERIODO, chave(1), xmlDe(chave(1)), 'EMITIDA')).rejects.toMatchObject({
      codigo: 'CAMINHO_INVALIDO',
    });
    await expect(xmls.persistir(CNPJ, PERIODO, `${'1'.repeat(49)}x`, '<NFSe/>', 'EMITIDA')).rejects.toMatchObject({
      codigo: 'CAMINHO_INVALIDO',
    });
    expect(existsSync(path.join(raiz, '..', 'nfse-escape.xml'))).toBe(false);
  });

  it('37 falha de escrita não publica XML nem altera o checkpoint', async () => {
    const inv = inventario([documento(chave(1))]);
    const xmlStore = new XmlStore(path.join(raiz, 'xml'), {
      antesDaEscrita: () => {
        throw new Error('disco cheio');
      },
    });
    const local = new CheckpointService(checkpoints, xmlStore);
    await local.criarCheckpoint(inv, 'exec-disco');
    const antes = await readFile(checkpoints.caminhoArquivo(CNPJ, PERIODO));

    await expect(local.persistirXml(inv, chave(1), xmlDe(chave(1)))).rejects.toMatchObject({ codigo: 'FALHA_ESCRITA' });
    expect(existsSync(xmlStore.caminhoArquivo(CNPJ, PERIODO, chave(1)))).toBe(false);
    expect(await readFile(checkpoints.caminhoArquivo(CNPJ, PERIODO))).toEqual(antes);
  });

  it('38 checkpoint de outra empresa é recusado sem ser reescrito', async () => {
    const inv = inventario([documento(chave(1))]);
    await servico.criarCheckpoint(inv, 'exec-outra');
    const arquivo = checkpoints.caminhoArquivo(CNPJ, PERIODO);
    await reescrever((json) => {
      json.cnpj = OUTRO_CNPJ;
    });

    await expect(retomarExecucaoNfse({ inventario: inv, checkpointStore: checkpoints, xmlStore: xmls })).rejects.toMatchObject({
      codigo: 'IDENTIDADE_DIVERGENTE',
    });
    expect(JSON.parse(await readFile(arquivo, 'utf8')).cnpj).toBe(OUTRO_CNPJ);
  });

  it('39 execução repetida reencontra o mesmo checkpoint e o mesmo arquivo', async () => {
    const inv = inventario([documento(chave(1))]);
    const xml = xmlDe(chave(1));
    await servico.criarCheckpoint(inv, 'exec-original');
    await servico.persistirXml(inv, chave(1), xml);
    const repetida = await servico.criarCheckpoint(inv, 'exec-nova');

    expect(repetida.execucaoId).toBe('exec-original');
    expect(estadoDe(repetida, chave(1)).estado).toBe('PERSISTIDO');
    expect(repetida.fingerprintInventario).toBe(calcularFingerprintInventario(inv));
    expect(await contarXml()).toBe(1);
  });

  it('40 concorrência no mesmo checkpoint falha com CHECKPOINT_EM_USO', async () => {
    const inv = inventario([documento(chave(1))]);
    await servico.criarCheckpoint(inv, 'exec-trava');
    let liberar!: () => void;
    const espera = new Promise<void>((resolve) => {
      liberar = resolve;
    });
    let avisar!: () => void;
    const entrouNaOperacao = new Promise<void>((resolve) => {
      avisar = resolve;
    });
    let entrou = 0;
    let ocupacaoResolvida = false;
    const ocupacao = checkpoints
      .comTrava(CNPJ, PERIODO, async () => {
        entrou += 1;
        avisar();
        await espera;
      })
      .then(() => {
        ocupacaoResolvida = true;
      });

    await entrouNaOperacao;
    try {
      await expect(checkpoints.comTrava(CNPJ, PERIODO, async () => {
        entrou += 1;
      })).rejects.toMatchObject({ codigo: 'CHECKPOINT_EM_USO' });
      await expect(servico.persistirXml(inv, chave(1), xmlDe(chave(1)))).rejects.toMatchObject({
        codigo: 'CHECKPOINT_EM_USO',
      });
      expect(entrou).toBe(1);
      expect(ocupacaoResolvida).toBe(false);
      expect(await contarXml()).toBe(0);
    } finally {
      liberar();
      await ocupacao;
    }
    const depois = await servico.persistirXml(inv, chave(1), xmlDe(chave(1)));
    expect(estadoDe(depois, chave(1)).estado).toBe('PERSISTIDO');
  });

  it('41 XML gravado sem atualizar o checkpoint continua pendente antes da retomada', async () => {
    const inv = inventario([documento(chave(1))]);
    await servico.criarCheckpoint(inv, 'exec-orfao-antes');
    const xml = xmlFiscal(chave(1));
    const destino = await gravarXmlDireto(chave(1), xml);

    const checkpoint = await checkpoints.carregar(CNPJ, PERIODO);
    const doc = estadoDe(checkpoint as CheckpointNfse, chave(1));
    expect(doc.estado).toBe('PENDENTE');
    expect(doc.hashSha256).toBeNull();
    expect(doc.caminhoRelativo).toBeNull();
    expect(await readFile(destino, 'utf8')).toBe(xml);
  });

  it('42 XML órfão válido de pendente e de EM_PROCESSAMENTO vira PERSISTIDO', async () => {
    const inv = inventario([documento(chave(1)), documento(chave(2))]);
    await servico.criarCheckpoint(inv, 'exec-orfao-valido');
    await servico.marcarEmProcessamento(inv, chave(2));
    const xmlPendente = xmlFiscal(chave(1));
    const xmlProcessando = xmlFiscal(chave(2));
    const destinoPendente = await gravarXmlDireto(chave(1), xmlPendente);
    const destinoProcessando = await gravarXmlDireto(chave(2), xmlProcessando);
    const bytesPendente = await readFile(destinoPendente);
    const bytesProcessando = await readFile(destinoProcessando);

    const retomado = await retomarExecucaoNfse({ inventario: inv, checkpointStore: checkpoints, xmlStore: xmls });
    const pendente = estadoDe(retomado.checkpoint, chave(1));
    const processando = estadoDe(retomado.checkpoint, chave(2));

    expect(xmlPendente).toContain('<dCompet>2026-08</dCompet>');
    expect(pendente.estado).toBe('PERSISTIDO');
    expect(processando.estado).toBe('PERSISTIDO');
    expect(pendente.hashSha256).toBe(hashSha256Conteudo(bytesPendente));
    expect(processando.hashSha256).toBe(hashSha256Conteudo(bytesProcessando));
    expect(pendente.caminhoRelativo).toBe(xmls.caminhoRelativo(CNPJ, PERIODO, chave(1)));
    expect(pendente.tamanhoBytes).toBe(bytesPendente.length);
    expect(await readFile(destinoPendente)).toEqual(bytesPendente);
    expect(await readFile(destinoProcessando)).toEqual(bytesProcessando);
    expect(retomado.alteracoes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ chaveNacional: chave(1), de: 'PENDENTE', para: 'PERSISTIDO' }),
        expect.objectContaining({ chaveNacional: chave(2), de: 'EM_PROCESSAMENTO', para: 'PERSISTIDO' }),
      ])
    );
  });

  it('43 XML órfão de outra empresa fica inconsistente e o arquivo permanece', async () => {
    const inv = inventario([documento(chave(1)), documento(chave(2))]);
    await servico.criarCheckpoint(inv, 'exec-outra-empresa');
    const deOutra = xmlFiscal(chave(1), { emitente: OUTRO_CNPJ });
    const soNoIntermediario = xmlComIntermediario(chave(2));
    const destinoOutra = await gravarXmlDireto(chave(1), deOutra);
    const destinoIntermediario = await gravarXmlDireto(chave(2), soNoIntermediario);

    const retomado = await retomarExecucaoNfse({ inventario: inv, checkpointStore: checkpoints, xmlStore: xmls });
    expect(estadoDe(retomado.checkpoint, chave(1))).toMatchObject({
      estado: 'INCONSISTENTE',
      codigo: 'CNPJ_DIVERGENTE',
      hashSha256: null,
    });
    expect(estadoDe(retomado.checkpoint, chave(2))).toMatchObject({
      estado: 'INCONSISTENTE',
      codigo: 'CNPJ_DIVERGENTE',
      hashSha256: null,
    });
    expect(await readFile(destinoOutra, 'utf8')).toBe(deOutra);
    expect(await readFile(destinoIntermediario, 'utf8')).toBe(soNoIntermediario);
  });

  it('44 XML órfão com chave divergente fica inconsistente', async () => {
    const inv = inventario([documento(chave(1))]);
    await servico.criarCheckpoint(inv, 'exec-chave-divergente');
    const xml = xmlFiscal(chave(1), { chaveXml: chave(2) });
    const destino = await gravarXmlDireto(chave(1), xml);

    const retomado = await retomarExecucaoNfse({ inventario: inv, checkpointStore: checkpoints, xmlStore: xmls });
    expect(estadoDe(retomado.checkpoint, chave(1))).toMatchObject({
      estado: 'INCONSISTENTE',
      codigo: 'CHAVE_DIVERGENTE',
      hashSha256: null,
    });
    expect(await readFile(destino, 'utf8')).toBe(xml);
  });

  it('45 XML órfão malformado ou acima do limite fica inconsistente', async () => {
    const inv = inventario([documento(chave(1)), documento(chave(2))]);
    await servico.criarCheckpoint(inv, 'exec-malformado');
    const quebrado = `<NFSe><infNFSe><chNFSe>${chave(1)}</chNFSe>`;
    const destinoQuebrado = await gravarXmlDireto(chave(1), quebrado);
    const destinoGrande = xmls.caminhoArquivo(CNPJ, PERIODO, chave(2));
    await mkdir(path.dirname(destinoGrande), { recursive: true });
    const grande = await open(destinoGrande, 'w');
    await grande.truncate(LIMITES_RECUPERACAO_PADRAO.maxBytesXml + 1);
    await grande.close();

    const retomado = await retomarExecucaoNfse({ inventario: inv, checkpointStore: checkpoints, xmlStore: xmls });
    expect(estadoDe(retomado.checkpoint, chave(1))).toMatchObject({
      estado: 'INCONSISTENTE',
      codigo: 'XML_MALFORMADO',
    });
    expect(estadoDe(retomado.checkpoint, chave(2))).toMatchObject({
      estado: 'INCONSISTENTE',
      codigo: 'XML_EXCEDE_LIMITE',
      tamanhoBytes: LIMITES_RECUPERACAO_PADRAO.maxBytesXml + 1,
    });
    expect(await readFile(destinoQuebrado, 'utf8')).toBe(quebrado);
    expect((await stat(destinoGrande)).size).toBe(LIMITES_RECUPERACAO_PADRAO.maxBytesXml + 1);
  });

  it('46 XML órfão com direção incorreta fica inconsistente', async () => {
    const inv = inventario([documento(chave(1), { direcao: 'RECEBIDA' })]);
    await servico.criarCheckpoint(inv, 'exec-direcao');
    const xml = xmlFiscal(chave(1), { emitente: CNPJ, tomador: TOMADOR });
    const destino = await gravarXmlDireto(chave(1), xml);

    const retomado = await retomarExecucaoNfse({ inventario: inv, checkpointStore: checkpoints, xmlStore: xmls });
    const doc = estadoDe(retomado.checkpoint, chave(1));
    expect(doc.estado).toBe('INCONSISTENTE');
    expect(doc.codigo).toBe('CNPJ_DIVERGENTE');
    expect(doc.diagnostico).toMatch(/tomador/);
    expect(doc.hashSha256).toBeNull();
    expect(await readFile(destino, 'utf8')).toBe(xml);
  });

  it('47 o hash do órfão válido promovido confere com os bytes do arquivo', async () => {
    const inv = inventario([documento(chave(1))]);
    await servico.criarCheckpoint(inv, 'exec-hash-orfao');
    const xml = xmlFiscal(chave(1));
    const destino = await gravarXmlDireto(chave(1), xml);

    const retomado = await retomarExecucaoNfse({ inventario: inv, checkpointStore: checkpoints, xmlStore: xmls });
    const bytes = await readFile(destino);
    const doc = estadoDe(retomado.checkpoint, chave(1));
    expect(doc.estado).toBe('PERSISTIDO');
    expect(doc.hashSha256).toBe(hashSha256Conteudo(bytes));
    expect(doc.hashSha256).toBe(hashSha256Conteudo(Buffer.from(xml, 'utf8')));
    expect(doc.tamanhoBytes).toBe(bytes.length);
  });

  it('48 a retomada não importa cliente HTTP nem o transporte da SEFIN', async () => {
    const diretorio = path.dirname(fileURLToPath(import.meta.url));
    const fontes = (await readdir(diretorio)).filter((nome) => nome.endsWith('.ts') && !nome.endsWith('.test.ts'));
    expect(fontes.length).toBeGreaterThan(0);
    for (const nome of fontes) {
      const fonte = await readFile(path.join(diretorio, nome), 'utf8');
      expect(fonte).not.toMatch(/sefin-client|recovery-service|node:https|node:http|criarTransporteHttpsMtls|recuperarXmlNfse/);
      expect(fonte).not.toMatch(/from ['"]https['"]|from ['"]http['"]|from ['"]node:https['"]|from ['"]node:http['"]/);
    }
    const retomada = await readFile(path.join(diretorio, 'resume-service.ts'), 'utf8');
    expect(retomada).toMatch(/validarXmlNfse/);
    expect(retomada).toMatch(/xml-validator/);
    const persistencia = await readFile(path.join(diretorio, 'xml-store.ts'), 'utf8');
    expect(persistencia).toMatch(/validarXmlNfse/);
    expect(persistencia).toMatch(/xml-validator/);
    expect(persistencia).not.toMatch(/xml\.includes\(chave/);
  });

  it('49 arquivo íntegro já PERSISTIDO permanece sem regravação', async () => {
    const inv = inventario([documento(chave(1))]);
    const xml = xmlFiscal(chave(1));
    await servico.criarCheckpoint(inv, 'exec-ja-persistido');
    await servico.persistirXml(inv, chave(1), xml);
    const destino = xmls.caminhoArquivo(CNPJ, PERIODO, chave(1));
    const antes = await readFile(destino);
    const modificado = (await stat(destino)).mtimeMs;

    const retomado = await retomarExecucaoNfse({ inventario: inv, checkpointStore: checkpoints, xmlStore: xmls });
    expect(estadoDe(retomado.checkpoint, chave(1)).estado).toBe('PERSISTIDO');
    expect(retomado.alteracoes).toEqual([]);
    expect(await readFile(destino)).toEqual(antes);
    expect((await stat(destino)).mtimeMs).toBe(modificado);
    expect(await contarXml()).toBe(1);
  });

  it('50 duas instâncias no mesmo diretório não entram juntas na trava', async () => {
    const inv = inventario([documento(chave(1))]);
    await servico.criarCheckpoint(inv, 'exec-duas-instancias');
    const outra = new CheckpointStore(path.join(raiz, 'checkpoints'));
    const ocupacao = await ocupar(checkpoints);
    let executou = false;

    try {
      await expect(
        outra.comTrava(CNPJ, PERIODO, async () => {
          executou = true;
        })
      ).rejects.toMatchObject({ codigo: 'CHECKPOINT_EM_USO' });
      expect(executou).toBe(false);
      expect(existsSync(checkpoints.caminhoTrava(CNPJ, PERIODO))).toBe(true);
    } finally {
      ocupacao.liberar();
      await ocupacao.concluida;
    }

    await outra.comTrava(CNPJ, PERIODO, async () => {
      executou = true;
    });
    expect(executou).toBe(true);
    expect(existsSync(checkpoints.caminhoTrava(CNPJ, PERIODO))).toBe(false);
  });

  it('51 duas atualizações concorrentes: a segunda falha e não grava', async () => {
    const inv = inventario([documento(chave(1))]);
    await servico.criarCheckpoint(inv, 'exec-atualizacao-concorrente');
    const outroServico = new CheckpointService(new CheckpointStore(path.join(raiz, 'checkpoints')), xmls);
    const ocupacao = await ocupar(checkpoints);

    try {
      await expect(outroServico.persistirXml(inv, chave(1), xmlFiscal(chave(1)))).rejects.toMatchObject({
        codigo: 'CHECKPOINT_EM_USO',
      });
      expect(await contarXml()).toBe(0);
      expect(estadoDe((await checkpoints.carregar(CNPJ, PERIODO)) as CheckpointNfse, chave(1)).estado).toBe('PENDENTE');
    } finally {
      ocupacao.liberar();
      await ocupacao.concluida;
    }

    const depois = await outroServico.persistirXml(inv, chave(1), xmlFiscal(chave(1)));
    expect(estadoDe(depois, chave(1)).estado).toBe('PERSISTIDO');
    expect(await contarXml()).toBe(1);
  });

  it('52 falha ao adquirir a trava não executa a operação nem apaga trava alheia', async () => {
    const filho = await processoQuePermanece();
    const diretorio = checkpoints.caminhoTrava(CNPJ, PERIODO);
    try {
      await plantarTrava(checkpoints, filho.pid as number);
      const donoAntes = await readFile(path.join(diretorio, 'dono.json'), 'utf8');
      let executou = false;
      await expect(
        checkpoints.comTrava(CNPJ, PERIODO, async () => {
          executou = true;
        })
      ).rejects.toMatchObject({ codigo: 'CHECKPOINT_EM_USO' });
      expect(executou).toBe(false);
      expect(await readFile(path.join(diretorio, 'dono.json'), 'utf8')).toBe(donoAntes);

      await rm(diretorio, { recursive: true, force: true });
      await mkdir(diretorio, { recursive: true });
      await expect(
        checkpoints.comTrava(CNPJ, PERIODO, async () => {
          executou = true;
        })
      ).rejects.toMatchObject({ codigo: 'TRAVA_ORFA' });
      expect(executou).toBe(false);
      expect(existsSync(diretorio)).toBe(true);
    } finally {
      await new Promise<void>((resolve) => {
        if (filho.exitCode !== null || filho.signalCode !== null) {
          resolve();
          return;
        }
        filho.once('exit', () => resolve());
        filho.kill('SIGKILL');
      });
      await rm(diretorio, { recursive: true, force: true });
    }

    let depois = false;
    await checkpoints.comTrava(CNPJ, PERIODO, async () => {
      depois = true;
    });
    expect(depois).toBe(true);
    expect(existsSync(diretorio)).toBe(false);
  });

  it('53 a trava é liberada depois de erro na operação', async () => {
    await expect(
      checkpoints.comTrava(CNPJ, PERIODO, async () => {
        throw new Error('falha-negocio');
      })
    ).rejects.toThrow('falha-negocio');
    expect(existsSync(checkpoints.caminhoTrava(CNPJ, PERIODO))).toBe(false);

    let executou = false;
    await checkpoints.comTrava(CNPJ, PERIODO, async () => {
      executou = true;
    });
    expect(executou).toBe(true);
    expect(existsSync(checkpoints.caminhoTrava(CNPJ, PERIODO))).toBe(false);
  });

  it('54 trava de processo encerrado é recuperada e trava deste pid não é roubada', async () => {
    const pid = await pidEncerrado();
    const diretorio = await plantarTrava(checkpoints, pid);
    let executou = false;
    await checkpoints.comTrava(CNPJ, PERIODO, async () => {
      executou = true;
    });
    expect(executou).toBe(true);
    expect(existsSync(diretorio)).toBe(false);

    const nossa = await plantarTrava(checkpoints, process.pid);
    const antes = await readFile(path.join(nossa, 'dono.json'), 'utf8');
    await expect(checkpoints.comTrava(CNPJ, PERIODO, async () => undefined)).rejects.toMatchObject({
      codigo: 'CHECKPOINT_EM_USO',
    });
    expect(await readFile(path.join(nossa, 'dono.json'), 'utf8')).toBe(antes);
    expect(existsSync(nossa)).toBe(true);
  });

  it('55 persistirXml grava XML fiscal válido e CONFIRMADO', async () => {
    const inv = inventario([documento(chave(1))]);
    const xml = xmlFiscal(chave(1));
    await servico.criarCheckpoint(inv, 'exec-fiscal-valido');
    const checkpoint = await servico.persistirXml(inv, chave(1), xml);
    const doc = estadoDe(checkpoint, chave(1));

    expect(doc.estado).toBe('PERSISTIDO');
    expect(doc.hashSha256).toBe(hashSha256Conteudo(Buffer.from(xml, 'utf8')));
    expect(await readFile(xmls.caminhoArquivo(CNPJ, PERIODO, chave(1)), 'utf8')).toBe(xml);
  });

  it('56 persistirXml recusa XML sem infNFSe e não grava arquivo', async () => {
    const inv = inventario([documento(chave(1))]);
    await servico.criarCheckpoint(inv, 'exec-sem-inf');
    const antes = await readFile(checkpoints.caminhoArquivo(CNPJ, PERIODO));

    await expect(servico.persistirXml(inv, chave(1), xmlTextoFraco(chave(1)))).rejects.toMatchObject({
      codigo: 'XML_NAO_CONFIRMADO',
    });
    expect(existsSync(xmls.caminhoArquivo(CNPJ, PERIODO, chave(1)))).toBe(false);
    expect(await readFile(checkpoints.caminhoArquivo(CNPJ, PERIODO))).toEqual(antes);
    expect(estadoDe((await checkpoints.carregar(CNPJ, PERIODO)) as CheckpointNfse, chave(1)).estado).toBe('PENDENTE');
  });

  it('57 persistirXml recusa XML malformado sem gravar', async () => {
    const inv = inventario([documento(chave(1))]);
    await servico.criarCheckpoint(inv, 'exec-malformado-persistir');
    const antes = await readFile(checkpoints.caminhoArquivo(CNPJ, PERIODO));

    await expect(
      servico.persistirXml(inv, chave(1), `<NFSe><infNFSe><chNFSe>${chave(1)}</chNFSe>`)
    ).rejects.toMatchObject({ codigo: 'XML_MALFORMADO' });
    expect(existsSync(xmls.caminhoArquivo(CNPJ, PERIODO, chave(1)))).toBe(false);
    expect(await readFile(checkpoints.caminhoArquivo(CNPJ, PERIODO))).toEqual(antes);
  });

  it('58 persistirXml recusa chave divergente sem gravar', async () => {
    const inv = inventario([documento(chave(1))]);
    await servico.criarCheckpoint(inv, 'exec-chave-persistir');
    const antes = await readFile(checkpoints.caminhoArquivo(CNPJ, PERIODO));

    await expect(servico.persistirXml(inv, chave(1), xmlFiscal(chave(1), { chaveXml: chave(2) }))).rejects.toMatchObject({
      codigo: 'CHAVE_DIVERGENTE',
    });
    expect(existsSync(xmls.caminhoArquivo(CNPJ, PERIODO, chave(1)))).toBe(false);
    expect(await readFile(checkpoints.caminhoArquivo(CNPJ, PERIODO))).toEqual(antes);
  });

  it('59 persistirXml recusa CNPJ divergente sem gravar', async () => {
    const inv = inventario([documento(chave(1))]);
    await servico.criarCheckpoint(inv, 'exec-cnpj-persistir');
    const antes = await readFile(checkpoints.caminhoArquivo(CNPJ, PERIODO));

    await expect(servico.persistirXml(inv, chave(1), xmlFiscal(chave(1), { emitente: OUTRO_CNPJ }))).rejects.toMatchObject({
      codigo: 'CNPJ_DIVERGENTE',
    });
    expect(existsSync(xmls.caminhoArquivo(CNPJ, PERIODO, chave(1)))).toBe(false);
    expect(await readFile(checkpoints.caminhoArquivo(CNPJ, PERIODO))).toEqual(antes);
  });

  it('60 persistirXml recusa direção divergente sem gravar', async () => {
    const inv = inventario([documento(chave(1), { direcao: 'RECEBIDA' })]);
    await servico.criarCheckpoint(inv, 'exec-direcao-persistir');
    const antes = await readFile(checkpoints.caminhoArquivo(CNPJ, PERIODO));

    await expect(
      servico.persistirXml(inv, chave(1), xmlFiscal(chave(1), { emitente: CNPJ, tomador: TOMADOR }))
    ).rejects.toMatchObject({ codigo: 'CNPJ_DIVERGENTE' });
    expect(existsSync(xmls.caminhoArquivo(CNPJ, PERIODO, chave(1)))).toBe(false);
    expect(await readFile(checkpoints.caminhoArquivo(CNPJ, PERIODO))).toEqual(antes);
  });

  it('61 XML fiscal válido persistido é retomado sem nova gravação', async () => {
    const inv = inventario([documento(chave(1))]);
    const xml = xmlFiscal(chave(1));
    await servico.criarCheckpoint(inv, 'exec-persistido-retomado');
    await servico.persistirXml(inv, chave(1), xml);
    const destino = xmls.caminhoArquivo(CNPJ, PERIODO, chave(1));
    const antes = await readFile(destino);
    const mtime = (await stat(destino)).mtimeMs;

    const retomado = await retomarExecucaoNfse({ inventario: inv, checkpointStore: checkpoints, xmlStore: xmls });
    expect(estadoDe(retomado.checkpoint, chave(1)).estado).toBe('PERSISTIDO');
    expect(retomado.alteracoes).toEqual([]);
    expect(await readFile(destino)).toEqual(antes);
    expect((await stat(destino)).mtimeMs).toBe(mtime);
  });

  it('62 XML inválido não grava arquivo', async () => {
    const inv = inventario([documento(chave(1))]);
    await servico.criarCheckpoint(inv, 'exec-invalido-arquivo');

    await expect(servico.persistirXml(inv, chave(1), xmlTextoFraco(chave(1)))).rejects.toMatchObject({
      codigo: 'XML_NAO_CONFIRMADO',
    });
    expect(await contarXml()).toBe(0);
    expect(existsSync(xmls.caminhoArquivo(CNPJ, PERIODO, chave(1)))).toBe(false);
  });

  it('63 XML inválido não atualiza o checkpoint', async () => {
    const inv = inventario([documento(chave(1))]);
    await servico.criarCheckpoint(inv, 'exec-invalido-checkpoint');
    const antes = await readFile(checkpoints.caminhoArquivo(CNPJ, PERIODO), 'utf8');

    await expect(servico.persistirXml(inv, chave(1), xmlFiscal(chave(1), { emitente: OUTRO_CNPJ }))).rejects.toMatchObject({
      codigo: 'CNPJ_DIVERGENTE',
    });
    expect(await readFile(checkpoints.caminhoArquivo(CNPJ, PERIODO), 'utf8')).toBe(antes);
    expect(JSON.parse(antes).documentos[0].estado).toBe('PENDENTE');
    expect(JSON.parse(antes).documentos[0].hashSha256).toBeNull();
  });
});

function codigoSincrono(acao: () => unknown): string {
  try {
    acao();
  } catch (erro) {
    return erro instanceof CheckpointNfseError ? erro.codigo : 'ERRO_INESPERADO';
  }
  return 'NAO_LANCOU';
}

function chave(final: number): string {
  return String(final).padStart(50, '7');
}

/** XML fiscal sintético válido. Usado na persistência e na promoção. */
function xmlDe(
  chaveValor: string,
  opcoes: { emitente?: string; tomador?: string; chaveXml?: string; dCompet?: string } = {}
): string {
  return xmlFiscal(chaveValor, opcoes);
}

/** Chave só no texto: o validador fiscal não confirma. */
function xmlTextoFraco(chaveValor: string): string {
  return `<NFSe><chNFSe>${chaveValor}</chNFSe></NFSe>`;
}

function xmlFiscal(
  chaveValor: string,
  opcoes: { emitente?: string; tomador?: string; chaveXml?: string; dCompet?: string } = {}
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

function xmlComIntermediario(chaveValor: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse">
  <infNFSe Id="NFS${chaveValor}">
    <chNFSe>${chaveValor}</chNFSe>
    <dCompet>2026-08</dCompet>
    <interm><CNPJ>${CNPJ}</CNPJ></interm>
    <emit><CNPJ>${OUTRO_CNPJ}</CNPJ></emit>
    <toma><CNPJ>${TOMADOR}</CNPJ></toma>
  </infNFSe>
</NFSe>`;
}

async function gravarXmlDireto(chaveValor: string, xml: string): Promise<string> {
  const destino = xmls.caminhoArquivo(CNPJ, PERIODO, chaveValor);
  await mkdir(path.dirname(destino), { recursive: true });
  await writeFile(destino, xml);
  return destino;
}

async function ocupar(store: CheckpointStore): Promise<{ liberar: () => void; concluida: Promise<void> }> {
  let liberar!: () => void;
  const espera = new Promise<void>((resolve) => {
    liberar = resolve;
  });
  let avisar!: () => void;
  const entrou = new Promise<void>((resolve) => {
    avisar = resolve;
  });
  const concluida = store.comTrava(CNPJ, PERIODO, async () => {
    avisar();
    await espera;
  });
  await entrou;
  return { liberar, concluida };
}

async function plantarTrava(store: CheckpointStore, pid: number): Promise<string> {
  const diretorio = store.caminhoTrava(CNPJ, PERIODO);
  await mkdir(diretorio, { recursive: true });
  await writeFile(
    path.join(diretorio, 'dono.json'),
    JSON.stringify({ pid, token: 'ab'.repeat(16), criadoEm: '2026-10-20T00:00:00.000Z' })
  );
  return diretorio;
}

async function processoQuePermanece(): Promise<ChildProcess> {
  const filho = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e9)'], { stdio: 'ignore' });
  await new Promise<void>((resolve, reject) => {
    filho.once('error', reject);
    filho.once('spawn', () => resolve());
  });
  if (!filho.pid) throw new Error('Processo sem pid.');
  return filho;
}

async function pidEncerrado(): Promise<number> {
  for (let tentativa = 0; tentativa < 5; tentativa += 1) {
    const filho = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' });
    await new Promise<void>((resolve, reject) => {
      filho.once('error', reject);
      filho.once('exit', () => resolve());
    });
    if (filho.pid && pidEstaMorto(filho.pid)) return filho.pid;
  }
  throw new Error('Não foi possível observar um pid encerrado.');
}

function pidEstaMorto(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (erro) {
    return (erro as NodeJS.ErrnoException).code === 'ESRCH';
  }
}

function documento(
  chaveValor: string,
  opcoes: {
    cnpj?: string;
    direcao?: DirecaoDocumentoFiscal;
    situacao?: SituacaoDocumentoFiscal;
    periodo?: PeriodoConsultaPortal;
    dCompet?: string;
  } = {}
) {
  return criarDocumentoFiscal({
    chaveNacional: chaveValor,
    cnpj: opcoes.cnpj ?? CNPJ,
    direcao: opcoes.direcao ?? 'EMITIDA',
    situacao: opcoes.situacao ?? 'VIGENTE',
    periodoConsulta: opcoes.periodo ?? PERIODO,
    competenciaFiscalXml: opcoes.dCompet ? criarCompetenciaFiscalXml(opcoes.dCompet) : undefined,
  });
}

function inventario(
  documentos: ReturnType<typeof documento>[],
  completude: 'COMPLETO' | 'PARCIAL' = 'COMPLETO',
  cnpj = CNPJ,
  periodo = PERIODO
): InventarioNfse {
  return montarInventario({
    id: 'inv-teste',
    cnpj,
    periodoConsulta: periodo,
    documentos,
    completude,
  });
}

function canonico(inv: InventarioNfse): string {
  const linhas = [...inv.documentos]
    .map((item) => `${item.chaveNacional}:${item.direcao}:${item.situacao}`)
    .sort();
  return [inv.cnpj, inv.periodoConsulta.inicio, inv.periodoConsulta.fim, ...linhas].join('\n');
}

function estadoDe(checkpoint: CheckpointNfse, chaveValor: string) {
  const documentoCheckpoint = checkpoint.documentos.find((item) => item.chaveNacional === chaveValor);
  if (!documentoCheckpoint) throw new Error(`Documento ausente: ${chaveValor}`);
  return documentoCheckpoint;
}

function arquivoDe(chaveValor: string, xml: string): ArquivoVerificadoNfse {
  const bytes = Buffer.from(xml, 'utf8');
  return {
    chaveNacional: chaveValor,
    existe: true,
    tamanhoBytes: bytes.length,
    hashSha256: hashSha256Conteudo(bytes),
  };
}

async function verificarVigentes(inv: InventarioNfse, checkpoint: CheckpointNfse): Promise<ArquivoVerificadoNfse[]> {
  const vigentes = checkpoint.documentos.filter((documentoCheckpoint) => documentoCheckpoint.situacao === 'VIGENTE');
  const arquivos: ArquivoVerificadoNfse[] = [];
  for (const documentoCheckpoint of vigentes) {
    arquivos.push(await xmls.verificar(inv.cnpj, inv.periodoConsulta, documentoCheckpoint.chaveNacional));
  }
  return arquivos;
}

async function reescrever(mutacao: (json: CheckpointNfse) => void): Promise<void> {
  const arquivo = checkpoints.caminhoArquivo(CNPJ, PERIODO);
  const json = JSON.parse(await readFile(arquivo, 'utf8')) as CheckpointNfse;
  mutacao(json);
  await writeFile(arquivo, JSON.stringify(json));
}

async function contarXml(): Promise<number> {
  return (await listar(path.join(raiz, 'xml'))).filter((nome) => nome.endsWith('.xml')).length;
}

async function listar(diretorio: string): Promise<string[]> {
  let entradas;
  try {
    entradas = await readdir(diretorio, { withFileTypes: true });
  } catch {
    return [];
  }
  const nomes: string[] = [];
  for (const entrada of entradas) {
    if (entrada.isDirectory()) {
      nomes.push(...(await listar(path.join(diretorio, entrada.name))));
    } else {
      nomes.push(entrada.name);
    }
  }
  return nomes;
}
