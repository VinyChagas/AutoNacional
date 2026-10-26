/**
 * API-03P — preservação de situação fiscal confirmada diante de descoberta mais fraca.
 * Referência CRASA: chave …00038026081997375192 (CANCELADA comprovada → INDETERMINADA).
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
  alinharInventarioAoCheckpoint,
  cancelamentoComprovadoNoCheckpoint,
  CheckpointService,
  CheckpointStore,
  compararInventarioComCheckpoint,
  ehEnfraquecimentoEvidencia,
  transicaoSituacaoPermitida,
  XmlStore,
  type CheckpointNfse,
} from './index';

const CNPJ = '21063590000171';
const PRESTADOR = '50850720000114';
const PERIODO = criarPeriodoConsultaPortal('01/08/2026', '31/08/2026');
/** CRASA nota 380 — observada CANCELADA→INDETERMINADA em produção. */
const CHAVE_380 = '35487081250850720000114000000000038026081997375192';

let raiz: string;
let checkpoints: CheckpointStore;
let xmls: XmlStore;
let servico: CheckpointService;

beforeEach(async () => {
  raiz = await mkdtemp(path.join(tmpdir(), 'api03p-'));
  checkpoints = new CheckpointStore(path.join(raiz, 'checkpoints'));
  xmls = new XmlStore(path.join(raiz, 'xml'));
  servico = new CheckpointService(checkpoints, xmls);
});

afterEach(async () => {
  await rm(raiz, { recursive: true, force: true });
});

describe('API-03P — preservação de situação confirmada', () => {
  it('CANCELADA comprovada → INDETERMINADA: preserva CANCELADA sem bloquear', async () => {
    expect(ehEnfraquecimentoEvidencia('CANCELADA', 'INDETERMINADA')).toBe(true);
    expect(transicaoSituacaoPermitida('CANCELADA', 'INDETERMINADA')).toBe(false);

    const invCancelada = inventario([
      documento(CHAVE_380, { situacao: 'CANCELADA', direcao: 'RECEBIDA' }),
    ]);
    await servico.criarCheckpoint(invCancelada, 'exec-p-1');
    const xml = xmlDe(CHAVE_380, 'RECEBIDA');
    // Simula evolução VIGENTE→CANCELADA com XML histórico (como CRASA).
    const cpAntes = await checkpoints.carregar(CNPJ, PERIODO);
    expect(cpAntes).toBeTruthy();
    const docCanc = estadoDe(cpAntes!, CHAVE_380);
    expect(cancelamentoComprovadoNoCheckpoint(docCanc)).toBe(true);

    // Grava XML histórico manualmente no store + atualiza checkpoint como em produção.
    await xmls.persistir(CNPJ, PERIODO, CHAVE_380, xml, 'RECEBIDA');
    const hash = (await xmls.verificar(CNPJ, PERIODO, CHAVE_380)).hashSha256;
    const comXml: CheckpointNfse = {
      ...cpAntes!,
      documentos: cpAntes!.documentos.map((d) =>
        d.chaveNacional === CHAVE_380
          ? {
              ...d,
              hashSha256: hash,
              caminhoRelativo: `${CNPJ}/01-08-2026_31-08-2026/${CHAVE_380}.xml`,
              tamanhoBytes: Buffer.byteLength(xml),
              diagnostico: 'Situação atualizada para CANCELADA; XML histórico preservado.',
              codigo: 'EVOLUCAO_SITUACAO',
            }
          : d
      ),
    };
    await checkpoints.gravar(comXml);

    const invFraca = inventario([
      documento(CHAVE_380, { situacao: 'INDETERMINADA', direcao: 'RECEBIDA' }),
    ]);
    const comparacao = compararInventarioComCheckpoint(comXml, invFraca);
    expect(comparacao.tipo).toBe('EVOLUIVEL');
    if (comparacao.tipo === 'EVOLUIVEL') {
      expect(comparacao.preservacoesSituacao).toEqual([
        expect.objectContaining({
          chaveNacional: CHAVE_380,
          situacaoMantida: 'CANCELADA',
          situacaoDescoberta: 'INDETERMINADA',
        }),
      ]);
      expect(comparacao.mudancasSituacao).toEqual([]);
    }

    const evoluido = await servico.criarCheckpoint(invFraca, 'exec-p-2');
    const doc = estadoDe(evoluido, CHAVE_380);
    expect(doc.situacao).toBe('CANCELADA');
    expect(doc.estado).toBe('EXCLUIDA_DA_RECUPERACAO');
    expect(doc.codigo).toBe('PRESERVACAO_SITUACAO');
    expect(doc.hashSha256).toBe(hash);
    expect(existsSync(xmls.caminhoArquivo(CNPJ, PERIODO, CHAVE_380))).toBe(true);
    expect(await readFile(xmls.caminhoArquivo(CNPJ, PERIODO, CHAVE_380), 'utf8')).toBe(xml);

    const alinhado = alinharInventarioAoCheckpoint(invFraca, evoluido);
    expect(alinhado.totais.canceladas).toBe(1);
    expect(alinhado.totais.indeterminadas).toBe(0);
    expect(alinhado.documentos[0]?.situacao).toBe('CANCELADA');
  });

  it('CANCELADA sem evidência histórica confiável → INDETERMINADA permanece bloqueada', () => {
    const cp = checkpointManual({
      chaveNacional: CHAVE_380,
      situacao: 'CANCELADA',
      estado: 'BLOQUEADO', // não é EXCLUIDA_DA_RECUPERACAO
      diagnostico: null,
      codigo: null,
    });
    expect(cancelamentoComprovadoNoCheckpoint(cp.documentos[0]!)).toBe(false);
    const inv = inventario([
      documento(CHAVE_380, { situacao: 'INDETERMINADA', direcao: 'RECEBIDA' }),
    ]);
    const r = compararInventarioComCheckpoint(cp, inv);
    expect(r.tipo).toBe('BLOQUEADO');
    if (r.tipo === 'BLOQUEADO') {
      expect(r.codigo).toBe('TRANSICAO_SITUACAO_INVALIDA');
      expect(r.transicoesInvalidas[0]).toMatchObject({
        de: 'CANCELADA',
        para: 'INDETERMINADA',
      });
    }
  });

  it('CANCELADA → VIGENTE continua bloqueada (exige evidência explícita)', () => {
    expect(transicaoSituacaoPermitida('CANCELADA', 'VIGENTE')).toBe(false);
    const cp = checkpointManual({
      chaveNacional: CHAVE_380,
      situacao: 'CANCELADA',
      estado: 'EXCLUIDA_DA_RECUPERACAO',
      diagnostico: 'Nota cancelada',
      codigo: 'EVOLUCAO_SITUACAO',
    });
    const inv = inventario([documento(CHAVE_380, { situacao: 'VIGENTE', direcao: 'RECEBIDA' })]);
    const r = compararInventarioComCheckpoint(cp, inv);
    expect(r.tipo).toBe('BLOQUEADO');
    if (r.tipo === 'BLOQUEADO') expect(r.codigo).toBe('TRANSICAO_SITUACAO_INVALIDA');
  });

  it('INDETERMINADA → CANCELADA permanece permitida', async () => {
    expect(transicaoSituacaoPermitida('INDETERMINADA', 'CANCELADA')).toBe(true);
    const inv = inventario([documento(CHAVE_380, { situacao: 'INDETERMINADA', direcao: 'RECEBIDA' })]);
    await servico.criarCheckpoint(inv, 'exec-i-c-1');
    const depois = inventario([documento(CHAVE_380, { situacao: 'CANCELADA', direcao: 'RECEBIDA' })]);
    const evoluido = await servico.criarCheckpoint(depois, 'exec-i-c-2');
    expect(estadoDe(evoluido, CHAVE_380).situacao).toBe('CANCELADA');
    expect(estadoDe(evoluido, CHAVE_380).estado).toBe('EXCLUIDA_DA_RECUPERACAO');
  });

  it('INDETERMINADA → VIGENTE permanece permitida', async () => {
    expect(transicaoSituacaoPermitida('INDETERMINADA', 'VIGENTE')).toBe(true);
    const inv = inventario([documento(CHAVE_380, { situacao: 'INDETERMINADA', direcao: 'RECEBIDA' })]);
    await servico.criarCheckpoint(inv, 'exec-i-v-1');
    const depois = inventario([documento(CHAVE_380, { situacao: 'VIGENTE', direcao: 'RECEBIDA' })]);
    const evoluido = await servico.criarCheckpoint(depois, 'exec-i-v-2');
    expect(estadoDe(evoluido, CHAVE_380).situacao).toBe('VIGENTE');
    expect(estadoDe(evoluido, CHAVE_380).estado).toBe('PENDENTE');
  });

  it('VIGENTE confirmada → INDETERMINADA: preserva VIGENTE e XML', async () => {
    const chaveValor = chave(1);
    const inv = inventario([documento(chaveValor, { situacao: 'VIGENTE' })]);
    await servico.criarCheckpoint(inv, 'exec-v-1');
    const xml = xmlDe(chaveValor);
    await servico.persistirXml(inv, chaveValor, xml);
    const hashAntes = estadoDe((await checkpoints.carregar(CNPJ, PERIODO))!, chaveValor).hashSha256;

    const fraca = inventario([documento(chaveValor, { situacao: 'INDETERMINADA' })]);
    const evoluido = await servico.criarCheckpoint(fraca, 'exec-v-2');
    const doc = estadoDe(evoluido, chaveValor);
    expect(doc.situacao).toBe('VIGENTE');
    expect(doc.estado).toBe('PERSISTIDO');
    expect(doc.codigo).toBe('PRESERVACAO_SITUACAO');
    expect(doc.hashSha256).toBe(hashAntes);
    expect(await readFile(xmls.caminhoArquivo(CNPJ, PERIODO, chaveValor), 'utf8')).toBe(xml);
  });

  it('preservação não apaga checkpoint anterior nem impede outras chaves novas', async () => {
    const k1 = chave(1);
    const k2 = chave(2);
    const inv1 = inventario([
      documento(k1, { situacao: 'CANCELADA', direcao: 'RECEBIDA' }),
    ]);
    await servico.criarCheckpoint(inv1, 'exec-m-1');
    const antes = await readFile(checkpoints.caminhoArquivo(CNPJ, PERIODO), 'utf8');

    const inv2 = inventario([
      documento(k1, { situacao: 'INDETERMINADA', direcao: 'RECEBIDA' }),
      documento(k2, { situacao: 'VIGENTE', direcao: 'RECEBIDA' }),
    ]);
    const evoluido = await servico.criarCheckpoint(inv2, 'exec-m-2');
    expect(estadoDe(evoluido, k1).situacao).toBe('CANCELADA');
    expect(estadoDe(evoluido, k2).situacao).toBe('VIGENTE');
    expect(estadoDe(evoluido, k2).estado).toBe('PENDENTE');
    expect(await readFile(checkpoints.caminhoArquivo(CNPJ, PERIODO), 'utf8')).not.toBe(antes);
  });
});

function chave(final: number): string {
  return String(final).padStart(50, '8');
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
    id: 'inv-api03p',
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

function checkpointManual(doc: {
  chaveNacional: string;
  situacao: 'VIGENTE' | 'CANCELADA' | 'INDETERMINADA';
  estado: CheckpointNfse['documentos'][number]['estado'];
  diagnostico: string | null;
  codigo: string | null;
}): CheckpointNfse {
  return {
    versaoFormato: 1,
    execucaoId: 'manual',
    cnpj: CNPJ,
    periodoConsulta: PERIODO,
    fingerprintInventario: 'a'.repeat(64),
    createdAt: 't',
    updatedAt: 't',
    documentos: [
      {
        chaveNacional: doc.chaveNacional,
        direcao: 'RECEBIDA',
        situacao: doc.situacao,
        estado: doc.estado,
        hashSha256: null,
        caminhoRelativo: null,
        tamanhoBytes: null,
        diagnostico: doc.diagnostico,
        codigo: doc.codigo,
        updatedAt: 't',
      },
    ],
  };
}
