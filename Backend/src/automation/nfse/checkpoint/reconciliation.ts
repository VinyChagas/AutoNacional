/**
 * Reconciliação pura entre inventário, checkpoint e arquivos já verificados.
 * Não lê disco, não trata HTTP e não usa dCompet como critério de exclusão.
 *
 * Cobertura = persistidos íntegros / vigentes.
 * Cancelada fica fora do denominador.
 * Com zero vigentes e nenhuma inconsistência bloqueante, a cobertura é 1.
 * Nesse caso a conclusão ainda exige inventário completo, identidade consistente
 * e nenhuma indeterminada.
 */
import { calcularTotaisInventario, type InventarioNfse } from '../contracts/inventario';
import { periodosConsultaIguais } from '../contracts/periodo';
import { calcularFingerprintInventario } from './checkpoint-service';
import { alinharInventarioAoCheckpoint } from './evolucao-checkpoint';
import {
  VERSAO_FORMATO_CHECKPOINT,
  type ArquivoVerificadoNfse,
  type CheckpointNfse,
  type RelatorioReconciliacaoNfse,
} from './types';

export function reconciliarNfse(
  inventario: InventarioNfse,
  checkpoint: CheckpointNfse,
  arquivosVerificados: readonly ArquivoVerificadoNfse[]
): RelatorioReconciliacaoNfse {
  const totais = calcularTotaisInventario(inventario.documentos ?? []);
  const motivos: string[] = [];
  const identidadeConsistente = identidadeConfere(inventario, checkpoint, motivos);
  if (inventario.completude !== 'COMPLETO') {
    motivos.push('Inventário sem completude COMPLETO.');
  }
  if (!totaisInformadosCoerentes(inventario, totais)) {
    motivos.push('Totais do inventário incoerentes.');
  }

  const chavesInventario = inventario.documentos.map((documento) => documento.chaveNacional);
  const chavesCheckpoint = checkpoint.documentos.map((documento) => documento.chaveNacional);
  const chavesArquivo = arquivosVerificados.map((arquivo) => arquivo.chaveNacional);
  const chavesDuplicadas = unicasOrdenadas([
    ...repetidas(chavesCheckpoint),
    ...repetidas(chavesArquivo),
  ]);
  const conjuntoInventario = new Set(chavesInventario);
  const conjuntoCheckpoint = new Set(chavesCheckpoint);
  const chavesFaltantes = unicasOrdenadas(
    chavesInventario.filter((chave) => !conjuntoCheckpoint.has(chave))
  );
  const excedentesNaoJustificados: string[] = [
    ...chavesCheckpoint.filter((chave) => !conjuntoInventario.has(chave)),
    ...chavesArquivo.filter((chave) => !conjuntoInventario.has(chave)),
  ];

  const arquivoPorChave = new Map<string, ArquivoVerificadoNfse[]>();
  for (const arquivo of arquivosVerificados) {
    const lista = arquivoPorChave.get(arquivo.chaveNacional) ?? [];
    lista.push(arquivo);
    arquivoPorChave.set(arquivo.chaveNacional, lista);
  }
  const documentoPorChave = new Map(checkpoint.documentos.map((documento) => [documento.chaveNacional, documento]));

  const divergencias = new Set<string>();
  const inconsistentes = new Set<string>();
  let persistidosIntegros = 0;
  let pendentes = 0;
  let falhaTransitoria = 0;
  let falhaPermanente = 0;
  const chavesVigentesSemXml: string[] = [];

  for (const documento of checkpoint.documentos) {
    if (documento.estado === 'FALHA_TRANSITORIA') falhaTransitoria += 1;
    if (documento.estado === 'FALHA_PERMANENTE') falhaPermanente += 1;
    if (documento.estado === 'PENDENTE' || documento.estado === 'EM_PROCESSAMENTO') {
      if (documento.situacao === 'VIGENTE') pendentes += 1;
    }
    if (documento.estado === 'INCONSISTENTE') inconsistentes.add(documento.chaveNacional);
  }

  for (const documento of inventario.documentos) {
    if (documento.situacao !== 'VIGENTE') continue;
    const estado = documentoPorChave.get(documento.chaveNacional);
    const arquivos = arquivoPorChave.get(documento.chaveNacional) ?? [];
    const arquivo = arquivos.length === 1 ? arquivos[0] : null;
    const hashConfere =
      estado?.estado === 'PERSISTIDO' &&
      estado.hashSha256 !== null &&
      arquivo !== null &&
      arquivo.existe &&
      arquivo.tamanhoBytes > 0 &&
      arquivo.hashSha256 === estado.hashSha256;
    if (hashConfere) {
      persistidosIntegros += 1;
      continue;
    }
    chavesVigentesSemXml.push(documento.chaveNacional);
    if (estado?.estado === 'PERSISTIDO' || (estado?.hashSha256 && arquivo?.hashSha256 && arquivo.hashSha256 !== estado.hashSha256)) {
      divergencias.add(documento.chaveNacional);
      inconsistentes.add(documento.chaveNacional);
    }
  }

  for (const documento of inventario.documentos) {
    if (documento.situacao === 'VIGENTE') continue;
    // CANCELADA (incl. original substituída) pode manter XML histórico — não é excedente.
    if (documento.situacao === 'CANCELADA') continue;
    // API-03M — indeterminada com XML recuperado é pendência fiscal, não excedente.
    if (documento.situacao === 'INDETERMINADA') continue;
    const arquivos = arquivoPorChave.get(documento.chaveNacional) ?? [];
    if (arquivos.some((arquivo) => arquivo.existe)) {
      excedentesNaoJustificados.push(documento.chaveNacional);
      inconsistentes.add(documento.chaveNacional);
      motivos.push(`XML não justificado para documento ${documento.situacao}.`);
    }
  }

  const chavesExcedentes = unicasOrdenadas(excedentesNaoJustificados);

  for (const [chave, arquivos] of arquivoPorChave) {
    const documento = documentoPorChave.get(chave);
    if (!documento?.hashSha256) continue;
    for (const arquivo of arquivos) {
      if (arquivo.hashSha256 && arquivo.hashSha256 !== documento.hashSha256) {
        divergencias.add(chave);
        inconsistentes.add(chave);
      }
    }
  }

  const divergenciasHash = unicasOrdenadas([...divergencias]);
  const inconsistenciaBloqueante =
    chavesFaltantes.length > 0 ||
    chavesExcedentes.length > 0 ||
    chavesDuplicadas.length > 0 ||
    divergenciasHash.length > 0 ||
    inconsistentes.size > 0;

  const cobertura = totais.vigentes === 0 ? (inconsistenciaBloqueante ? 0 : 1) : persistidosIntegros / totais.vigentes;

  // Falhas de vigentes (não de indeterminadas) impedem vigentesProntos.
  const falhaVigente =
    checkpoint.documentos.filter(
      (d) =>
        d.situacao === 'VIGENTE' &&
        (d.estado === 'FALHA_TRANSITORIA' || d.estado === 'FALHA_PERMANENTE')
    ).length > 0;
  const vigentesProntos =
    totais.vigentes === persistidosIntegros && pendentes === 0 && !falhaVigente;
  const estadosAceitos = checkpoint.documentos.every((documento) => {
    if (documento.situacao === 'VIGENTE') return documento.estado === 'PERSISTIDO';
    if (documento.situacao === 'CANCELADA') return documento.estado === 'EXCLUIDA_DA_RECUPERACAO';
    // API-03M — indeterminada pode estar PENDENTE, PERSISTIDO (atenção) ou falha documental.
    if (documento.situacao === 'INDETERMINADA') {
      return (
        documento.estado === 'PENDENTE' ||
        documento.estado === 'PERSISTIDO' ||
        documento.estado === 'EM_PROCESSAMENTO' ||
        documento.estado === 'FALHA_TRANSITORIA' ||
        documento.estado === 'FALHA_PERMANENTE'
      );
    }
    return false;
  });

  const xmlsComAtencaoFiscal = checkpoint.documentos.filter(
    (d) =>
      d.situacao === 'INDETERMINADA' &&
      d.estado === 'PERSISTIDO' &&
      d.codigo === 'ATENCAO_SITUACAO_NAO_CONFIRMADA'
  ).length;

  if (totais.indeterminadas > 0) {
    motivos.push(
      `Há ${totais.indeterminadas} nota(s) com situação fiscal pendente (não conta como vigente confirmado).`
    );
  }
  if (!vigentesProntos) motivos.push('Nem todo documento vigente está persistido com hash verificado.');
  if (chavesFaltantes.length > 0) motivos.push('Há chave do inventário ausente no checkpoint.');
  if (chavesExcedentes.length > 0) motivos.push('Há chave excedente não justificada.');
  if (chavesDuplicadas.length > 0) motivos.push('Há chave duplicada.');
  if (divergenciasHash.length > 0 || inconsistentes.size > 0) motivos.push('Há inconsistência bloqueante.');
  if (inventario.documentos.length > 0 && !estadosAceitos) {
    motivos.push('Estado de documento incompatível com a conclusão.');
  }

  // RECONCILIADA fiscal ainda exige zero indeterminadas (rigor).
  const reconciliada =
    inventario.completude === 'COMPLETO' &&
    identidadeConsistente &&
    totaisInformadosCoerentes(inventario, totais) &&
    totais.indeterminadas === 0 &&
    vigentesProntos &&
    chavesFaltantes.length === 0 &&
    chavesExcedentes.length === 0 &&
    chavesDuplicadas.length === 0 &&
    divergenciasHash.length === 0 &&
    inconsistentes.size === 0 &&
    (inventario.documentos.length === 0 || estadosAceitos);

  return {
    descobertos: totais.descobertos,
    vigentes: totais.vigentes,
    canceladas: totais.canceladas,
    indeterminadas: totais.indeterminadas,
    persistidosIntegros,
    xmlsComAtencaoFiscal,
    chavesVigentesSemXml: unicasOrdenadas(chavesVigentesSemXml),
    pendentes,
    falhaTransitoria,
    falhaPermanente,
    inconsistencias: inconsistentes.size,
    cobertura,
    chavesFaltantes,
    chavesExcedentes,
    chavesDuplicadas,
    divergenciasHash,
    identidadeConsistente,
    conclusao: reconciliada ? 'RECONCILIADA' : 'NAO_RECONCILIADA',
    motivos: reconciliada ? [] : unicos(motivos),
  };
}

function identidadeConfere(inventario: InventarioNfse, checkpoint: CheckpointNfse, motivos: string[]): boolean {
  // API-03P — fingerprint efetivo após preservação de situação confirmada.
  const fingerprint = calcularFingerprintInventario(
    alinharInventarioAoCheckpoint(inventario, checkpoint)
  );
  const ok =
    checkpoint.versaoFormato === VERSAO_FORMATO_CHECKPOINT &&
    checkpoint.cnpj === inventario.cnpj &&
    periodosConsultaIguais(checkpoint.periodoConsulta, inventario.periodoConsulta) &&
    checkpoint.fingerprintInventario === fingerprint;
  if (!ok) motivos.push('Identidade do checkpoint diverge do inventário.');
  return ok;
}

function totaisInformadosCoerentes(
  inventario: InventarioNfse,
  totais: ReturnType<typeof calcularTotaisInventario>
): boolean {
  const informado = inventario.totais;
  if (!informado) return false;
  return (
    informado.descobertos === totais.descobertos &&
    informado.vigentes === totais.vigentes &&
    informado.canceladas === totais.canceladas &&
    informado.indeterminadas === totais.indeterminadas &&
    informado.emitidas === totais.emitidas &&
    informado.recebidas === totais.recebidas
  );
}

function repetidas(chaves: readonly string[]): string[] {
  const contagem = new Map<string, number>();
  for (const chave of chaves) contagem.set(chave, (contagem.get(chave) ?? 0) + 1);
  return [...contagem.entries()].filter(([, quantidade]) => quantidade > 1).map(([chave]) => chave);
}

function unicasOrdenadas(chaves: readonly string[]): string[] {
  return [...new Set(chaves)].sort();
}

function unicos(valores: readonly string[]): string[] {
  return [...new Set(valores)];
}
