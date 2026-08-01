/**
 * Retry de download no nível da operação de negócio (XML/PDF por nota).
 *
 * Em ERROR_CAPTCHA_UNSOLVABLE (e similares): fecha o modal (#btnLimpar),
 * relocaliza a nota, reclica o mesmo botão e cria uma NOVA tarefa 2Captcha.
 * Não reutiliza taskId, token, modal ou desafio anterior.
 */
import { Page, Locator } from 'playwright';
import { DownloadOperationContext, DownloadOperationResult, TipoArquivoNota, TipoNotaUi } from './download-operation-types';
export type StageCallback = (stage: string, message: string) => void;
export interface DownloadOperationDeps {
    onStage?: StageCallback;
    /** Resolve o desafio ATUAL via 2Captcha (uma task). */
    resolverCaptchaAutomatico: (page: Page) => Promise<void>;
    /**
     * Resolução MANUAL no navegador: Tab/Enter → usuário resolve →
     * detecta token → #btnSubmitHCaptcha. Usado no fallback e no lote MANUAL.
     */
    aguardarResolucaoManual: (page: Page) => Promise<void>;
    /** Opt-in: Central Manual remota (Socket.IO) quando CAPTCHA_MANUAL_USE_CENTRAL=true. */
    resolverCaptchaCentral?: (page: Page) => Promise<void>;
}
export declare function shouldSkipAutoForExecution(executionId: string): boolean;
export declare function markAutoSuccess(executionId: string): void;
export declare function markAutoFinalFailure(executionId: string): void;
export declare function clearExecutionDownloadState(executionId: string): void;
/** Exposto para testes. */
export declare function _resetExecutionStatesForTests(): void;
export declare function criarContextoOperacao(params: {
    executionId: string;
    empresaId: string;
    batchId?: string;
    captchaMode?: import('./captcha/types').CaptchaMode;
    tipoNota: TipoNotaUi;
    tipoArquivo: TipoArquivoNota;
    chaveNfse: string;
    numeroNota?: string;
    paginaOriginal?: number;
    indiceLinhaOriginal?: number;
    basePath: string;
    nomeContabilidade: string;
    mesExecucaoExtenso: string;
    nomeEmpresa: string;
    nomeArquivoPrefixo?: string;
}): DownloadOperationContext;
/**
 * Extrai identificador estável da linha: chave 44 dígitos ou composto.
 */
export declare function extrairIdentificadorDaLinha(rowLocator: Locator): Promise<{
    chaveNfse: string;
    numeroNota?: string;
}>;
export declare function fecharModalCaptchaAtual(page: Page, ctx: DownloadOperationContext, deps?: DownloadOperationDeps): Promise<void>;
export declare function aguardarFechamentoCompletoDoModal(page: Page, ctx: DownloadOperationContext): Promise<void>;
export declare function localizarNotaPorIdentificador(page: Page, ctx: DownloadOperationContext): Promise<Locator>;
/**
 * Executa o download de um único arquivo (XML ou PDF) com retry de operação.
 */
export declare function executarDownloadNotaComRetry(page: Page, rowInicial: Locator, ctx: DownloadOperationContext, deps: DownloadOperationDeps): Promise<DownloadOperationResult>;
//# sourceMappingURL=download-operation.d.ts.map