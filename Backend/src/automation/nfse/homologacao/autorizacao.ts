/**
 * Validação de autorização de homologação H1.
 * Não inferida por flag, A1, PDF, login ou existência de diretório.
 */
import { normalizarCnpjEmpresa } from '../contracts/documento-fiscal';
import { ContratoNfseError } from '../contracts/erros';
import {
  criarPeriodoConsultaPortal,
  periodosConsultaIguais,
  type PeriodoConsultaPortal,
} from '../contracts/periodo';
import { raizFiscalDistintaDeDownloads } from '../infrastructure/storage-resolver';
import {
  HomologacaoNfseError,
  OPERACOES_HOMOLOGACAO,
  type AutorizacaoHomologacaoNfse,
  type ContextoValidacaoHomologacao,
  type LimitesHomologacaoNfse,
  type OperacaoHomologacao,
} from './types';

export function criarLimitesHomologacao(
  parcial: Partial<LimitesHomologacaoNfse> & {
    maxDocumentos: number;
    maxRequisicoesSefin: number;
  }
): LimitesHomologacaoNfse {
  const maxDocumentos = exigirInteiroNaoNegativo(parcial.maxDocumentos, 'maxDocumentos');
  const maxRequisicoesSefin = exigirInteiroNaoNegativo(
    parcial.maxRequisicoesSefin,
    'maxRequisicoesSefin'
  );
  const timeoutMs = exigirInteiroPositivo(parcial.timeoutMs ?? 60_000, 'timeoutMs');
  return { maxDocumentos, maxRequisicoesSefin, timeoutMs };
}

/**
 * Monta autorização tipada. Recusa genéricos e campos sensíveis.
 */
export function criarAutorizacaoHomologacao(entrada: {
  cnpj: string;
  periodoConsulta: PeriodoConsultaPortal | { inicio: string; fim: string };
  execucaoId: string;
  operacao: OperacaoHomologacao;
  validoAte: string;
  diretorioFiscal: string;
  limites: LimitesHomologacaoNfse;
  motivo?: string;
  emitidoEm?: string;
  agora?: Date;
}): AutorizacaoHomologacaoNfse {
  const cnpj = normalizarCnpjSeguro(entrada.cnpj);
  const periodo = normalizarPeriodo(entrada.periodoConsulta);
  const execucaoId = exigirTexto(entrada.execucaoId, 'execucaoId');
  const operacao = exigirOperacao(entrada.operacao);
  const diretorioFiscal = exigirDiretorioFiscal(entrada.diretorioFiscal);
  const limites = criarLimitesHomologacao(entrada.limites);
  const validoAte = exigirIsoFuturo(entrada.validoAte, entrada.agora ?? new Date());

  if (operacao === 'DISCOVERY_ONLY' && limites.maxRequisicoesSefin > 0) {
    throw new HomologacaoNfseError(
      'AUTORIZACAO_MALFORMADA',
      'DISCOVERY_ONLY exige maxRequisicoesSefin = 0.'
    );
  }
  if (operacao === 'SEFIN_RECOVERY' && limites.maxRequisicoesSefin < 1) {
    throw new HomologacaoNfseError(
      'AUTORIZACAO_MALFORMADA',
      'SEFIN_RECOVERY exige maxRequisicoesSefin >= 1.'
    );
  }

  return {
    versao: 1,
    autorizada: true,
    cnpj,
    periodoConsulta: periodo,
    execucaoId,
    operacao,
    validoAte,
    diretorioFiscal,
    limites,
    motivo: entrada.motivo?.trim() || undefined,
    emitidoEm: entrada.emitidoEm ?? (entrada.agora ?? new Date()).toISOString(),
  };
}

/**
 * Valida autorização contra o contexto da execução.
 * Lança HomologacaoNfseError se inválida.
 */
export function validarAutorizacaoHomologacao(
  autorizacao: AutorizacaoHomologacaoNfse | null | undefined,
  contexto: ContextoValidacaoHomologacao
): AutorizacaoHomologacaoNfse {
  if (autorizacao == null) {
    throw new HomologacaoNfseError('AUTORIZACAO_AUSENTE', 'Autorização de homologação ausente.');
  }
  if (!ehAutorizacaoHomologacaoEstruturada(autorizacao)) {
    throw new HomologacaoNfseError(
      'AUTORIZACAO_MALFORMADA',
      'Autorização de homologação malformada ou insuficiente.'
    );
  }

  const agora = contexto.agora ?? new Date();
  if (Date.parse(autorizacao.validoAte) <= agora.getTime()) {
    throw new HomologacaoNfseError('AUTORIZACAO_EXPIRADA', 'Autorização de homologação expirada.');
  }

  const cnpjContexto = normalizarCnpjSeguro(contexto.cnpj);
  if (autorizacao.cnpj !== cnpjContexto) {
    throw new HomologacaoNfseError(
      'CNPJ_DIVERGENTE',
      'Autorização vinculada a outro CNPJ.'
    );
  }

  const periodoContexto = normalizarPeriodo(contexto.periodoConsulta);
  if (!periodosConsultaIguais(autorizacao.periodoConsulta, periodoContexto)) {
    throw new HomologacaoNfseError(
      'PERIODO_DIVERGENTE',
      'Autorização vinculada a outro período consultado.'
    );
  }

  if (autorizacao.execucaoId !== exigirTexto(contexto.execucaoId, 'execucaoId')) {
    throw new HomologacaoNfseError(
      'EXECUCAO_DIVERGENTE',
      'Autorização vinculada a outra execução.'
    );
  }

  if (autorizacao.operacao !== contexto.operacaoSolicitada) {
    throw new HomologacaoNfseError(
      'OPERACAO_NAO_AUTORIZADA',
      `Operação ${contexto.operacaoSolicitada} não autorizada (contrato: ${autorizacao.operacao}).`
    );
  }

  const diretorioContexto = exigirDiretorioFiscal(contexto.diretorioFiscal);
  if (normalizarCaminhoComparavel(autorizacao.diretorioFiscal) !== normalizarCaminhoComparavel(diretorioContexto)) {
    throw new HomologacaoNfseError(
      'DIRETORIO_DIVERGENTE',
      'Autorização vinculada a outro diretório fiscal.'
    );
  }

  return autorizacao;
}

/**
 * `autorizada: true` do Commit 07, isolado, não passa como homologação H1.
 */
export function ehAutorizacaoHomologacaoEstruturada(
  valor: unknown
): valor is AutorizacaoHomologacaoNfse {
  if (!valor || typeof valor !== 'object') return false;
  const obj = valor as Record<string, unknown>;
  if (obj.versao !== 1) return false;
  if (obj.autorizada !== true) return false;
  if (typeof obj.cnpj !== 'string') return false;
  if (typeof obj.execucaoId !== 'string' || !obj.execucaoId.trim()) return false;
  if (typeof obj.validoAte !== 'string' || Number.isNaN(Date.parse(obj.validoAte))) return false;
  if (typeof obj.diretorioFiscal !== 'string' || !obj.diretorioFiscal.trim()) return false;
  if (!(OPERACOES_HOMOLOGACAO as readonly string[]).includes(String(obj.operacao))) return false;
  if (!obj.periodoConsulta || typeof obj.periodoConsulta !== 'object') return false;
  if (!obj.limites || typeof obj.limites !== 'object') return false;
  const limites = obj.limites as Record<string, unknown>;
  if (typeof limites.maxDocumentos !== 'number' || typeof limites.maxRequisicoesSefin !== 'number') {
    return false;
  }
  // Recusa payloads com campos sensíveis acidentais.
  for (const proibido of ['senha', 'passphrase', 'pfx', 'password', 'certificado', 'xml']) {
    if (proibido in obj) return false;
  }
  return true;
}

function normalizarCnpjSeguro(cnpj: string): string {
  try {
    return normalizarCnpjEmpresa(cnpj);
  } catch (erro) {
    if (erro instanceof ContratoNfseError) {
      throw new HomologacaoNfseError('AUTORIZACAO_MALFORMADA', 'CNPJ inválido na autorização.');
    }
    throw erro;
  }
}

function normalizarPeriodo(
  periodo: PeriodoConsultaPortal | { inicio: string; fim: string }
): PeriodoConsultaPortal {
  try {
    return criarPeriodoConsultaPortal(periodo.inicio, periodo.fim);
  } catch {
    throw new HomologacaoNfseError('AUTORIZACAO_MALFORMADA', 'Período inválido na autorização.');
  }
}

function exigirOperacao(valor: string): OperacaoHomologacao {
  if ((OPERACOES_HOMOLOGACAO as readonly string[]).includes(valor)) {
    return valor as OperacaoHomologacao;
  }
  throw new HomologacaoNfseError('AUTORIZACAO_MALFORMADA', 'Operação de homologação inválida.');
}

function exigirTexto(valor: string, campo: string): string {
  const texto = typeof valor === 'string' ? valor.trim() : '';
  if (!texto) {
    throw new HomologacaoNfseError('AUTORIZACAO_MALFORMADA', `${campo} ausente na autorização.`);
  }
  return texto;
}

function exigirDiretorioFiscal(valor: string): string {
  const texto = exigirTexto(valor, 'diretorioFiscal');
  if (!raizFiscalDistintaDeDownloads(texto, './downloads')) {
    throw new HomologacaoNfseError(
      'AUTORIZACAO_MALFORMADA',
      'Diretório fiscal não pode coincidir com downloads operacionais.'
    );
  }
  return texto;
}

function exigirIsoFuturo(valor: string, agora: Date): string {
  const ms = Date.parse(valor);
  if (Number.isNaN(ms)) {
    throw new HomologacaoNfseError('AUTORIZACAO_MALFORMADA', 'validoAte inválido.');
  }
  if (ms <= agora.getTime()) {
    throw new HomologacaoNfseError('AUTORIZACAO_EXPIRADA', 'Autorização já expirada na emissão.');
  }
  return new Date(ms).toISOString();
}

function exigirInteiroNaoNegativo(valor: number, campo: string): number {
  if (!Number.isInteger(valor) || valor < 0) {
    throw new HomologacaoNfseError('AUTORIZACAO_MALFORMADA', `${campo} inválido.`);
  }
  return valor;
}

function exigirInteiroPositivo(valor: number, campo: string): number {
  if (!Number.isInteger(valor) || valor < 1) {
    throw new HomologacaoNfseError('AUTORIZACAO_MALFORMADA', `${campo} inválido.`);
  }
  return valor;
}

function normalizarCaminhoComparavel(caminho: string): string {
  return caminho.trim().replace(/\\/g, '/').replace(/\/+$/, '');
}
