/**
 * API-03F — evolução incremental segura de checkpoints fiscais.
 */
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { criarDocumentoFiscal } from '../contracts/documento-fiscal';
import { montarInventario, type InventarioNfse } from '../contracts/inventario';
import { criarPeriodoConsultaPortal } from '../contracts/periodo';
import {
  CheckpointService,
  CheckpointStore,
  XmlStore,
  calcularFingerprintInventario,
  compararInventarioComCheckpoint,
  reconciliarNfse,
  retomarExecucaoNfse,
  transicaoSituacaoPermitida,
  type CheckpointNfse,
} from './index';

const CNPJ = '37580110000180';
const PRESTADOR = '11222333000181';
const PERIODO = criarPeriodoConsultaPortal('01/08/2026', '31/08/2026');

let raiz: string;
let checkpoints: CheckpointStore;
let xmls: XmlStore;
let servico: CheckpointService;

beforeEach(async () => {
  raiz = await mkdtemp(path.join(tmpdir(), 'nfse-evolucao-'));
  checkpoints = new CheckpointStore(path.join(raiz, 'checkpoints'));
  xmls = new XmlStore(path.join(raiz, 'xml'));
  servico = new CheckpointService(checkpoints, xmls);
});

afterEach(async () => {
  await rm(raiz, { recursive: true, force: true });
});

describe('API-03F evolução incremental de checkpoint', () => {
  it('43→45: preserva 43 PERSISTIDO e adiciona 2 PENDENTE com fingerprint novo', async () => {
    const anteriores = Array.from({ length: 43 }, (_, i) => documento(chave(i + 1), { direcao: 'RECEBIDA' }));
    const inv43 = inventario(anteriores);
    const criado = await servico.criarCheckpoint(inv43, 'exec-43');
    for (const doc of anteriores) {
      await servico.persistirXml(inv43, doc.chaveNacional, xmlDe(doc.chaveNacional, 'RECEBIDA'));
    }
    const antes = await checkpoints.carregar(CNPJ, PERIODO);
    expect(antes?.documentos.filter((d) => d.estado === 'PERSISTIDO')).toHaveLength(43);

    const novas = [documento(chave(44), { direcao: 'RECEBIDA' }), documento(chave(45), { direcao: 'RECEBIDA' })];
    const inv45 = inventario([...anteriores, ...novas]);
    const evoluido = await servico.criarCheckpoint(inv45, 'exec-45');

    expect(evoluido.fingerprintInventario).toBe(calcularFingerprintInventario(inv45));
    expect(evoluido.fingerprintInventario).not.toBe(criado.fingerprintInventario);
    expect(evoluido.documentos).toHaveLength(45);
    expect(estadoDe(evoluido, chave(1)).estado).toBe('PERSISTIDO');
    expect(estadoDe(evoluido, chave(1)).hashSha256).toBeTruthy();
    expect(estadoDe(evoluido, chave(44)).estado).toBe('PENDENTE');
    expect(estadoDe(evoluido, chave(45)).estado).toBe('PENDENTE');
    expect(existsSync(xmls.caminhoArquivo(CNPJ, PERIODO, chave(1)))).toBe(true);
  });

  it('67→68: mesma regra de superconjunto', async () => {
    const docs67 = Array.from({ length: 67 }, (_, i) => documento(chave(i + 1), { direcao: 'RECEBIDA' }));
    const inv67 = inventario(docs67);
    await servico.criarCheckpoint(inv67, 'exec-67');
    await servico.persistirXml(inv67, chave(1), xmlDe(chave(1), 'RECEBIDA'));

    const inv68 = inventario([...docs67, documento(chave(68), { direcao: 'RECEBIDA' })]);
    const evoluido = await servico.criarCheckpoint(inv68, 'exec-68');

    expect(evoluido.documentos).toHaveLength(68);
    expect(estadoDe(evoluido, chave(1)).estado).toBe('PERSISTIDO');
    expect(estadoDe(evoluido, chave(68)).estado).toBe('PENDENTE');
  });

  it('mudança de situação VIGENTE→CANCELADA preserva XML histórico', async () => {
    const inv = inventario([documento(chave(1)), documento(chave(2))]);
    await servico.criarCheckpoint(inv, 'exec-sit');
    const xml = xmlDe(chave(1));
    await servico.persistirXml(inv, chave(1), xml);
    const hashAntes = estadoDe((await checkpoints.carregar(CNPJ, PERIODO))!, chave(1)).hashSha256;

    const atualizado = inventario([
      documento(chave(1), { situacao: 'CANCELADA' }),
      documento(chave(2)),
    ]);
    const evoluido = await servico.criarCheckpoint(atualizado, 'exec-sit-2');

    const doc = estadoDe(evoluido, chave(1));
    expect(doc.situacao).toBe('CANCELADA');
    expect(doc.estado).toBe('EXCLUIDA_DA_RECUPERACAO');
    expect(doc.hashSha256).toBe(hashAntes);
    expect(await readFile(xmls.caminhoArquivo(CNPJ, PERIODO, chave(1)), 'utf8')).toBe(xml);
    expect(estadoDe(evoluido, chave(2)).estado).toBe('PENDENTE');
  });

  it('INDETERMINADA→CANCELADA (API-03D P105) é transição permitida', async () => {
    expect(transicaoSituacaoPermitida('INDETERMINADA', 'CANCELADA')).toBe(true);
    const inv = inventario([documento(chave(1), { situacao: 'INDETERMINADA' })]);
    await servico.criarCheckpoint(inv, 'exec-p105-a');
    const depois = inventario([documento(chave(1), { situacao: 'CANCELADA' })]);
    const evoluido = await servico.criarCheckpoint(depois, 'exec-p105-b');
    expect(estadoDe(evoluido, chave(1)).situacao).toBe('CANCELADA');
    expect(estadoDe(evoluido, chave(1)).estado).toBe('EXCLUIDA_DA_RECUPERACAO');
  });

  it('chave desaparecida bloqueia e preserva checkpoint anterior', async () => {
    const inv = inventario([documento(chave(1)), documento(chave(2))]);
    await servico.criarCheckpoint(inv, 'exec-aus');
    await servico.persistirXml(inv, chave(1), xmlDe(chave(1)));
    const antes = await readFile(checkpoints.caminhoArquivo(CNPJ, PERIODO), 'utf8');

    const reduzido = inventario([documento(chave(1))]);
    await expect(servico.criarCheckpoint(reduzido, 'exec-aus-2')).rejects.toMatchObject({
      codigo: 'CHAVES_AUSENTES',
      detalhes: { chavesAusentes: [chave(2)] },
    });
    expect(await readFile(checkpoints.caminhoArquivo(CNPJ, PERIODO), 'utf8')).toBe(antes);
  });

  it('inventário incompleto não altera checkpoint existente', async () => {
    const inv = inventario([documento(chave(1))]);
    await servico.criarCheckpoint(inv, 'exec-inc');
    const antes = await readFile(checkpoints.caminhoArquivo(CNPJ, PERIODO), 'utf8');

    const parcial = montarInventario({
      id: 'parcial',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      documentos: [documento(chave(1)), documento(chave(2))],
      completude: 'PARCIAL',
    });
    await expect(servico.criarCheckpoint(parcial, 'exec-inc-2')).rejects.toMatchObject({
      codigo: 'DESCOBERTA_INCOMPLETA',
    });
    expect(await readFile(checkpoints.caminhoArquivo(CNPJ, PERIODO), 'utf8')).toBe(antes);
  });

  it('XML preexistente íntegro não é sobrescrito na evolução 43→45', async () => {
    const d1 = documento(chave(1), { direcao: 'RECEBIDA' });
    const inv1 = inventario([d1]);
    await servico.criarCheckpoint(inv1, 'exec-xml');
    const xml = xmlDe(chave(1), 'RECEBIDA');
    await servico.persistirXml(inv1, chave(1), xml);

    const inv2 = inventario([d1, documento(chave(2), { direcao: 'RECEBIDA' })]);
    await servico.criarCheckpoint(inv2, 'exec-xml-2');
    expect(await readFile(xmls.caminhoArquivo(CNPJ, PERIODO, chave(1)), 'utf8')).toBe(xml);
  });

  it('divergência de hash na retomada marca INCONSISTENTE sem sobrescrever', async () => {
    const inv = inventario([documento(chave(1))]);
    await servico.criarCheckpoint(inv, 'exec-hash');
    const xml = xmlDe(chave(1));
    await servico.persistirXml(inv, chave(1), xml);
    const destino = xmls.caminhoArquivo(CNPJ, PERIODO, chave(1));
    await import('node:fs/promises').then(({ writeFile }) => writeFile(destino, xml + '<!--x-->'));

    const retomado = await retomarExecucaoNfse({
      inventario: inv,
      checkpointStore: checkpoints,
      xmlStore: xmls,
    });
    expect(estadoDe(retomado.checkpoint, chave(1)).estado).toBe('INCONSISTENTE');
    expect(await readFile(destino, 'utf8')).toBe(xml + '<!--x-->');
  });

  it('interrupção durante gravação da evolução preserva JSON anterior', async () => {
    const inv1 = inventario([documento(chave(1))]);
    let bloquear = false;
    const store = new CheckpointStore(path.join(raiz, 'cp-atom'), {
      antesDoRename: () => {
        if (bloquear) throw new Error('interrupcao-evolucao');
      },
    });
    const local = new CheckpointService(store, xmls);
    await local.criarCheckpoint(inv1, 'exec-atom');
    await local.persistirXml(inv1, chave(1), xmlDe(chave(1)));
    const arquivo = store.caminhoArquivo(CNPJ, PERIODO);
    const anterior = await readFile(arquivo);

    bloquear = true;
    const inv2 = inventario([documento(chave(1)), documento(chave(2))]);
    await expect(local.criarCheckpoint(inv2, 'exec-atom-2')).rejects.toMatchObject({
      codigo: 'FALHA_ESCRITA',
    });
    expect(await readFile(arquivo)).toEqual(anterior);
    expect(JSON.parse(anterior.toString('utf8')).documentos).toHaveLength(1);
  });

  it('execuções simultâneas na evolução falham com CHECKPOINT_EM_USO', async () => {
    const inv1 = inventario([documento(chave(1))]);
    await servico.criarCheckpoint(inv1, 'exec-conc');
    const inv2 = inventario([documento(chave(1)), documento(chave(2))]);

    await expect(
      checkpoints.comTrava(CNPJ, PERIODO, async () => {
        await servico.criarCheckpoint(inv2, 'exec-conc-2');
      })
    ).rejects.toMatchObject({ codigo: 'CHECKPOINT_EM_USO' });
  });

  it('após evolução, retomada e reconciliação usam inventário atualizado', async () => {
    const inv1 = inventario([documento(chave(1))]);
    await servico.criarCheckpoint(inv1, 'exec-rec');
    await servico.persistirXml(inv1, chave(1), xmlDe(chave(1)));

    const inv2 = inventario([documento(chave(1)), documento(chave(2))]);
    const evoluido = await servico.criarCheckpoint(inv2, 'exec-rec-2');
    const retomada = await retomarExecucaoNfse({
      inventario: inv2,
      checkpointStore: checkpoints,
      xmlStore: xmls,
    });
    expect(retomada.podeRetomarAutomaticamente).toBe(true);
    expect(retomada.checkpoint.fingerprintInventario).toBe(evoluido.fingerprintInventario);

    const arquivos = [
      {
        chaveNacional: chave(1),
        existe: true,
        tamanhoBytes: Buffer.byteLength(xmlDe(chave(1))),
        hashSha256: estadoDe(retomada.checkpoint, chave(1)).hashSha256,
      },
    ];
    const rel = reconciliarNfse(inv2, retomada.checkpoint, arquivos);
    expect(rel.identidadeConsistente).toBe(true);
    expect(rel.persistidosIntegros).toBe(1);
    expect(rel.pendentes).toBe(1);
  });

  it('comparação pura: CANCELADA→VIGENTE é bloqueada', () => {
    const cp = {
      versaoFormato: 1,
      execucaoId: 'x',
      cnpj: CNPJ,
      periodoConsulta: PERIODO,
      fingerprintInventario: 'a'.repeat(64),
      createdAt: 't',
      updatedAt: 't',
      documentos: [
        {
          chaveNacional: chave(1),
          direcao: 'EMITIDA' as const,
          situacao: 'CANCELADA' as const,
          estado: 'EXCLUIDA_DA_RECUPERACAO' as const,
          hashSha256: null,
          caminhoRelativo: null,
          tamanhoBytes: null,
          diagnostico: null,
          codigo: null,
          updatedAt: 't',
        },
      ],
    };
    const inv = inventario([documento(chave(1), { situacao: 'VIGENTE' })]);
    const r = compararInventarioComCheckpoint(cp, inv);
    expect(r.tipo).toBe('BLOQUEADO');
    if (r.tipo === 'BLOQUEADO') expect(r.codigo).toBe('TRANSICAO_SITUACAO_INVALIDA');
  });

  it('retomar sem evolução prévia ainda bloqueia inventário divergente', async () => {
    const um = inventario([documento(chave(1))]);
    await servico.criarCheckpoint(um, 'exec-ret');
    const dois = inventario([documento(chave(1)), documento(chave(2))]);
    const antes = await readFile(checkpoints.caminhoArquivo(CNPJ, PERIODO), 'utf8');
    await expect(
      retomarExecucaoNfse({ inventario: dois, checkpointStore: checkpoints, xmlStore: xmls })
    ).rejects.toMatchObject({ codigo: 'IDENTIDADE_DIVERGENTE' });
    expect(await readFile(checkpoints.caminhoArquivo(CNPJ, PERIODO), 'utf8')).toBe(antes);
  });
});

function chave(final: number): string {
  return String(final).padStart(50, '7');
}

function documento(
  chaveValor: string,
  opcoes: {
    situacao?: 'VIGENTE' | 'CANCELADA' | 'INDETERMINADA';
    direcao?: 'EMITIDA' | 'RECEBIDA';
  } = {}
) {
  return criarDocumentoFiscal({
    chaveNacional: chaveValor,
    cnpj: CNPJ,
    direcao: opcoes.direcao ?? 'EMITIDA',
    situacao: opcoes.situacao ?? 'VIGENTE',
    periodoConsulta: PERIODO,
  });
}

function inventario(documentos: ReturnType<typeof documento>[]): InventarioNfse {
  return montarInventario({
    id: 'inv-evolucao',
    cnpj: CNPJ,
    periodoConsulta: PERIODO,
    documentos,
    completude: 'COMPLETO',
  });
}

function xmlDe(chaveValor: string, direcao: 'EMITIDA' | 'RECEBIDA' = 'EMITIDA'): string {
  const emitente = direcao === 'RECEBIDA' ? PRESTADOR : CNPJ;
  const tomador = direcao === 'RECEBIDA' ? CNPJ : PRESTADOR;
  return `<?xml version="1.0" encoding="UTF-8"?>
<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse">
  <infNFSe Id="NFS${chaveValor}">
    <chNFSe>${chaveValor}</chNFSe>
    <dCompet>2026-08</dCompet>
    <emit><CNPJ>${emitente}</CNPJ></emit>
    <toma><CNPJ>${tomador}</CNPJ></toma>
  </infNFSe>
</NFSe>`;
}

function estadoDe(checkpoint: CheckpointNfse, chaveValor: string) {
  const doc = checkpoint.documentos.find((d) => d.chaveNacional === chaveValor);
  if (!doc) throw new Error(`ausente ${chaveValor}`);
  return doc;
}
