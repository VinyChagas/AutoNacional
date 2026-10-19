/**
 * Resultado consolidado de um processamento interno de NFS-e.
 * A associação método → motor descreve a estratégia futura.
 * Ela não escolhe fila, browser nem substitui executarFluxoCompleto.
 */
import { auditarRecuperacao, type AuditoriaRecuperacao } from './auditoria';
import type { DocumentoFiscalNfse } from './documento-fiscal';
import { ContratoNfseError } from './erros';
import {
  calcularTotaisInventario,
  type InventarioNfse,
} from './inventario';
import type { PeriodoConsultaPortal } from './periodo';
import {
  xmlRecuperadoUtilizavel,
  type RecuperacaoDocumento,
} from './recuperacao';

/** Mesmo vocabulário de ExecutionEventStarted.metodo e LoginMetodo. */
export type MetodoAutenticacaoExecucao = 'CERTIFICADO' | 'CREDENCIAL';

/** Estratégia interna de processamento. SEFIN_A1 ainda não é chamado. */
export type MotorProcessamento = 'SEFIN_A1' | 'PORTAL_BROWSER';

/**
 * Equivale a TipoAutenticacao do worker (`certificado` | `credenciais`).
 * O contrato não importa execution-service.
 */
export const METODO_PARA_TIPO_AUTENTICACAO = {
  CERTIFICADO: 'certificado',
  CREDENCIAL: 'credenciais',
} as const;

export interface MotorProcessamentoContrato {
  motor: MotorProcessamento;
  metodoAutenticacao: MetodoAutenticacaoExecucao;
  nome: string;
}

export const MOTORES_PROCESSAMENTO: readonly MotorProcessamentoContrato[] = [
  {
    motor: 'SEFIN_A1',
    metodoAutenticacao: 'CERTIFICADO',
    nome: 'Recuperação SEFIN com certificado A1',
  },
  {
    motor: 'PORTAL_BROWSER',
    metodoAutenticacao: 'CREDENCIAL',
    nome: 'Download pelo navegador do Portal Nacional',
  },
];

export type StatusExecucaoNfse =
  | 'PENDENTE'
  | 'EM_EXECUCAO'
  | 'CONCLUIDA'
  | 'BLOQUEADA'
  | 'FALHOU';

/** Status já gravado em `execucoes`. BLOQUEADA não tem coluna equivalente. */
export const STATUS_EXECUCAO_NFSE_PARA_EXECUCOES = {
  PENDENTE: 'pendente',
  EM_EXECUCAO: 'em_execucao',
  CONCLUIDA: 'concluido',
  FALHOU: 'falhou',
} as const;

export type StatusExecucoesPersistivel =
  (typeof STATUS_EXECUCAO_NFSE_PARA_EXECUCOES)[keyof typeof STATUS_EXECUCAO_NFSE_PARA_EXECUCOES];

export interface ContagensExecucaoNfse {
  emitidas: number;
  recebidas: number;
  vigentes: number;
  canceladas: number;
  indeterminadas: number;
  recuperados: number;
  reutilizados: number;
  pendentes: number;
  falhos: number;
  bloqueados: number;
}

/** Campos que ExecutionEventCounts já transporta. Indeterminada não entra neles. */
export interface ContagensSseCompativeis {
  qtd_emitidas: number;
  qtd_recebidas: number;
  qtd_canceladas: number;
}

export interface ArtefatosExecucaoNfse {
  diretorioBase?: string;
  diretorioXmlVigentes?: string;
  diretorioInventario?: string;
  diretorioAuditoria?: string;
}

export type CodigoPendenciaExecucao =
  | 'SITUACAO_INDETERMINADA'
  | 'RECUPERACAO_PENDENTE'
  | 'XML_AUSENTE'
  | 'XML_INVALIDO'
  | 'XML_DUPLICADO';

export interface PendenciaExecucaoNfse {
  chaveNacional?: string;
  codigo: CodigoPendenciaExecucao;
  mensagem: string;
}

export interface ErroExecucaoNfse {
  codigo: string;
  mensagem: string;
}

export interface ResultadoExecucaoNfse {
  execucaoId: string;
  cnpj: string;
  periodoConsulta: PeriodoConsultaPortal;
  metodoAutenticacao: MetodoAutenticacaoExecucao;
  motor: MotorProcessamento;
  status: StatusExecucaoNfse;
  contagens: ContagensExecucaoNfse;
  contagensCompativeis: ContagensSseCompativeis;
  artefatos: ArtefatosExecucaoNfse;
  erros: ErroExecucaoNfse[];
  pendencias: PendenciaExecucaoNfse[];
  inventario: InventarioNfse;
  recuperacoes: RecuperacaoDocumento[];
  auditoria: AuditoriaRecuperacao;
}

export interface ConsolidarExecucaoInput {
  execucaoId: string;
  metodoAutenticacao: MetodoAutenticacaoExecucao;
  motor: MotorProcessamento;
  inventario: InventarioNfse;
  recuperacoes: readonly RecuperacaoDocumento[];
  artefatos?: ArtefatosExecucaoNfse;
  erros?: readonly ErroExecucaoNfse[];
}

export function motorAssociadoAoMetodo(metodo: MetodoAutenticacaoExecucao): MotorProcessamento {
  const associado = MOTORES_PROCESSAMENTO.find((item) => item.metodoAutenticacao === metodo);
  if (!associado) {
    throw new ContratoNfseError(`Método sem motor associado: ${metodo}.`);
  }
  return associado.motor;
}

/**
 * Projeta vigentes por direção nos três contadores do SSE atual.
 * Cancelada não incrementa emitidas nem recebidas.
 */
export function projetarContagensSse(inventario: InventarioNfse): ContagensSseCompativeis {
  let qtd_emitidas = 0;
  let qtd_recebidas = 0;
  for (const documento of inventario.documentos) {
    if (documento.situacao !== 'VIGENTE') continue;
    if (documento.direcao === 'EMITIDA') qtd_emitidas += 1;
    else qtd_recebidas += 1;
  }
  return {
    qtd_emitidas,
    qtd_recebidas,
    qtd_canceladas: inventario.totais.canceladas,
  };
}

export function statusPersistivelEmExecucoes(
  status: StatusExecucaoNfse
): StatusExecucoesPersistivel | null {
  if (status === 'BLOQUEADA') return null;
  return STATUS_EXECUCAO_NFSE_PARA_EXECUCOES[status];
}

function contarResultados(recuperacoes: readonly RecuperacaoDocumento[]): Pick<
  ContagensExecucaoNfse,
  'recuperados' | 'reutilizados' | 'pendentes' | 'falhos' | 'bloqueados'
> {
  return {
    recuperados: recuperacoes.filter((item) => item.resultado === 'RECUPERADO').length,
    reutilizados: recuperacoes.filter((item) => item.resultado === 'REUTILIZADO').length,
    pendentes: recuperacoes.filter((item) => item.resultado === 'PENDENTE').length,
    falhos: recuperacoes.filter((item) => item.resultado === 'FALHOU').length,
    bloqueados: recuperacoes.filter((item) => item.resultado === 'BLOQUEADO').length,
  };
}

function derivarStatus(
  inventario: InventarioNfse,
  recuperacoes: readonly RecuperacaoDocumento[],
  auditoria: AuditoriaRecuperacao,
  erros: readonly ErroExecucaoNfse[]
): StatusExecucaoNfse {
  if (inventario.totais.indeterminadas > 0) return 'BLOQUEADA';
  if (auditoria.canceladasExcluidas !== inventario.totais.canceladas) return 'FALHOU';
  if (erros.length > 0 || auditoria.xmlsInvalidos > 0 || auditoria.xmlsDuplicados > 0) {
    return 'FALHOU';
  }
  if (
    auditoria.xmlsAusentes > 0 ||
    recuperacoes.some((item) => item.resultado === 'PENDENTE')
  ) {
    return 'PENDENTE';
  }
  if (auditoria.statusAprovacao !== 'APROVADA') return 'FALHOU';
  return 'CONCLUIDA';
}

function montarPendencias(
  inventario: InventarioNfse,
  recuperacoes: readonly RecuperacaoDocumento[],
  auditoria: AuditoriaRecuperacao
): PendenciaExecucaoNfse[] {
  const pendencias: PendenciaExecucaoNfse[] = [];
  const porChave = new Map<string, RecuperacaoDocumento[]>();
  for (const item of recuperacoes) {
    const lista = porChave.get(item.chaveNacional) ?? [];
    lista.push(item);
    porChave.set(item.chaveNacional, lista);
  }

  for (const documento of inventario.documentos) {
    if (documento.situacao !== 'INDETERMINADA') continue;
    pendencias.push({
      chaveNacional: documento.chaveNacional,
      codigo: 'SITUACAO_INDETERMINADA',
      mensagem: 'Situação indeterminada bloqueia o processamento automático até revisão.',
    });
  }

  for (const item of recuperacoes) {
    if (item.resultado !== 'PENDENTE') continue;
    pendencias.push({
      chaveNacional: item.chaveNacional,
      codigo: 'RECUPERACAO_PENDENTE',
      mensagem: 'XML vigente ainda não recuperado.',
    });
  }

  for (const documento of inventario.documentos) {
    if (documento.situacao !== 'VIGENTE') continue;
    const itens = porChave.get(documento.chaveNacional) ?? [];
    const temValido = itens.some(xmlRecuperadoUtilizavel);
    if (itens.length === 0) {
      pendencias.push({
        chaveNacional: documento.chaveNacional,
        codigo: 'XML_AUSENTE',
        mensagem: 'Documento vigente sem registro de recuperação.',
      });
    } else if (!temValido && itens.some((item) => item.resultado === 'FALHOU')) {
      pendencias.push({
        chaveNacional: documento.chaveNacional,
        codigo: 'XML_INVALIDO',
        mensagem: itemMensagemFalha(documento, itens),
      });
    }
  }

  if (auditoria.xmlsDuplicados > 0) {
    pendencias.push({
      codigo: 'XML_DUPLICADO',
      mensagem: `${auditoria.xmlsDuplicados} XML válido duplicado na recuperação.`,
    });
  }

  return pendencias;
}

function itemMensagemFalha(
  documento: DocumentoFiscalNfse,
  itens: readonly RecuperacaoDocumento[]
): string {
  const motivo = itens.find((item) => item.motivoFalha)?.motivoFalha;
  return motivo ?? `Recuperação sem XML válido para a chave ${documento.chaveNacional}.`;
}

function validarArtefatos(artefatos: ArtefatosExecucaoNfse | undefined): ArtefatosExecucaoNfse {
  if (!artefatos) return {};
  const normalizado: ArtefatosExecucaoNfse = {};
  for (const campo of [
    'diretorioBase',
    'diretorioXmlVigentes',
    'diretorioInventario',
    'diretorioAuditoria',
  ] as const) {
    const valor = artefatos[campo]?.trim();
    if (artefatos[campo] !== undefined && !valor) {
      throw new ContratoNfseError(`Artefato ${campo} vazio.`);
    }
    if (valor) normalizado[campo] = valor;
  }
  return normalizado;
}

export function consolidarResultadoExecucao(input: ConsolidarExecucaoInput): ResultadoExecucaoNfse {
  const execucaoId = input.execucaoId.trim();
  if (!execucaoId) {
    throw new ContratoNfseError('Execução sem identificador.');
  }
  if (motorAssociadoAoMetodo(input.metodoAutenticacao) !== input.motor) {
    throw new ContratoNfseError(
      `Motor ${input.motor} não está associado ao método ${input.metodoAutenticacao}.`
    );
  }

  const chavesInventario = new Set(input.inventario.documentos.map((documento) => documento.chaveNacional));
  for (const recuperacao of input.recuperacoes) {
    if (!chavesInventario.has(recuperacao.chaveNacional)) {
      throw new ContratoNfseError('Recuperação referencia chave ausente do inventário.');
    }
  }

  const recuperacoes = [...input.recuperacoes];
  const auditoria = auditarRecuperacao(input.inventario, recuperacoes);
  const errosInformados = [...(input.erros ?? [])];
  const errosRecuperacao: ErroExecucaoNfse[] = recuperacoes
    .filter((item) => item.resultado === 'FALHOU')
    .map((item) => ({
      codigo: 'RECUPERACAO_FALHOU',
      mensagem: item.motivoFalha ?? `Falha na recuperação da chave ${item.chaveNacional}.`,
    }));
  const erros = [...errosInformados, ...errosRecuperacao];
  const totais = calcularTotaisInventario(input.inventario.documentos);

  return {
    execucaoId,
    cnpj: input.inventario.cnpj,
    periodoConsulta: input.inventario.periodoConsulta,
    metodoAutenticacao: input.metodoAutenticacao,
    motor: input.motor,
    status: derivarStatus(input.inventario, recuperacoes, auditoria, erros),
    contagens: {
      emitidas: totais.emitidas,
      recebidas: totais.recebidas,
      vigentes: totais.vigentes,
      canceladas: totais.canceladas,
      indeterminadas: totais.indeterminadas,
      ...contarResultados(recuperacoes),
    },
    contagensCompativeis: projetarContagensSse(input.inventario),
    artefatos: validarArtefatos(input.artefatos),
    erros,
    pendencias: montarPendencias(input.inventario, recuperacoes, auditoria),
    inventario: input.inventario,
    recuperacoes,
    auditoria,
  };
}
