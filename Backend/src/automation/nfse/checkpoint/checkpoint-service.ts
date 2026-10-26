/**
 * Monta e atualiza o checkpoint ao lado do plano fiscal já existente.
 * Não altera montarPlanoRecuperacao e não consulta a SEFIN.
 * API-03F: inventário completo com apenas chaves novas ou transições
 * fiscais permitidas evolui o checkpoint de forma atômica.
 */
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
import {
  alinharInventarioAoCheckpoint,
  compararInventarioComCheckpoint,
  montarCheckpointEvoluido,
} from './evolucao-checkpoint';
import { calcularFingerprintInventario } from './fingerprint-inventario';
import { getLogger } from '../../../infrastructure/logger';

const loggerPreservacao = getLogger('nfse-preservacao-situacao');
import {
  CheckpointNfseError,
  VERSAO_FORMATO_CHECKPOINT,
  type CheckpointNfse,
  type DocumentoCheckpointNfse,
  type EstadoDocumentoCheckpoint,
  type OpcoesTravaCheckpoint,
} from './types';
import type { XmlStore } from './xml-store';

export { calcularFingerprintInventario } from './fingerprint-inventario';

const ESTADOS_QUE_RECEBEM_XML: readonly EstadoDocumentoCheckpoint[] = [
  'PENDENTE',
  'EM_PROCESSAMENTO',
  'FALHA_TRANSITORIA',
  'PERSISTIDO',
];

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
  // API-03P — identidade considera situações preservadas (CANCELADA/VIGENTE vs INDETERMINADA fraca).
  const alinhado = alinharInventarioAoCheckpoint(inventario, checkpoint);
  if (checkpoint.fingerprintInventario !== calcularFingerprintInventario(alinhado)) {
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
   * Inventário completo com superconjunto ou transição fiscal permitida evolui
   * o checkpoint (API-03F) sem apagar XMLs nem rebaixar PERSISTIDO íntegro.
   */
  async criarCheckpoint(
    inventario: InventarioNfse,
    execucaoId: string,
    opcoes?: OpcoesTravaCheckpoint
  ): Promise<CheckpointNfse> {
    validarInventarioParaCheckpoint(inventario);
    const id = validarExecucaoId(execucaoId);
    const corpo = async () => {
      const existente = await this.checkpoints.carregar(inventario.cnpj, inventario.periodoConsulta);
      if (!existente) {
        const novo = this.montar(inventario, id);
        await this.checkpoints.gravar(novo);
        return novo;
      }
      if (existente.cnpj !== inventario.cnpj) {
        throw new CheckpointNfseError('IDENTIDADE_DIVERGENTE', 'Checkpoint de outro CNPJ.');
      }
      if (!periodosConsultaIguais(existente.periodoConsulta, inventario.periodoConsulta)) {
        throw new CheckpointNfseError('IDENTIDADE_DIVERGENTE', 'Checkpoint de outro período.');
      }
      if (existente.versaoFormato !== VERSAO_FORMATO_CHECKPOINT) {
        throw new CheckpointNfseError('VERSAO_INCOMPATIVEL', 'Versão do checkpoint incompatível.');
      }
      const fingerprintAtual = calcularFingerprintInventario(inventario);
      if (existente.fingerprintInventario === fingerprintAtual) {
        return existente;
      }
      const comparacao = compararInventarioComCheckpoint(existente, inventario);
      if (comparacao.tipo === 'IDENTICO') {
        // Defesa: documentos iguais com FP diferente indica corrupção — não evolui.
        throw new CheckpointNfseError(
          'IDENTIDADE_DIVERGENTE',
          'Fingerprint do inventário diverge do checkpoint.'
        );
      }
      if (comparacao.tipo === 'BLOQUEADO') {
        throw new CheckpointNfseError(comparacao.codigo, comparacao.mensagem, {
          chavesAusentes: comparacao.chavesAusentes,
          chavesDirecaoDivergente: comparacao.chavesDirecaoDivergente,
          transicoesInvalidas: comparacao.transicoesInvalidas,
          fingerprintCheckpoint: existente.fingerprintInventario,
          fingerprintInventario: fingerprintAtual,
        });
      }
      if (comparacao.preservacoesSituacao.length > 0) {
        loggerPreservacao.warn(
          {
            cnpj: inventario.cnpj,
            competencia: `${inventario.periodoConsulta.inicio}-${inventario.periodoConsulta.fim}`,
            quantidade: comparacao.preservacoesSituacao.length,
            chaves: comparacao.preservacoesSituacao.map((p) => p.chaveNacional),
            detalhes: comparacao.preservacoesSituacao.map(
              (p) => `${p.chaveNacional}:${p.situacaoMantida}←${p.situacaoDescoberta}`
            ),
          },
          'Situação fiscal confirmada preservada — descoberta posterior com menos evidência (API-03P)'
        );
      }
      const evoluido = montarCheckpointEvoluido(existente, inventario, id, this.agora(), comparacao);
      await this.checkpoints.gravar(evoluido);
      return evoluido;
    };
    if (opcoes?.jaComTrava) return corpo();
    return this.checkpoints.comTrava(inventario.cnpj, inventario.periodoConsulta, corpo);
  }

  /**
   * Grava o XML e só então marca PERSISTIDO.
   * API-03M — vigentes e indeterminadas podem persistir (XML com atenção fiscal preservado).
   */
  async persistirXml(
    inventario: InventarioNfse,
    chaveNacional: string,
    xml: string,
    opcoes?: OpcoesTravaCheckpoint
  ): Promise<CheckpointNfse> {
    validarInventarioParaCheckpoint(inventario);
    const chave = exigirChave(chaveNacional);
    const corpo = async () => {
      const atual = await this.exigirCompativel(inventario);
      const documento = this.documentoElegivelRecuperacao(atual, inventario, chave);
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
      const atencaoFiscal = documento.situacao === 'INDETERMINADA';
      const proximo = substituirDocumento(atual, chave, {
        estado: 'PERSISTIDO',
        hashSha256: gravado.hashSha256,
        caminhoRelativo: gravado.caminhoRelativo,
        tamanhoBytes: gravado.tamanhoBytes,
        diagnostico: atencaoFiscal
          ? 'XML documentalmente válido; situação fiscal do Portal não confirmada.'
          : null,
        codigo: atencaoFiscal ? 'ATENCAO_SITUACAO_NAO_CONFIRMADA' : null,
        updatedAt: this.agora(),
      }, this.agora());
      await this.checkpoints.gravar(proximo);
      return proximo;
    };
    if (opcoes?.jaComTrava) return corpo();
    return this.checkpoints.comTrava(inventario.cnpj, inventario.periodoConsulta, corpo);
  }

  async marcarEmProcessamento(
    inventario: InventarioNfse,
    chaveNacional: string,
    opcoes?: OpcoesTravaCheckpoint
  ): Promise<CheckpointNfse> {
    validarInventarioParaCheckpoint(inventario);
    const chave = exigirChave(chaveNacional);
    const corpo = async () => {
      const atual = await this.exigirCompativel(inventario);
      const documento = this.documentoElegivelRecuperacao(atual, inventario, chave);
      if (documento.estado !== 'PENDENTE' && documento.estado !== 'FALHA_TRANSITORIA') {
        throw new CheckpointNfseError('DOCUMENTO_NAO_ELEGIVEL', 'O documento não está retomável para processamento.');
      }
      const proximo = substituirDocumento(atual, chave, {
        estado: 'EM_PROCESSAMENTO',
        diagnostico: null,
        codigo: documento.situacao === 'INDETERMINADA' ? 'ATENCAO_SITUACAO_NAO_CONFIRMADA' : null,
        updatedAt: this.agora(),
      }, this.agora());
      await this.checkpoints.gravar(proximo);
      return proximo;
    };
    if (opcoes?.jaComTrava) return corpo();
    return this.checkpoints.comTrava(inventario.cnpj, inventario.periodoConsulta, corpo);
  }

  /**
   * Registra falha sem tentar de novo. A permanente conserva o diagnóstico na retomada.
   */
  async registrarFalha(
    inventario: InventarioNfse,
    chaveNacional: string,
    classe: 'TRANSITORIA' | 'PERMANENTE',
    diagnostico: string,
    codigo?: string,
    opcoes?: OpcoesTravaCheckpoint
  ): Promise<CheckpointNfse> {
    validarInventarioParaCheckpoint(inventario);
    const chave = exigirChave(chaveNacional);
    const texto = diagnostico.trim();
    if (!texto) {
      throw new CheckpointNfseError('DIAGNOSTICO_AUSENTE', 'Falha sem diagnóstico.');
    }
    if (classe !== 'TRANSITORIA' && classe !== 'PERMANENTE') {
      throw new CheckpointNfseError('CLASSE_FALHA_INVALIDA', 'Classe de falha desconhecida.');
    }
    const corpo = async () => {
      const atual = await this.exigirCompativel(inventario);
      const documento = this.documentoElegivelRecuperacao(atual, inventario, chave);
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
    };
    if (opcoes?.jaComTrava) return corpo();
    return this.checkpoints.comTrava(inventario.cnpj, inventario.periodoConsulta, corpo);
  }

  private async exigirCompativel(inventario: InventarioNfse): Promise<CheckpointNfse> {
    const atual = await this.checkpoints.carregar(inventario.cnpj, inventario.periodoConsulta);
    if (!atual) {
      throw new CheckpointNfseError('CHECKPOINT_AUSENTE', 'Checkpoint não encontrado para este CNPJ e período.');
    }
    conferirIdentidadeCheckpoint(atual, inventario);
    return atual;
  }

  /** API-03M — vigente ou indeterminada recebe XML / falha de recuperação. */
  private documentoElegivelRecuperacao(
    checkpoint: CheckpointNfse,
    inventario: InventarioNfse,
    chave: string
  ): DocumentoCheckpointNfse {
    const noInventario = inventario.documentos.find((documento) => documento.chaveNacional === chave);
    const noCheckpoint = checkpoint.documentos.find((documento) => documento.chaveNacional === chave);
    if (!noInventario || !noCheckpoint) {
      throw new CheckpointNfseError('DOCUMENTO_AUSENTE', 'A chave não pertence a este checkpoint.');
    }
    if (noInventario.cnpj !== checkpoint.cnpj || noInventario.direcao !== noCheckpoint.direcao) {
      throw new CheckpointNfseError('IDENTIDADE_DIVERGENTE', 'CNPJ ou direção do documento diverge do checkpoint.');
    }
    const elegivel =
      (noInventario.situacao === 'VIGENTE' || noInventario.situacao === 'INDETERMINADA') &&
      (noCheckpoint.situacao === 'VIGENTE' || noCheckpoint.situacao === 'INDETERMINADA');
    if (!elegivel) {
      throw new CheckpointNfseError(
        'DOCUMENTO_NAO_ELEGIVEL',
        'Só documento vigente ou indeterminado recebe XML ou falha de recuperação.'
      );
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
  // API-03M — indeterminada entra na meta SEFIN como PENDENTE (não BLOQUEADO).
  if (situacao === 'INDETERMINADA') {
    return base(
      chaveNacional,
      direcao,
      situacao,
      'PENDENTE',
      'Situação fiscal indeterminada no Portal; XML será consultado na SEFIN.',
      'ATENCAO_SITUACAO_NAO_CONFIRMADA',
      instante
    );
  }
  return base(
    chaveNacional,
    direcao,
    situacao,
    'PENDENTE',
    null,
    null,
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
