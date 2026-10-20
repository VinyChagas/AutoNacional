/**
 * Checkpoint JSON em arquivo local.
 * A trava exclusiva é um diretório criado com mkdir atômico, com dono pid + token.
 * Ela vale entre instâncias que usam a mesma raiz e entre processos do mesmo host.
 * Trava de processo vivo não é removida. Trava sem dono legível também não.
 * Só há recuperação quando o pid não existe mais e o token relido continua o mesmo.
 * Tempório interrompido é descartado; o rename é que publica o JSON novo.
 */
import { randomBytes } from 'node:crypto';
import { open, mkdir, readdir, readFile, rename, rm, rmdir, unlink, writeFile, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import type { DirecaoDocumentoFiscal, SituacaoDocumentoFiscal } from '../contracts/documento-fiscal';
import { PERIODO_CONSULTA_PORTAL, type PeriodoConsultaPortal } from '../contracts/periodo';
import {
  CheckpointNfseError,
  ESTADOS_DOCUMENTO_CHECKPOINT,
  VERSAO_FORMATO_CHECKPOINT,
  resolverCaminhoSeguro,
  segmentoPeriodo,
  type CheckpointNfse,
  type DocumentoCheckpointNfse,
  type EstadoDocumentoCheckpoint,
  type OpcoesEscritaAtomica,
} from './types';

const HASH_SHA256 = /^[a-f0-9]{64}$/;
const NOME_CHECKPOINT = 'checkpoint.json';
const NOME_DONO_TRAVA = 'dono.json';
const MAX_BYTES_DONO = 4_096;
const TOKEN_TRAVA = /^[a-f0-9]{32}$/;

export async function escreverArquivoAtomico(
  destino: string,
  conteudo: Buffer,
  ganchos?: OpcoesEscritaAtomica
): Promise<void> {
  let arquivo: FileHandle | null = null;
  let temporario: string | null = null;
  let renomeado = false;
  try {
    if (ganchos?.antesDaEscrita) await ganchos.antesDaEscrita();
    const diretorio = path.dirname(destino);
    await mkdir(diretorio, { recursive: true });
    temporario = path.join(
      diretorio,
      `.${path.basename(destino)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
    );
    if (path.dirname(temporario) !== diretorio) {
      throw new CheckpointNfseError('CAMINHO_INVALIDO', 'Arquivo temporário fora do diretório de destino.');
    }
    arquivo = await open(temporario, 'w', 0o600);
    await arquivo.writeFile(conteudo);
    await arquivo.sync();
    if (ganchos?.antesDoRename) await ganchos.antesDoRename();
    await rename(temporario, destino);
    renomeado = true;
  } catch (erro) {
    if (erro instanceof CheckpointNfseError) throw erro;
    throw new CheckpointNfseError('FALHA_ESCRITA', 'Falha ao gravar arquivo de forma atômica.');
  } finally {
    await arquivo?.close().catch(() => undefined);
    if (temporario && !renomeado) {
      await unlink(temporario).catch(() => undefined);
    }
  }
}

export class CheckpointStore {
  private readonly emUso = new Set<string>();

  constructor(
    private readonly raiz: string,
    private readonly ganchos?: OpcoesEscritaAtomica
  ) {
    if (typeof raiz !== 'string' || !raiz.trim()) {
      throw new CheckpointNfseError('CAMINHO_INVALIDO', 'Raiz do checkpoint ausente.');
    }
  }

  caminhoArquivo(cnpj: string, periodo: PeriodoConsultaPortal): string {
    return resolverCaminhoSeguro(this.raiz, [exigirCnpj(cnpj), segmentoPeriodo(periodo), NOME_CHECKPOINT]);
  }

  /** Diretório da trava exclusiva deste CNPJ e período, sob a mesma raiz do JSON. */
  caminhoTrava(cnpj: string, periodo: PeriodoConsultaPortal): string {
    return resolverCaminhoSeguro(this.raiz, ['.travas', exigirCnpj(cnpj), `${segmentoPeriodo(periodo)}.lock`]);
  }

  /**
   * Falha na hora se outra operação já segura este CNPJ e período.
   * Não espera. A exclusão atravessa instâncias e processos pela trava em disco.
   * O finally só libera a trava que esta chamada conseguiu adquirir.
   */
  async comTrava<T>(
    cnpj: string,
    periodo: PeriodoConsultaPortal,
    operacao: () => Promise<T>
  ): Promise<T> {
    const chave = this.caminhoArquivo(cnpj, periodo);
    if (this.emUso.has(chave)) {
      throw new CheckpointNfseError(
        'CHECKPOINT_EM_USO',
        'Checkpoint em uso por outra operação neste processo.'
      );
    }
    const diretorio = this.caminhoTrava(cnpj, periodo);
    const token = randomBytes(16).toString('hex');
    this.emUso.add(chave);
    let adquirida = false;
    try {
      await this.adquirirTrava(diretorio, token);
      adquirida = true;
      return await operacao();
    } finally {
      try {
        if (adquirida) await this.liberarTrava(diretorio, token);
      } finally {
        this.emUso.delete(chave);
      }
    }
  }

  private async adquirirTrava(diretorio: string, token: string): Promise<void> {
    await mkdir(path.dirname(diretorio), { recursive: true });
    const criada = await criarDiretorioExclusivo(diretorio);
    if (!criada) {
      const recuperou = await recuperarTravaOrfa(diretorio);
      if (!recuperou || !(await criarDiretorioExclusivo(diretorio))) {
        throw await erroDeTravaOcupada(diretorio);
      }
    }
    try {
      await writeFile(path.join(diretorio, NOME_DONO_TRAVA), JSON.stringify(donoAtual(token)), {
        flag: 'wx',
        mode: 0o600,
      });
    } catch (erro) {
      await rm(diretorio, { recursive: true, force: true }).catch(() => undefined);
      if (erro instanceof CheckpointNfseError) throw erro;
      throw new CheckpointNfseError('FALHA_ESCRITA', 'Falha ao registrar o dono da trava.');
    }
  }

  private async liberarTrava(diretorio: string, token: string): Promise<void> {
    const dono = await lerDonoTrava(diretorio);
    if (!dono || dono.pid !== process.pid || dono.token !== token) return;
    await unlink(path.join(diretorio, NOME_DONO_TRAVA)).catch(() => undefined);
    await rmdir(diretorio).catch(() => undefined);
  }

  async salvar(checkpoint: CheckpointNfse): Promise<void> {
    await this.comTrava(checkpoint.cnpj, checkpoint.periodoConsulta, async () => {
      await this.gravar(checkpoint);
    });
  }

  /** Grava sem adquirir a trava. O chamador já deve estar dentro de comTrava. */
  async gravar(checkpoint: CheckpointNfse): Promise<void> {
    const confirmado = validarEstruturaCheckpoint(checkpoint);
    const destino = this.caminhoArquivo(confirmado.cnpj, confirmado.periodoConsulta);
    const buffer = Buffer.from(`${JSON.stringify(confirmado, null, 2)}\n`, 'utf8');
    await escreverArquivoAtomico(destino, buffer, this.ganchos);
  }

  async carregar(cnpj: string, periodo: PeriodoConsultaPortal): Promise<CheckpointNfse | null> {
    const destino = this.caminhoArquivo(cnpj, periodo);
    let bruto: string;
    try {
      bruto = await readFile(destino, 'utf8');
    } catch (erro) {
      if ((erro as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new CheckpointNfseError('FALHA_LEITURA', 'Falha ao ler o checkpoint.');
    }
    const lido = interpretarCheckpoint(bruto);
    if (lido.cnpj !== exigirCnpj(cnpj) || !mesmoPeriodo(lido.periodoConsulta, periodo)) {
      throw new CheckpointNfseError('IDENTIDADE_DIVERGENTE', 'Checkpoint de outro CNPJ ou período.');
    }
    return lido;
  }
}

interface DonoTrava {
  pid: number;
  token: string;
  criadoEm: string;
}

function donoAtual(token: string): DonoTrava {
  return { pid: process.pid, token, criadoEm: new Date().toISOString() };
}

async function criarDiretorioExclusivo(diretorio: string): Promise<boolean> {
  try {
    await mkdir(diretorio);
    return true;
  } catch (erro) {
    if ((erro as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw new CheckpointNfseError('FALHA_ESCRITA', 'Falha ao criar a trava do checkpoint.');
  }
}

/**
 * Remove a trava só quando o pid não existe e uma segunda leitura repete pid e token.
 * Processo vivo, pid deste processo, dono ilegível ou token instável ficam no disco.
 */
async function recuperarTravaOrfa(diretorio: string): Promise<boolean> {
  const dono = await lerDonoTrava(diretorio);
  if (!dono || dono.pid === process.pid || processoDoDono(dono.pid) !== 'morto') return false;
  const confirmado = await lerDonoTrava(diretorio);
  if (!confirmado || confirmado.pid !== dono.pid || confirmado.token !== dono.token) return false;
  let nomes: string[];
  try {
    nomes = await readdir(diretorio);
  } catch {
    return false;
  }
  if (nomes.length !== 1 || nomes[0] !== NOME_DONO_TRAVA) return false;
  try {
    await unlink(path.join(diretorio, NOME_DONO_TRAVA));
    await rmdir(diretorio);
    return true;
  } catch {
    return false;
  }
}

async function erroDeTravaOcupada(diretorio: string): Promise<CheckpointNfseError> {
  const dono = await lerDonoTrava(diretorio);
  if (!dono) {
    return new CheckpointNfseError(
      'TRAVA_ORFA',
      'Trava de checkpoint sem dono comprovado. A trava não foi removida.'
    );
  }
  const situacao = dono.pid === process.pid ? 'vivo' : processoDoDono(dono.pid);
  if (situacao === 'vivo') {
    return new CheckpointNfseError(
      'CHECKPOINT_EM_USO',
      'Checkpoint em uso por outra operação neste CNPJ e período.'
    );
  }
  return new CheckpointNfseError(
    'TRAVA_ORFA',
    'Trava de checkpoint cujo encerramento não pôde ser comprovado. A trava não foi removida.'
  );
}

function processoDoDono(pid: number): 'vivo' | 'morto' | 'incerto' {
  if (!Number.isInteger(pid) || pid <= 0) return 'incerto';
  try {
    process.kill(pid, 0);
    return 'vivo';
  } catch (erro) {
    return (erro as NodeJS.ErrnoException).code === 'ESRCH' ? 'morto' : 'incerto';
  }
}

async function lerDonoTrava(diretorio: string): Promise<DonoTrava | null> {
  const destino = path.join(diretorio, NOME_DONO_TRAVA);
  let arquivo: FileHandle | null = null;
  try {
    arquivo = await open(destino, 'r');
    const info = await arquivo.stat();
    if (!info.isFile() || info.size <= 0 || info.size > MAX_BYTES_DONO) return null;
    const buffer = Buffer.alloc(info.size);
    const lido = await arquivo.read(buffer, 0, info.size, 0);
    if (lido.bytesRead !== info.size) return null;
    return interpretarDono(buffer.toString('utf8'));
  } catch (erro) {
    if ((erro as NodeJS.ErrnoException).code === 'ENOENT') return null;
    return null;
  } finally {
    await arquivo?.close().catch(() => undefined);
  }
}

function interpretarDono(bruto: string): DonoTrava | null {
  let valor: unknown;
  try {
    valor = JSON.parse(bruto);
  } catch {
    return null;
  }
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) return null;
  const registro = valor as Record<string, unknown>;
  const pid = registro.pid;
  const token = registro.token;
  const criadoEm = registro.criadoEm;
  if (!Number.isInteger(pid) || Number(pid) <= 0) return null;
  if (typeof token !== 'string' || !TOKEN_TRAVA.test(token)) return null;
  if (typeof criadoEm !== 'string' || !criadoEm.trim()) return null;
  return { pid: Number(pid), token, criadoEm };
}

function exigirCnpj(cnpj: string): string {
  if (!/^\d{14}$/.test(cnpj)) {
    throw new CheckpointNfseError('CAMINHO_INVALIDO', 'CNPJ não pode compor caminho.');
  }
  return cnpj;
}

function mesmoPeriodo(a: PeriodoConsultaPortal, b: PeriodoConsultaPortal): boolean {
  return a.tipo === b.tipo && a.inicio === b.inicio && a.fim === b.fim;
}

export function interpretarCheckpoint(bruto: string): CheckpointNfse {
  let valor: unknown;
  try {
    valor = JSON.parse(bruto);
  } catch {
    throw new CheckpointNfseError('CHECKPOINT_CORROMPIDO', 'Checkpoint com JSON inválido.');
  }
  if (!ehObjeto(valor) || !('versaoFormato' in valor)) {
    throw new CheckpointNfseError('CHECKPOINT_CORROMPIDO', 'Checkpoint sem versão de formato.');
  }
  if (valor.versaoFormato !== VERSAO_FORMATO_CHECKPOINT) {
    throw new CheckpointNfseError(
      'VERSAO_INCOMPATIVEL',
      `Versão de checkpoint incompatível: ${String(valor.versaoFormato)}.`
    );
  }
  return validarEstruturaCheckpoint(valor);
}

export function validarEstruturaCheckpoint(valor: unknown): CheckpointNfse {
  if (!ehObjeto(valor)) {
    throw new CheckpointNfseError('CHECKPOINT_CORROMPIDO', 'Checkpoint sem objeto JSON.');
  }
  if (valor.versaoFormato !== VERSAO_FORMATO_CHECKPOINT) {
    throw new CheckpointNfseError(
      'VERSAO_INCOMPATIVEL',
      `Versão de checkpoint incompatível: ${String(valor.versaoFormato)}.`
    );
  }
  const execucaoId = texto(valor.execucaoId);
  const cnpj = texto(valor.cnpj);
  const fingerprintInventario = texto(valor.fingerprintInventario);
  const createdAt = texto(valor.createdAt);
  const updatedAt = texto(valor.updatedAt);
  if (!execucaoId || !/^\d{14}$/.test(cnpj) || !/^[a-f0-9]{64}$/.test(fingerprintInventario)) {
    throw new CheckpointNfseError('CHECKPOINT_CORROMPIDO', 'Identidade do checkpoint incompleta.');
  }
  if (!createdAt || !updatedAt) {
    throw new CheckpointNfseError('CHECKPOINT_CORROMPIDO', 'Checkpoint sem datas.');
  }
  if (!ehObjeto(valor.periodoConsulta)) {
    throw new CheckpointNfseError('CHECKPOINT_CORROMPIDO', 'Checkpoint sem período.');
  }
  const inicio = texto(valor.periodoConsulta.inicio);
  const fim = texto(valor.periodoConsulta.fim);
  if (valor.periodoConsulta.tipo !== PERIODO_CONSULTA_PORTAL || !inicio || !fim) {
    throw new CheckpointNfseError('CHECKPOINT_CORROMPIDO', 'Período do checkpoint inválido.');
  }
  if (!Array.isArray(valor.documentos)) {
    throw new CheckpointNfseError('CHECKPOINT_CORROMPIDO', 'Checkpoint sem documentos.');
  }

  const vistos = new Set<string>();
  const documentos = valor.documentos.map((item) => documentoDe(item, vistos));
  return {
    versaoFormato: VERSAO_FORMATO_CHECKPOINT,
    execucaoId,
    cnpj,
    periodoConsulta: { tipo: PERIODO_CONSULTA_PORTAL, inicio, fim },
    fingerprintInventario,
    createdAt,
    updatedAt,
    documentos,
  };
}

function documentoDe(valor: unknown, vistos: Set<string>): DocumentoCheckpointNfse {
  if (!ehObjeto(valor)) {
    throw new CheckpointNfseError('CHECKPOINT_CORROMPIDO', 'Documento de checkpoint inválido.');
  }
  const chaveNacional = texto(valor.chaveNacional);
  if (!/^\d{50}$/.test(chaveNacional)) {
    throw new CheckpointNfseError('CHECKPOINT_CORROMPIDO', 'Chave de checkpoint inválida.');
  }
  if (vistos.has(chaveNacional)) {
    throw new CheckpointNfseError('CHECKPOINT_CORROMPIDO', 'Chave repetida no checkpoint.');
  }
  vistos.add(chaveNacional);
  const direcao = texto(valor.direcao);
  const situacao = texto(valor.situacao);
  const estado = texto(valor.estado);
  if (direcao !== 'EMITIDA' && direcao !== 'RECEBIDA') {
    throw new CheckpointNfseError('CHECKPOINT_CORROMPIDO', 'Direção de checkpoint inválida.');
  }
  if (situacao !== 'VIGENTE' && situacao !== 'CANCELADA' && situacao !== 'INDETERMINADA') {
    throw new CheckpointNfseError('CHECKPOINT_CORROMPIDO', 'Situação de checkpoint inválida.');
  }
  if (!(ESTADOS_DOCUMENTO_CHECKPOINT as readonly string[]).includes(estado)) {
    throw new CheckpointNfseError('CHECKPOINT_CORROMPIDO', 'Estado de documento desconhecido.');
  }
  const hashSha256 = valor.hashSha256 == null ? null : texto(valor.hashSha256).toLowerCase();
  if (hashSha256 !== null && !HASH_SHA256.test(hashSha256)) {
    throw new CheckpointNfseError('CHECKPOINT_CORROMPIDO', 'Hash SHA-256 do checkpoint inválido.');
  }
  const caminhoRelativo = valor.caminhoRelativo == null ? null : texto(valor.caminhoRelativo);
  if (caminhoRelativo !== null && !caminhoRelativoSeguro(caminhoRelativo)) {
    throw new CheckpointNfseError('CHECKPOINT_CORROMPIDO', 'Caminho relativo do checkpoint inválido.');
  }
  const tamanhoBytes = valor.tamanhoBytes == null ? null : valor.tamanhoBytes;
  if (tamanhoBytes !== null && (!Number.isInteger(tamanhoBytes) || Number(tamanhoBytes) < 0)) {
    throw new CheckpointNfseError('CHECKPOINT_CORROMPIDO', 'Tamanho de XML inválido no checkpoint.');
  }
  if (estado === 'PERSISTIDO' && (hashSha256 === null || caminhoRelativo === null || !tamanhoBytes)) {
    throw new CheckpointNfseError('CHECKPOINT_CORROMPIDO', 'PERSISTIDO sem hash, caminho ou tamanho.');
  }
  const updatedAt = texto(valor.updatedAt);
  if (!updatedAt) {
    throw new CheckpointNfseError('CHECKPOINT_CORROMPIDO', 'Documento de checkpoint sem data.');
  }
  return {
    chaveNacional,
    direcao: direcao as DirecaoDocumentoFiscal,
    situacao: situacao as SituacaoDocumentoFiscal,
    estado: estado as EstadoDocumentoCheckpoint,
    hashSha256,
    caminhoRelativo,
    tamanhoBytes: tamanhoBytes === null ? null : Number(tamanhoBytes),
    diagnostico: valor.diagnostico == null ? null : texto(valor.diagnostico) || null,
    codigo: valor.codigo == null ? null : texto(valor.codigo) || null,
    updatedAt,
  };
}

function caminhoRelativoSeguro(caminho: string): boolean {
  if (!caminho || caminho.includes('..') || caminho.startsWith('/') || caminho.includes('\\')) return false;
  return caminho.split('/').every((parte) => SEGMENTO_RELATIVO.test(parte));
}

const SEGMENTO_RELATIVO = /^[A-Za-z0-9._-]+$/;

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

function ehObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}
