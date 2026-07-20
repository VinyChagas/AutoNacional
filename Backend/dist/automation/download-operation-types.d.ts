/**
 * Tipos e classificação de erros para retry de download por operação (XML/PDF).
 */
export type TipoNotaUi = 'Emitidas' | 'Recebidas';
export type TipoArquivoNota = 'xml' | 'pdf';
export type DownloadOperationStatus = 'pendente' | 'localizando_nota' | 'abrindo_download' | 'captcha_detectado' | 'captcha_resolvendo' | 'captcha_token_recebido' | 'captcha_enviando' | 'aguardando_download' | 'validando_arquivo' | 'concluido' | 'retry_pendente' | 'retry_reabrindo_modal' | 'fallback_manual' | 'falhou' | 'skipped';
export type RetryAction = 'RETRY_NEW_CAPTCHA' | 'RETRY_SAME_OPERATION' | 'FALLBACK_MANUAL' | 'FAIL_CONFIGURATION' | 'FAIL_PERMANENT';
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
export declare class CaptchaModalCloseError extends Error {
    constructor(message: string);
}
export declare class NotaNaoEncontradaParaRetryError extends Error {
    constructor(message: string);
}
export declare function maskNfseKey(chave: string): string;
export declare function extractErrorCode(error: unknown): string;
/**
 * Classifica o erro da operação de download para decidir retry / fallback / falha.
 */
export declare function classificarErroDaOperacao(error: unknown): OperationErrorClassification;
//# sourceMappingURL=download-operation-types.d.ts.map