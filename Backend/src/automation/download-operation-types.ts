/**
 * Tipos e classificação de erros para retry de download por operação (XML/PDF).
 */

import { CAPTCHA_RETRYABLE_ERROR_CODES } from '../infrastructure/config';
import { CaptchaError } from './captcha-solver';

export type TipoNotaUi = 'Emitidas' | 'Recebidas';
export type TipoArquivoNota = 'xml' | 'pdf';

export type DownloadOperationStatus =
  | 'pendente'
  | 'localizando_nota'
  | 'abrindo_download'
  | 'captcha_detectado'
  | 'captcha_resolvendo'
  | 'captcha_token_recebido'
  | 'captcha_enviando'
  | 'aguardando_download'
  | 'validando_arquivo'
  | 'concluido'
  | 'retry_pendente'
  | 'retry_reabrindo_modal'
  | 'fallback_manual'
  | 'falhou'
  | 'skipped';

export type RetryAction =
  | 'RETRY_NEW_CAPTCHA'
  | 'RETRY_SAME_OPERATION'
  | 'FALLBACK_MANUAL'
  | 'FAIL_CONFIGURATION'
  | 'FAIL_PERMANENT';

export interface OperationErrorClassification {
  retryable: boolean;
  action: RetryAction;
  code: string;
  reason: string;
}

export interface DownloadOperationContext {
  operationId: string;
  executionId: string;
  empresaId: string;
  batchId?: string;

  tipoNota: TipoNotaUi;
  tipoArquivo: TipoArquivoNota;

  /** Identificador principal (chave 44 dígitos ou composto estável). */
  chaveNfse: string;
  numeroNota?: string;

  paginaOriginal?: number;
  indiceLinhaOriginal?: number;

  attempt: number;
  maxAttempts: number;

  status: DownloadOperationStatus;

  startedAt: string;
  updatedAt: string;
  completedAt?: string;

  lastErrorCode?: string;
  lastErrorMessage?: string;

  outputPath?: string;
  fileValidated?: boolean;

  basePath: string;
  nomeContabilidade: string;
  mesExecucaoExtenso: string;
  nomeEmpresa: string;
  /** Prefixo usado no nome do arquivo (ex.: numeroNota_). */
  nomeArquivoPrefixo?: string;
}

export interface DownloadOperationResult {
  success: boolean;
  skipped?: boolean;
  path?: string;
  fallbackManual?: boolean;
  error?: string;
}

export interface ExecutionDownloadState {
  consecutiveCaptchaFailures: number;
  lastCompleted?: {
    chaveNfse: string;
    tipoNota: TipoNotaUi;
    tipoArquivo: TipoArquivoNota;
  };
  currentOperationId?: string;
}

export class CaptchaModalCloseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CaptchaModalCloseError';
  }
}

export class NotaNaoEncontradaParaRetryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotaNaoEncontradaParaRetryError';
  }
}

const CONFIG_ERROR_CODES = new Set([
  'ERROR_KEY_DOES_NOT_EXIST',
  'ERROR_ZERO_BALANCE',
  'ERROR_IP_NOT_ALLOWED',
  'ERROR_ACCOUNT_SUSPENDED',
  'ERROR_BAD_PARAMETERS',
  'ERROR_WRONG_USER_KEY',
  'ERROR_KEY_DOES_NOT_EXIST',
]);

const NETWORK_RETRY_PATTERNS = [
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /ECONNREFUSED/i,
  /fetch failed/i,
  /network/i,
  /\b429\b/,
  /\b502\b/,
  /\b503\b/,
  /\b504\b/,
];

export function maskNfseKey(chave: string): string {
  if (!chave || chave.length < 10) return '***';
  return `${chave.slice(0, 6)}...${chave.slice(-4)}`;
}

export function extractErrorCode(error: unknown): string {
  if (error instanceof CaptchaError && error.code) {
    return error.code;
  }
  const msg = error instanceof Error ? error.message : String(error);
  const m = /ERROR_[A-Z0-9_]+/.exec(msg);
  if (m) return m[0];
  if (/TWOCAPTCHA_API_KEY|não configurada|sitekey/i.test(msg)) {
    return 'ERROR_CONFIGURATION';
  }
  if (error instanceof CaptchaModalCloseError) return 'ERROR_MODAL_CLOSE';
  if (error instanceof NotaNaoEncontradaParaRetryError) return 'ERROR_NOTE_NOT_FOUND';
  if (/TimeoutError|timeout/i.test(msg)) return 'ERROR_TIMEOUT';
  return 'ERROR_UNKNOWN';
}

/**
 * Classifica o erro da operação de download para decidir retry / fallback / falha.
 */
export function classificarErroDaOperacao(
  error: unknown
): OperationErrorClassification {
  const code = extractErrorCode(error);
  const reason = error instanceof Error ? error.message : String(error);

  if (CONFIG_ERROR_CODES.has(code) || code === 'ERROR_CONFIGURATION') {
    return {
      retryable: false,
      action: 'FAIL_CONFIGURATION',
      code,
      reason,
    };
  }

  if (code === 'ERROR_NOTE_NOT_FOUND') {
    return {
      retryable: false,
      action: 'FAIL_PERMANENT',
      code,
      reason,
    };
  }

  const retryableCodes = new Set(CAPTCHA_RETRYABLE_ERROR_CODES);
  if (retryableCodes.has(code) || code === 'ERROR_CAPTCHA_UNSOLVABLE') {
    return {
      retryable: true,
      action: 'RETRY_NEW_CAPTCHA',
      code,
      reason,
    };
  }

  if (
    code === 'ERROR_TIMEOUT' ||
    code === 'ERROR_MODAL_CLOSE' ||
    NETWORK_RETRY_PATTERNS.some((p) => p.test(reason))
  ) {
    return {
      retryable: true,
      action: 'RETRY_NEW_CAPTCHA',
      code,
      reason,
    };
  }

  if (/arquivo inválido|invalid file|HTML de erro|%PDF/i.test(reason)) {
    return {
      retryable: true,
      action: 'RETRY_SAME_OPERATION',
      code: 'ERROR_INVALID_FILE',
      reason,
    };
  }

  return {
    retryable: false,
    action: 'FALLBACK_MANUAL',
    code,
    reason,
  };
}
