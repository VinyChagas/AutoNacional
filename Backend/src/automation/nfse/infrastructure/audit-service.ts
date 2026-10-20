/**
 * Auditoria fiscal com snapshots imutáveis por execução.
 * Evolução legítima (60% → 100%) cria novo snapshot; o mesmo conteúdo é idempotente.
 * Não registra senha, PFX, XML integral nem chave completa.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { calcularTotaisInventario, type InventarioNfse } from '../contracts/inventario';
import type { PeriodoConsultaPortal } from '../contracts/periodo';
import {
  CheckpointStore,
  escreverArquivoAtomico,
  calcularFingerprintInventario,
  type CheckpointNfse,
  type RelatorioReconciliacaoNfse,
} from '../checkpoint';
import { resolverCaminhoSeguro, segmentoPeriodo } from '../checkpoint/types';
import type { ResolvedorArmazenamentoFiscal } from './storage-resolver';
import {
  InfraestruturaNfseError,
  VERSAO_FORMATO_AUDITORIA,
  mascararChaveNacional,
  type DiagnosticoAuditoriaNfse,
  type EstadoAuditoriaFiscal,
  type RelatorioAuditoriaFiscal,
} from './types';

export interface EntradaAuditoriaFiscal {
  inventario: InventarioNfse;
  checkpoint: CheckpointNfse;
  reconciliacao: RelatorioReconciliacaoNfse;
  execucaoId: string;
  agora?: () => string;
}

export function montarAuditoriaFiscal(entrada: EntradaAuditoriaFiscal): RelatorioAuditoriaFiscal {
  const { inventario, checkpoint, reconciliacao } = entrada;
  const execucaoId = validarExecucaoId(entrada.execucaoId);
  const totais = calcularTotaisInventario(inventario.documentos ?? []);
  const fingerprint = calcularFingerprintInventario(inventario);
  const estado = derivarEstado(inventario, reconciliacao);
  const diagnosticos = montarDiagnosticos(inventario, reconciliacao, checkpoint);
  const auditadoEm = (entrada.agora ?? (() => new Date().toISOString()))();

  const parcial: Omit<RelatorioAuditoriaFiscal, 'snapshotId'> = {
    versaoFormato: VERSAO_FORMATO_AUDITORIA,
    execucaoId,
    cnpj: inventario.cnpj,
    periodoConsulta: {
      tipo: inventario.periodoConsulta.tipo,
      inicio: inventario.periodoConsulta.inicio,
      fim: inventario.periodoConsulta.fim,
    },
    fingerprintInventario: fingerprint,
    auditadoEm,
    descobertos: totais.descobertos,
    emitidas: totais.emitidas,
    recebidas: totais.recebidas,
    vigentes: totais.vigentes,
    canceladas: totais.canceladas,
    indeterminadas: totais.indeterminadas,
    persistidasVerificadas: reconciliacao.persistidosIntegros,
    pendentes: reconciliacao.pendentes,
    falhaTransitoria: reconciliacao.falhaTransitoria,
    falhaPermanente: reconciliacao.falhaPermanente,
    inconsistencias: reconciliacao.inconsistencias,
    coberturaPercentual: Math.round(reconciliacao.cobertura * 10000) / 100,
    conclusaoReconciliacao: reconciliacao.conclusao,
    estado,
    diagnosticos,
  };

  return {
    ...parcial,
    snapshotId: calcularSnapshotId(parcial),
  };
}

/**
 * Grava snapshot imutável.
 * Mesmo snapshotId + mesmo conteúdo: idempotente.
 * Conteúdo fiscal diferente: novo arquivo, histórico preservado.
 * Mesmo snapshotId com bytes divergentes: AUDITORIA_CONFLITO.
 */
export async function persistirAuditoriaFiscal(
  resolvedor: ResolvedorArmazenamentoFiscal,
  relatorio: RelatorioAuditoriaFiscal,
  opcoes?: { jaComTrava?: boolean }
): Promise<string> {
  if (relatorio.versaoFormato !== VERSAO_FORMATO_AUDITORIA) {
    throw new InfraestruturaNfseError('AUDITORIA_INCOMPATIVEL', 'Versão de auditoria incompatível.');
  }
  const esperado = calcularSnapshotId(relatorio);
  if (relatorio.snapshotId !== esperado) {
    throw new InfraestruturaNfseError('AUDITORIA_INCOMPATIVEL', 'snapshotId diverge do conteúdo fiscal.');
  }
  const destino = caminhoSnapshotAuditoria(resolvedor, relatorio);
  const buffer = Buffer.from(`${JSON.stringify(relatorio, null, 2)}\n`, 'utf8');

  const corpo = async () => {
    try {
      const existenteBruto = await readFile(destino, 'utf8');
      if (existenteBruto === buffer.toString('utf8')) return destino;
      const existente = interpretarAuditoria(existenteBruto);
      // Mesmo snapshotId = mesmo conteúdo fiscal; auditadoEm diferente não cria conflito.
      if (existente.snapshotId === relatorio.snapshotId) return destino;
      throw new InfraestruturaNfseError(
        'AUDITORIA_CONFLITO',
        'Snapshot de auditoria já existe com conteúdo divergente.'
      );
    } catch (erro) {
      if (erro instanceof InfraestruturaNfseError) throw erro;
      if ((erro as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new InfraestruturaNfseError('FALHA_LEITURA', 'Falha ao ler snapshot de auditoria.');
      }
    }
    try {
      await escreverArquivoAtomico(destino, buffer);
    } catch {
      throw new InfraestruturaNfseError('FALHA_ESCRITA', 'Falha ao gravar a auditoria fiscal.');
    }
    return destino;
  };

  if (opcoes?.jaComTrava) return corpo();
  return new CheckpointStore(resolvedor.raizCheckpoints()).comTrava(
    relatorio.cnpj,
    relatorio.periodoConsulta,
    corpo
  );
}

export async function listarSnapshotsAuditoria(
  resolvedor: ResolvedorArmazenamentoFiscal,
  cnpj: string,
  periodo: PeriodoConsultaPortal,
  execucaoId: string
): Promise<RelatorioAuditoriaFiscal[]> {
  const pasta = diretorioExecucaoAuditoria(resolvedor, cnpj, periodo, execucaoId);
  let nomes: string[];
  try {
    nomes = await readdir(pasta);
  } catch (erro) {
    if ((erro as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new InfraestruturaNfseError('FALHA_LEITURA', 'Falha ao listar snapshots de auditoria.');
  }

  const relatorios: RelatorioAuditoriaFiscal[] = [];
  for (const nome of nomes) {
    if (!/^[a-f0-9]{32}\.json$/.test(nome)) continue;
    const bruto = await readFile(path.join(pasta, nome), 'utf8');
    const lido = interpretarAuditoria(bruto);
    if (lido.cnpj !== cnpj || !mesmoPeriodo(lido.periodoConsulta, periodo) || lido.execucaoId !== execucaoId) {
      throw new InfraestruturaNfseError(
        'AUDITORIA_INCOMPATIVEL',
        'Snapshot de outra empresa, período ou execução no diretório.'
      );
    }
    if (`${lido.snapshotId}.json` !== nome) {
      throw new InfraestruturaNfseError('AUDITORIA_INCOMPATIVEL', 'Nome do snapshot diverge do snapshotId.');
    }
    relatorios.push(lido);
  }

  return relatorios.sort((a, b) => {
    if (a.auditadoEm !== b.auditadoEm) return a.auditadoEm < b.auditadoEm ? -1 : 1;
    return a.snapshotId < b.snapshotId ? -1 : 1;
  });
}

export async function obterAuditoriaMaisRecente(
  resolvedor: ResolvedorArmazenamentoFiscal,
  cnpj: string,
  periodo: PeriodoConsultaPortal,
  execucaoId: string
): Promise<RelatorioAuditoriaFiscal> {
  const lista = await listarSnapshotsAuditoria(resolvedor, cnpj, periodo, execucaoId);
  if (lista.length === 0) {
    throw new InfraestruturaNfseError('AUDITORIA_AUSENTE', 'Nenhum snapshot de auditoria para esta execução.');
  }
  return lista[lista.length - 1]!;
}

export function caminhoSnapshotAuditoria(
  resolvedor: ResolvedorArmazenamentoFiscal,
  relatorio: Pick<RelatorioAuditoriaFiscal, 'cnpj' | 'periodoConsulta' | 'execucaoId' | 'snapshotId'>
): string {
  if (!/^[a-f0-9]{32}$/.test(relatorio.snapshotId)) {
    throw new InfraestruturaNfseError('AUDITORIA_INCOMPATIVEL', 'snapshotId inválido.');
  }
  return resolverCaminhoSeguro(resolvedor.raizAuditoria(), [
    exigirCnpj(relatorio.cnpj),
    segmentoPeriodo(relatorio.periodoConsulta),
    validarExecucaoId(relatorio.execucaoId),
    `${relatorio.snapshotId}.json`,
  ]);
}

/** @deprecated Preferir caminhoSnapshotAuditoria. Mantido como alias tipado. */
export function caminhoAuditoria(
  resolvedor: ResolvedorArmazenamentoFiscal,
  relatorio: Pick<RelatorioAuditoriaFiscal, 'cnpj' | 'periodoConsulta' | 'execucaoId' | 'snapshotId'>
): string {
  return caminhoSnapshotAuditoria(resolvedor, relatorio);
}

/**
 * Identidade do snapshot: conteúdo fiscal canônico, sem auditadoEm.
 * Assim o mesmo estado em outro instante permanece idempotente.
 */
export function calcularSnapshotId(
  relatorio: Omit<RelatorioAuditoriaFiscal, 'snapshotId'> | RelatorioAuditoriaFiscal
): string {
  const canonico = {
    versaoFormato: relatorio.versaoFormato,
    execucaoId: relatorio.execucaoId,
    cnpj: relatorio.cnpj,
    periodoConsulta: relatorio.periodoConsulta,
    fingerprintInventario: relatorio.fingerprintInventario,
    descobertos: relatorio.descobertos,
    emitidas: relatorio.emitidas,
    recebidas: relatorio.recebidas,
    vigentes: relatorio.vigentes,
    canceladas: relatorio.canceladas,
    indeterminadas: relatorio.indeterminadas,
    persistidasVerificadas: relatorio.persistidasVerificadas,
    pendentes: relatorio.pendentes,
    falhaTransitoria: relatorio.falhaTransitoria,
    falhaPermanente: relatorio.falhaPermanente,
    inconsistencias: relatorio.inconsistencias,
    coberturaPercentual: relatorio.coberturaPercentual,
    conclusaoReconciliacao: relatorio.conclusaoReconciliacao,
    estado: relatorio.estado,
    diagnosticos: relatorio.diagnosticos,
  };
  return createHash('sha256').update(JSON.stringify(canonico), 'utf8').digest('hex').slice(0, 32);
}

export function nomeArquivoAuditoria(destino: string): string {
  return path.basename(destino);
}

function diretorioExecucaoAuditoria(
  resolvedor: ResolvedorArmazenamentoFiscal,
  cnpj: string,
  periodo: PeriodoConsultaPortal,
  execucaoId: string
): string {
  return resolverCaminhoSeguro(resolvedor.raizAuditoria(), [
    exigirCnpj(cnpj),
    segmentoPeriodo(periodo),
    validarExecucaoId(execucaoId),
  ]);
}

function interpretarAuditoria(bruto: string): RelatorioAuditoriaFiscal {
  let valor: unknown;
  try {
    valor = JSON.parse(bruto);
  } catch {
    throw new InfraestruturaNfseError('AUDITORIA_INCOMPATIVEL', 'Snapshot de auditoria com JSON inválido.');
  }
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
    throw new InfraestruturaNfseError('AUDITORIA_INCOMPATIVEL', 'Snapshot de auditoria inválido.');
  }
  const obj = valor as RelatorioAuditoriaFiscal;
  if (obj.versaoFormato !== VERSAO_FORMATO_AUDITORIA || typeof obj.snapshotId !== 'string') {
    throw new InfraestruturaNfseError('AUDITORIA_INCOMPATIVEL', 'Snapshot de auditoria incompatível.');
  }
  if (calcularSnapshotId(obj) !== obj.snapshotId) {
    throw new InfraestruturaNfseError('AUDITORIA_INCOMPATIVEL', 'snapshotId não confere com o conteúdo.');
  }
  return obj;
}

function derivarEstado(
  inventario: InventarioNfse,
  reconciliacao: RelatorioReconciliacaoNfse
): EstadoAuditoriaFiscal {
  if (inventario.documentos.some((documento) => documento.situacao === 'INDETERMINADA')) {
    return 'BLOQUEADA';
  }
  if (reconciliacao.conclusao === 'RECONCILIADA') {
    return 'RECONCILIADA';
  }
  return 'PARCIAL';
}

function montarDiagnosticos(
  inventario: InventarioNfse,
  reconciliacao: RelatorioReconciliacaoNfse,
  checkpoint: CheckpointNfse
): DiagnosticoAuditoriaNfse[] {
  const lista: DiagnosticoAuditoriaNfse[] = [];
  for (const motivo of reconciliacao.motivos) {
    lista.push({ codigo: 'RECONCILIACAO', mensagem: motivo });
  }
  for (const chave of reconciliacao.chavesFaltantes) {
    lista.push({
      codigo: 'CHAVE_FALTANTE',
      mensagem: 'Chave do inventário ausente no checkpoint.',
      chaveMascarada: mascararChaveNacional(chave),
    });
  }
  for (const chave of reconciliacao.divergenciasHash) {
    lista.push({
      codigo: 'HASH_DIVERGENTE',
      mensagem: 'Hash do XML diverge do metadado.',
      chaveMascarada: mascararChaveNacional(chave),
    });
  }
  for (const documento of checkpoint.documentos) {
    if (documento.estado === 'FALHA_TRANSITORIA' || documento.estado === 'FALHA_PERMANENTE') {
      lista.push({
        codigo: documento.codigo ?? documento.estado,
        mensagem: documento.diagnostico ?? 'Falha registrada no checkpoint.',
        chaveMascarada: mascararChaveNacional(documento.chaveNacional),
      });
    }
  }
  if (inventario.completude !== 'COMPLETO') {
    lista.push({ codigo: 'DESCOBERTA_INCOMPLETA', mensagem: 'Inventário sem completude COMPLETO.' });
  }
  return lista;
}

function validarExecucaoId(execucaoId: string): string {
  const valor = execucaoId.trim();
  if (!valor || valor.length > 120 || /[^\w.-]/.test(valor) || valor.includes('..')) {
    throw new InfraestruturaNfseError('CAMINHO_INVALIDO', 'Identificador de execução inválido para auditoria.');
  }
  return valor;
}

function exigirCnpj(cnpj: string): string {
  if (!/^\d{14}$/.test(cnpj)) {
    throw new InfraestruturaNfseError('CNPJ_INVALIDO', 'CNPJ inválido na auditoria.');
  }
  return cnpj;
}

function mesmoPeriodo(a: PeriodoConsultaPortal, b: PeriodoConsultaPortal): boolean {
  return a.tipo === b.tipo && a.inicio === b.inicio && a.fim === b.fim;
}
