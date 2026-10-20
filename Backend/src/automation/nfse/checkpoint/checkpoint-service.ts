/**
 * Monta e atualiza o checkpoint ao lado do plano fiscal já existente.
 * Não altera montarPlanoRecuperacao e não consulta a SEFIN.
 */
import { createHash } from 'node:crypto';
import {
  normalizarCnpjEmpresa,
  validarChaveNacional,
  type SituacaoDocumentoFiscal,
} from '../contracts/documento-fiscal';
import { calcularTotaisInventario, type InventarioNfse } from '../contracts/inventario';
import {
  PERIODO_CONSULTA_PORTAL,
  criarPeriodoConsultaPortal,
  periodosConsultaIguais,
} from '../contracts/periodo';
import type { CheckpointStore } from './checkpoint-store';
import { CheckpointNfseError, VERSAO_FORMATO_CHECKPOINT, type CheckpointNfse, type DocumentoCheckpointNfse, type EstadoDocumentoCheckpoint } from './types';
import type { XmlStore } from './xml-store';

const ESTADOS_QUE_RECEBEM_XML: readonly EstadoDocumentoCheckpoint[] = [
  'PENDENTE',
  'EM_PROCESSAMENTO',
  'FALHA_TRANSITORIA',
  'PERSISTIDO',
];

/**
 * SHA-256 hex de CNPJ, início, fim e documentos ordenados pela chave.
 * Cada documento entra só com chave, direção e situação.
 * Senha, PFX, chave privada, XML e dCompet ficam de fora.
 */
export function calcularFingerprintInventario(inventario: InventarioNfse): string {
  const linhas = [...inventario.documentos]
    .map((documento) => `${documento.chaveNacional}:${documento.direcao}:${documento.situacao}`)
    .sort();
  const canonico = [inventario.cnpj, inventario.periodoConsulta.inicio, inventario.periodoConsulta.fim, ...linhas].join(
    '\n'
  );
  return createHash('sha256').update(canonico, 'utf8').digest('hex');
}

export function validarInventarioParaCheckpoint(inventario: InventarioNfse): void {
  if (!inventario || typeof inventario !== 'object') {
    throw new CheckpointNfseError('INVENTARIO_INVALIDO', 'Inventário ausente.');
  }
  let cnpj: string;
  try {
    cnpj = normalizarCnpjEmpresa(inventario.cnpj);
  } catch {
    throw new CheckpointNfseError('INVENTARIO_INVALIDO', 'CNPJ do inventário inválido.');
  }
  if (cnpj !== inventario.cnpj) {
    throw new CheckpointNfseError('INVENTARIO_INVALIDO', 'CNPJ do inventário não está normalizado.');
  }
  if (inventario.periodoConsulta?.tipo !== PERIODO_CONSULTA_PORTAL) {
    throw new CheckpointNfseError('INVENTARIO_INVALIDO', 'Período precisa ser PERIODO_CONSULTA_PORTAL.');
  }
  try {
    const periodo = criarPeriodoConsultaPortal(inventario.periodoConsulta.inicio, inventario.periodoConsulta.fim);
    if (!periodosConsultaIguais(periodo, inventario.periodoConsulta)) {
      throw new Error('periodo');
    }
  } catch (erro) {
    if (erro instanceof CheckpointNfseError) throw erro;
    throw new CheckpointNfseError('INVENTARIO_INVALIDO', 'Período de consulta inválido.');
  }
  if (inventario.completude !== 'COMPLETO') {
    throw new CheckpointNfseError('DESCOBERTA_INCOMPLETA', 'Inventário incompleto não abre checkpoint.');
  }
  if (!Array.isArray(inventario.documentos)) {
    throw new CheckpointNfseError('INCONSISTENCIA_INVENTARIO', 'Inventário sem lista de documentos.');
  }

  const chaves = new Set<string>();
  for (const documento of inventario.documentos) {
    let chave: string;
    try {
      chave = validarChaveNacional(documento.chaveNacional);
    } catch {
      throw new CheckpointNfseError('INCONSISTENCIA_INVENTARIO', 'Chave nacional inválida no inventário.');
    }
    if (chaves.has(chave)) {
      throw new CheckpointNfseError('INCONSISTENCIA_INVENTARIO', 'Chave duplicada no inventário.');
    }
    chaves.add(chave);
    if (documento.cnpj !== cnpj) {
      throw new CheckpointNfseError('INCONSISTENCIA_INVENTARIO', 'Documento de outro CNPJ no inventário.');
    }
    if (documento.direcao !== 'EMITIDA' && documento.direcao !== 'RECEBIDA') {
      throw new CheckpointNfseError('INCONSISTENCIA_INVENTARIO', 'Direção inválida no inventário.');
    }
    if (!situacaoConhecida(documento.situacao)) {
      throw new CheckpointNfseError('INCONSISTENCIA_INVENTARIO', 'Situação inválida no inventário.');
    }
    if (!periodosConsultaIguais(documento.periodoConsulta, inventario.periodoConsulta)) {
      throw new CheckpointNfseError('INCONSISTENCIA_INVENTARIO', 'Documento de outro período no inventário.');
    }
  }

  const totais = calcularTotaisInventario(inventario.documentos);
  const informado = inventario.totais;
  if (
    !informado ||
    informado.descobertos !== totais.descobertos ||
    informado.emitidas !== totais.emitidas ||
    informado.recebidas !== totais.recebidas ||
    informado.vigentes !== totais.vigentes ||
    informado.canceladas !== totais.canceladas ||
    informado.indeterminadas !== totais.indeterminadas ||
    totais.descobertos !== totais.vigentes + totais.canceladas + totais.indeterminadas ||
    totais.descobertos !== totais.emitidas + totais.recebidas
  ) {
    throw new CheckpointNfseError('INCONSISTENCIA_INVENTARIO', 'Totais do inventário incoerentes.');
  }
}

export function conferirIdentidadeCheckpoint(checkpoint: CheckpointNfse, inventario: InventarioNfse): void {
  if (checkpoint.cnpj !== inventario.cnpj) {
    throw new CheckpointNfseError('IDENTIDADE_DIVERGENTE', 'Checkpoint de outro CNPJ.');
  }
  if (!periodosConsultaIguais(checkpoint.periodoConsulta, inventario.periodoConsulta)) {
    throw new CheckpointNfseError('IDENTIDADE_DIVERGENTE', 'Checkpoint de outro período.');
  }
  if (checkpoint.fingerprintInventario !== calcularFingerprintInventario(inventario)) {
    throw new CheckpointNfseError('IDENTIDADE_DIVERGENTE', 'Fingerprint do inventário diverge do checkpoint.');
  }
}

export class CheckpointService {
  constructor(
    private readonly checkpoints: CheckpointStore,
    private readonly xmls: XmlStore,
    private readonly agora: () => string = () => new Date().toISOString()
  ) {}

  /**
   * Cria o checkpoint se o inventário for estruturalmente válido.
   * Indeterminada gera BLOQUEADO e o arquivo pode existir para auditoria.
   * A mesma identidade não é recriada: a execução repetida devolve o checkpoint atual.
   */
  async criarCheckpoint(inventario: InventarioNfse, execucaoId: string): Promise<CheckpointNfse> {
    validarInventarioParaCheckpoint(inventario);
    const id = validarExecucaoId(execucaoId);
    return this.checkpoints.comTrava(inventario.cnpj, inventario.periodoConsulta, async () => {
      const existente = await this.checkpoints.carregar(inventario.cnpj, inventario.periodoConsulta);
      if (existente) {
        conferirIdentidadeCheckpoint(existente, inventario);
        return existente;
      }
      const novo = this.montar(inventario, id);
      await this.checkpoints.gravar(novo);
      return novo;
    });
  }

  /**
   * Grava o XML e só então marca PERSISTIDO.
   * Antes da escrita, exige validação fiscal CONFIRMADA (validarXmlNfse).
   * A chave, o CNPJ e a direção são os do documento deste checkpoint.
   * Indeterminada recusa a persistência automática do período inteiro.
   */
  async persistirXml(inventario: InventarioNfse, chaveNacional: string, xml: string): Promise<CheckpointNfse> {
    validarInventarioParaCheckpoint(inventario);
    recusarIndeterminada(inventario);
    const chave = exigirChave(chaveNacional);
    return this.checkpoints.comTrava(inventario.cnpj, inventario.periodoConsulta, async () => {
      const atual = await this.exigirCompativel(inventario);
      const documento = this.documentoVigente(atual, inventario, chave);
      if (!ESTADOS_QUE_RECEBEM_XML.includes(documento.estado)) {
        throw new CheckpointNfseError('DOCUMENTO_NAO_ELEGIVEL', 'O estado do documento não permite gravar XML.');
      }
      const gravado = await this.xmls.persistir(
        atual.cnpj,
        atual.periodoConsulta,
        chave,
        xml,
        documento.direcao
      );
      if (
        documento.estado === 'PERSISTIDO' &&
        documento.hashSha256 === gravado.hashSha256 &&
        documento.tamanhoBytes === gravado.tamanhoBytes &&
        documento.caminhoRelativo === gravado.caminhoRelativo
      ) {
        return atual;
      }
      const proximo = substituirDocumento(atual, chave, {
        estado: 'PERSISTIDO',
        hashSha256: gravado.hashSha256,
        caminhoRelativo: gravado.caminhoRelativo,
        tamanhoBytes: gravado.tamanhoBytes,
        diagnostico: null,
        codigo: null,
        updatedAt: this.agora(),
      }, this.agora());
      await this.checkpoints.gravar(proximo);
      return proximo;
    });
  }

  async marcarEmProcessamento(inventario: InventarioNfse, chaveNacional: string): Promise<CheckpointNfse> {
    validarInventarioParaCheckpoint(inventario);
    recusarIndeterminada(inventario);
    const chave = exigirChave(chaveNacional);
    return this.checkpoints.comTrava(inventario.cnpj, inventario.periodoConsulta, async () => {
      const atual = await this.exigirCompativel(inventario);
      const documento = this.documentoVigente(atual, inventario, chave);
      if (documento.estado !== 'PENDENTE' && documento.estado !== 'FALHA_TRANSITORIA') {
        throw new CheckpointNfseError('DOCUMENTO_NAO_ELEGIVEL', 'O documento não está retomável para processamento.');
      }
      const proximo = substituirDocumento(atual, chave, {
        estado: 'EM_PROCESSAMENTO',
        diagnostico: null,
        codigo: null,
        updatedAt: this.agora(),
      }, this.agora());
      await this.checkpoints.gravar(proximo);
      return proximo;
    });
  }

  /**
   * Registra falha sem tentar de novo. A permanente conserva o diagnóstico na retomada.
   */
  async registrarFalha(
    inventario: InventarioNfse,
    chaveNacional: string,
    classe: 'TRANSITORIA' | 'PERMANENTE',
    diagnostico: string,
    codigo?: string
  ): Promise<CheckpointNfse> {
    validarInventarioParaCheckpoint(inventario);
    recusarIndeterminada(inventario);
    const chave = exigirChave(chaveNacional);
    const texto = diagnostico.trim();
    if (!texto) {
      throw new CheckpointNfseError('DIAGNOSTICO_AUSENTE', 'Falha sem diagnóstico.');
    }
    if (classe !== 'TRANSITORIA' && classe !== 'PERMANENTE') {
      throw new CheckpointNfseError('CLASSE_FALHA_INVALIDA', 'Classe de falha desconhecida.');
    }
    return this.checkpoints.comTrava(inventario.cnpj, inventario.periodoConsulta, async () => {
      const atual = await this.exigirCompativel(inventario);
      const documento = this.documentoVigente(atual, inventario, chave);
      if (documento.estado !== 'PENDENTE' && documento.estado !== 'EM_PROCESSAMENTO' && documento.estado !== 'FALHA_TRANSITORIA') {
        throw new CheckpointNfseError('DOCUMENTO_NAO_ELEGIVEL', 'O estado do documento não recebe esta falha.');
      }
      const proximo = substituirDocumento(atual, chave, {
        estado: classe === 'TRANSITORIA' ? 'FALHA_TRANSITORIA' : 'FALHA_PERMANENTE',
        diagnostico: texto,
        codigo: codigo?.trim() || null,
        updatedAt: this.agora(),
      }, this.agora());
      await this.checkpoints.gravar(proximo);
      return proximo;
    });
  }

  private async exigirCompativel(inventario: InventarioNfse): Promise<CheckpointNfse> {
    const atual = await this.checkpoints.carregar(inventario.cnpj, inventario.periodoConsulta);
    if (!atual) {
      throw new CheckpointNfseError('CHECKPOINT_AUSENTE', 'Checkpoint não encontrado para este CNPJ e período.');
    }
    conferirIdentidadeCheckpoint(atual, inventario);
    return atual;
  }

  private documentoVigente(checkpoint: CheckpointNfse, inventario: InventarioNfse, chave: string): DocumentoCheckpointNfse {
    const noInventario = inventario.documentos.find((documento) => documento.chaveNacional === chave);
    const noCheckpoint = checkpoint.documentos.find((documento) => documento.chaveNacional === chave);
    if (!noInventario || !noCheckpoint) {
      throw new CheckpointNfseError('DOCUMENTO_AUSENTE', 'A chave não pertence a este checkpoint.');
    }
    if (noInventario.cnpj !== checkpoint.cnpj || noInventario.direcao !== noCheckpoint.direcao) {
      throw new CheckpointNfseError('IDENTIDADE_DIVERGENTE', 'CNPJ ou direção do documento diverge do checkpoint.');
    }
    if (noInventario.situacao !== 'VIGENTE' || noCheckpoint.situacao !== 'VIGENTE') {
      throw new CheckpointNfseError('DOCUMENTO_NAO_ELEGIVEL', 'Só documento vigente recebe XML ou falha de recuperação.');
    }
    return noCheckpoint;
  }

  private montar(inventario: InventarioNfse, execucaoId: string): CheckpointNfse {
    const instante = this.agora();
    const documentos = [...inventario.documentos]
      .sort((a, b) => a.chaveNacional.localeCompare(b.chaveNacional))
      .map((documento) => estadoInicial(documento.situacao, documento.chaveNacional, documento.direcao, instante));
    return {
      versaoFormato: VERSAO_FORMATO_CHECKPOINT,
      execucaoId,
      cnpj: inventario.cnpj,
      periodoConsulta: {
        tipo: PERIODO_CONSULTA_PORTAL,
        inicio: inventario.periodoConsulta.inicio,
        fim: inventario.periodoConsulta.fim,
      },
      fingerprintInventario: calcularFingerprintInventario(inventario),
      createdAt: instante,
      updatedAt: instante,
      documentos,
    };
  }
}

function estadoInicial(
  situacao: SituacaoDocumentoFiscal,
  chaveNacional: string,
  direcao: DocumentoCheckpointNfse['direcao'],
  instante: string
): DocumentoCheckpointNfse {
  if (situacao === 'VIGENTE') {
    return base(chaveNacional, direcao, situacao, 'PENDENTE', null, null, instante);
  }
  if (situacao === 'CANCELADA') {
    return base(
      chaveNacional,
      direcao,
      situacao,
      'EXCLUIDA_DA_RECUPERACAO',
      'Nota cancelada permanece no inventário e fica fora da recuperação.',
      null,
      instante
    );
  }
  return base(
    chaveNacional,
    direcao,
    situacao,
    'BLOQUEADO',
    'Situação indeterminada bloqueia o processamento automático até revisão.',
    'SITUACAO_INDETERMINADA',
    instante
  );
}

function base(
  chaveNacional: string,
  direcao: DocumentoCheckpointNfse['direcao'],
  situacao: SituacaoDocumentoFiscal,
  estado: EstadoDocumentoCheckpoint,
  diagnostico: string | null,
  codigo: string | null,
  instante: string
): DocumentoCheckpointNfse {
  return {
    chaveNacional,
    direcao,
    situacao,
    estado,
    hashSha256: null,
    caminhoRelativo: null,
    tamanhoBytes: null,
    diagnostico,
    codigo,
    updatedAt: instante,
  };
}

function substituirDocumento(
  checkpoint: CheckpointNfse,
  chave: string,
  parcial: Partial<DocumentoCheckpointNfse>,
  updatedAt: string
): CheckpointNfse {
  return {
    ...checkpoint,
    updatedAt,
    documentos: checkpoint.documentos.map((documento) =>
      documento.chaveNacional === chave ? { ...documento, ...parcial } : documento
    ),
  };
}

function recusarIndeterminada(inventario: InventarioNfse): void {
  if (inventario.documentos.some((documento) => documento.situacao === 'INDETERMINADA')) {
    throw new CheckpointNfseError(
      'SITUACAO_INDETERMINADA',
      'Nota indeterminada bloqueia a recuperação e a persistência automáticas.'
    );
  }
}

function exigirChave(chave: string): string {
  if (!/^\d{50}$/.test(chave)) {
    throw new CheckpointNfseError('CAMINHO_INVALIDO', 'Chave nacional inválida.');
  }
  return chave;
}

function validarExecucaoId(execucaoId: string): string {
  const valor = execucaoId.trim();
  if (!valor || valor.length > 200 || /[\0/\\]/.test(valor) || valor.includes('..')) {
    throw new CheckpointNfseError('EXECUCAO_INVALIDA', 'Identificador de execução inválido.');
  }
  return valor;
}

function situacaoConhecida(situacao: string): situacao is SituacaoDocumentoFiscal {
  return situacao === 'VIGENTE' || situacao === 'CANCELADA' || situacao === 'INDETERMINADA';
}
