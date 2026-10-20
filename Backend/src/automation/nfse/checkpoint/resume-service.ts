/**
 * Retomada local do checkpoint. Não consulta a SEFIN e não abre certificado.
 *
 * PERSISTIDO íntegro permanece. PERSISTIDO sem arquivo volta a PENDENTE.
 * Hash já registrado e divergente vira INCONSISTENTE, sem sobrescrever.
 * EM_PROCESSAMENTO volta a PENDENTE e, se houver XML no caminho da chave,
 * segue a mesma regra do pendente.
 *
 * XML órfão (arquivo presente, metadado sem hash): só promove a PERSISTIDO
 * depois da validação fiscal em memória do Commit 04, com chave, CNPJ do
 * papel, direção, situação VIGENTE e identidade já conferida. Não grava o
 * arquivo de novo e não consulta a SEFIN. Sem confirmação fiscal integral,
 * o documento permanece PENDENTE com diagnóstico. Conteúdo malformado,
 * chave ou CNPJ divergente, direção incorreta ou arquivo acima do limite
 * vira INCONSISTENTE, sem apagar e sem sobrescrever.
 */
import type { CheckpointStore } from './checkpoint-store';
import {
  conferirIdentidadeCheckpoint,
  validarInventarioParaCheckpoint,
} from './checkpoint-service';
import {
  CheckpointNfseError,
  segmentoPeriodo,
  type AlteracaoRetomadaNfse,
  type CheckpointNfse,
  type DocumentoCheckpointNfse,
  type ResultadoRetomadaNfse,
} from './types';
import type { XmlStore } from './xml-store';
import type { InventarioNfse } from '../contracts/inventario';
import { validarXmlNfse } from '../recovery/xml-validator';
import { ErroRecuperacaoSefin, LIMITES_RECUPERACAO_PADRAO } from '../recovery/types';

export async function retomarExecucaoNfse(entrada: {
  inventario: InventarioNfse;
  checkpointStore: CheckpointStore;
  xmlStore: XmlStore;
  agora?: () => string;
  /** Chamador já segura comTrava para este CNPJ/período. */
  jaComTrava?: boolean;
}): Promise<ResultadoRetomadaNfse> {
  const inventario = entrada.inventario;
  validarInventarioParaCheckpoint(inventario);
  const agora = entrada.agora ?? (() => new Date().toISOString());

  const corpo = async (): Promise<ResultadoRetomadaNfse> => {
    const checkpoint = await entrada.checkpointStore.carregar(inventario.cnpj, inventario.periodoConsulta);
    if (!checkpoint) {
      throw new CheckpointNfseError('CHECKPOINT_AUSENTE', 'Checkpoint não encontrado para este CNPJ e período.');
    }
    conferirIdentidadeCheckpoint(checkpoint, inventario);

    if (inventario.documentos.some((documento) => documento.situacao === 'INDETERMINADA')) {
      return {
        checkpoint,
        podeRetomarAutomaticamente: false,
        codigoBloqueio: 'SITUACAO_INDETERMINADA',
        alteracoes: [],
      };
    }

    const alteracoes: AlteracaoRetomadaNfse[] = [];
    const documentos: DocumentoCheckpointNfse[] = [];
    for (const documento of checkpoint.documentos) {
      const revisto = await revisarDocumento(documento, checkpoint, entrada.xmlStore, agora());
      documentos.push(revisto.documento);
      if (revisto.alteracao) alteracoes.push(revisto.alteracao);
    }

    const proximo: CheckpointNfse = alteracoes.length
      ? { ...checkpoint, documentos, updatedAt: agora() }
      : checkpoint;
    if (alteracoes.length > 0) {
      await entrada.checkpointStore.gravar(proximo);
    }
    return {
      checkpoint: proximo,
      podeRetomarAutomaticamente: true,
      codigoBloqueio: null,
      alteracoes,
    };
  };

  if (entrada.jaComTrava) return corpo();
  return entrada.checkpointStore.comTrava(inventario.cnpj, inventario.periodoConsulta, corpo);
}

async function revisarDocumento(
  documento: DocumentoCheckpointNfse,
  checkpoint: CheckpointNfse,
  xmlStore: XmlStore,
  instante: string
): Promise<{ documento: DocumentoCheckpointNfse; alteracao: AlteracaoRetomadaNfse | null }> {
  if (documento.estado === 'FALHA_PERMANENTE' || documento.estado === 'FALHA_TRANSITORIA') {
    return { documento, alteracao: null };
  }
  if (documento.estado === 'EXCLUIDA_DA_RECUPERACAO' || documento.estado === 'BLOQUEADO') {
    return { documento, alteracao: null };
  }
  if (documento.estado === 'INCONSISTENTE') {
    return { documento, alteracao: null };
  }

  if (documento.estado === 'PERSISTIDO') {
    return conferirPersistido(documento, checkpoint, xmlStore, instante);
  }

  const base = documento.estado === 'EM_PROCESSAMENTO' ? voltarParaPendente(documento, instante) : documento;
  const comArquivo = await revisarPendente(base, checkpoint, xmlStore, instante);
  if (!documentoMudou(documento, comArquivo)) {
    return { documento, alteracao: null };
  }
  return {
    documento: comArquivo,
    alteracao: {
      chaveNacional: documento.chaveNacional,
      de: documento.estado,
      para: comArquivo.estado,
      motivo: comArquivo.diagnostico ?? 'Estado revisto na retomada.',
    },
  };
}

async function conferirPersistido(
  documento: DocumentoCheckpointNfse,
  checkpoint: CheckpointNfse,
  xmlStore: XmlStore,
  instante: string
): Promise<{ documento: DocumentoCheckpointNfse; alteracao: AlteracaoRetomadaNfse | null }> {
  const arquivo = await xmlStore.verificar(checkpoint.cnpj, checkpoint.periodoConsulta, documento.chaveNacional);
  const integro =
    arquivo.existe &&
    arquivo.tamanhoBytes > 0 &&
    arquivo.hashSha256 !== null &&
    arquivo.hashSha256 === documento.hashSha256;

  if (integro) {
    return { documento, alteracao: null };
  }

  if (!arquivo.existe) {
    const revisto: DocumentoCheckpointNfse = {
      ...documento,
      estado: 'PENDENTE',
      tamanhoBytes: null,
      diagnostico: 'Arquivo ausente na retomada. O documento voltou a pendente.',
      codigo: 'XML_AUSENTE',
      updatedAt: instante,
    };
    return {
      documento: revisto,
      alteracao: {
        chaveNacional: documento.chaveNacional,
        de: 'PERSISTIDO',
        para: 'PENDENTE',
        motivo: revisto.diagnostico ?? '',
      },
    };
  }

  const revisto: DocumentoCheckpointNfse = {
    ...documento,
    estado: 'INCONSISTENTE',
    tamanhoBytes: arquivo.tamanhoBytes,
    diagnostico: 'Hash divergente ou arquivo truncado. O XML não foi sobrescrito.',
    codigo: 'XML_INCONSISTENTE',
    updatedAt: instante,
  };
  return {
    documento: revisto,
    alteracao: {
      chaveNacional: documento.chaveNacional,
      de: 'PERSISTIDO',
      para: 'INCONSISTENTE',
      motivo: revisto.diagnostico ?? '',
    },
  };
}

function voltarParaPendente(documento: DocumentoCheckpointNfse, instante: string): DocumentoCheckpointNfse {
  return {
    ...documento,
    estado: 'PENDENTE',
    diagnostico: 'Processamento interrompido. O documento voltou a pendente sem nova consulta.',
    codigo: null,
    updatedAt: instante,
  };
}

async function revisarPendente(
  documento: DocumentoCheckpointNfse,
  checkpoint: CheckpointNfse,
  xmlStore: XmlStore,
  instante: string
): Promise<DocumentoCheckpointNfse> {
  if (documento.estado !== 'PENDENTE') return documento;
  if (documento.hashSha256) return reaproveitarSeHashConhecido(documento, checkpoint, xmlStore, instante);
  return avaliarXmlOrfao(documento, checkpoint, xmlStore, instante);
}

/**
 * Hash já registrado: promove só se o arquivo conferir o SHA-256.
 * Não regrava o XML.
 */
async function reaproveitarSeHashConhecido(
  documento: DocumentoCheckpointNfse,
  checkpoint: CheckpointNfse,
  xmlStore: XmlStore,
  instante: string
): Promise<DocumentoCheckpointNfse> {
  const arquivo = await xmlStore.verificar(checkpoint.cnpj, checkpoint.periodoConsulta, documento.chaveNacional);
  if (!arquivo.existe) return documento;
  if (arquivo.tamanhoBytes > 0 && arquivo.hashSha256 !== null && arquivo.hashSha256 === documento.hashSha256) {
    return promovido(documento, checkpoint, xmlStore, arquivo.hashSha256, arquivo.tamanhoBytes, instante);
  }
  return inconsistente(
    documento,
    arquivo.tamanhoBytes,
    'Hash divergente do metadado. O XML não foi sobrescrito.',
    'XML_INCONSISTENTE',
    instante
  );
}

/**
 * Arquivo no caminho da chave, checkpoint ainda sem hash.
 * A promoção exige validação fiscal CONFIRMADA, situação VIGENTE e o caminho seguro.
 */
async function avaliarXmlOrfao(
  documento: DocumentoCheckpointNfse,
  checkpoint: CheckpointNfse,
  xmlStore: XmlStore,
  instante: string
): Promise<DocumentoCheckpointNfse> {
  const relativo = caminhoDoDocumento(checkpoint, documento, xmlStore);
  const leitura = await xmlStore.lerLimitado(
    checkpoint.cnpj,
    checkpoint.periodoConsulta,
    documento.chaveNacional,
    LIMITES_RECUPERACAO_PADRAO.maxBytesXml
  );
  if (leitura.situacao === 'ausente') return documento;
  if (leitura.situacao === 'excede_limite') {
    return inconsistente(
      documento,
      leitura.tamanhoBytes,
      `XML com ${leitura.tamanhoBytes} bytes excede o limite de ${LIMITES_RECUPERACAO_PADRAO.maxBytesXml}. O arquivo não foi lido nem sobrescrito.`,
      'XML_EXCEDE_LIMITE',
      instante
    );
  }
  if (leitura.situacao === 'leitura_incompleta') {
    return inconsistente(
      documento,
      leitura.tamanhoBytes,
      'A leitura do XML órfão não fechou o tamanho do arquivo. O arquivo não foi sobrescrito.',
      'XML_LEITURA_INCOMPLETA',
      instante
    );
  }
  if (documento.situacao !== 'VIGENTE') {
    return inconsistente(
      documento,
      leitura.tamanhoBytes,
      'XML órfão encontrado para documento que não está vigente. O arquivo não foi sobrescrito.',
      'SITUACAO_NAO_VIGENTE',
      instante
    );
  }

  let confirmado: ReturnType<typeof validarXmlNfse>;
  try {
    confirmado = validarXmlNfse(leitura.conteudo.toString('utf8'), {
      chave: documento.chaveNacional,
      cnpj: checkpoint.cnpj,
      direcao: documento.direcao,
    });
  } catch (erro) {
    if (erro instanceof ErroRecuperacaoSefin) {
      return inconsistente(
        documento,
        leitura.tamanhoBytes,
        `${erro.message} O XML não foi sobrescrito.`,
        erro.codigo,
        instante
      );
    }
    throw erro;
  }

  if (confirmado.validacao !== 'CONFIRMADA' || confirmado.chaveXml !== documento.chaveNacional) {
    return pendenteSemPromocao(
      documento,
      'O XML existe, mas a validação fiscal não confirmou a estrutura da NFS-e. O documento permanece pendente e o arquivo não foi alterado.',
      'XML_NAO_CONFIRMADO',
      instante
    );
  }
  if (leitura.tamanhoBytes <= 0) return documento;

  return {
    ...promovido(documento, checkpoint, xmlStore, leitura.hashSha256, leitura.tamanhoBytes, instante),
    caminhoRelativo: relativo,
  };
}

function caminhoDoDocumento(
  checkpoint: CheckpointNfse,
  documento: DocumentoCheckpointNfse,
  xmlStore: XmlStore
): string {
  const relativo = xmlStore.caminhoRelativo(checkpoint.cnpj, checkpoint.periodoConsulta, documento.chaveNacional);
  const esperado = `${checkpoint.cnpj}/${segmentoPeriodo(checkpoint.periodoConsulta)}/${documento.chaveNacional}.xml`;
  if (relativo !== esperado || relativo.includes('..')) {
    throw new CheckpointNfseError('CAMINHO_INVALIDO', 'O XML órfão não está no caminho desta execução.');
  }
  return relativo;
}

function promovido(
  documento: DocumentoCheckpointNfse,
  checkpoint: CheckpointNfse,
  xmlStore: XmlStore,
  hashSha256: string,
  tamanhoBytes: number,
  instante: string
): DocumentoCheckpointNfse {
  return {
    ...documento,
    estado: 'PERSISTIDO',
    hashSha256,
    caminhoRelativo: xmlStore.caminhoRelativo(checkpoint.cnpj, checkpoint.periodoConsulta, documento.chaveNacional),
    tamanhoBytes,
    diagnostico: null,
    codigo: null,
    updatedAt: instante,
  };
}

function inconsistente(
  documento: DocumentoCheckpointNfse,
  tamanhoBytes: number,
  diagnostico: string,
  codigo: string,
  instante: string
): DocumentoCheckpointNfse {
  return {
    ...documento,
    estado: 'INCONSISTENTE',
    tamanhoBytes,
    diagnostico,
    codigo,
    updatedAt: instante,
  };
}

function pendenteSemPromocao(
  documento: DocumentoCheckpointNfse,
  diagnostico: string,
  codigo: string,
  instante: string
): DocumentoCheckpointNfse {
  if (documento.estado === 'PENDENTE' && documento.diagnostico === diagnostico && documento.codigo === codigo) {
    return documento;
  }
  return {
    ...documento,
    estado: 'PENDENTE',
    hashSha256: documento.hashSha256,
    diagnostico,
    codigo,
    updatedAt: instante,
  };
}

function documentoMudou(antes: DocumentoCheckpointNfse, depois: DocumentoCheckpointNfse): boolean {
  return (
    antes.estado !== depois.estado ||
    antes.hashSha256 !== depois.hashSha256 ||
    antes.caminhoRelativo !== depois.caminhoRelativo ||
    antes.tamanhoBytes !== depois.tamanhoBytes ||
    antes.diagnostico !== depois.diagnostico ||
    antes.codigo !== depois.codigo
  );
}
