/**
 * Service de orquestração de execuções de automação NFSe.
 *
 * Gerencia fila de execuções e coordena: playwright_nfse → processar_notas → salvamento.
 * Padrão producer/worker: endpoint apenas enfileira; browser launch ocorre APENAS no worker.
 */
import type { CertificadoEmMemoria } from '../automation/playwright-nfse';
import type { CaptchaMode } from '../automation/captcha/types';
type TipoAutenticacao = 'certificado' | 'credenciais';
type CertificateLoader = (cnpj: string) => Promise<CertificadoEmMemoria>;
/**
 * Define a função para carregar certificado (será usada quando CertificateService estiver pronto - Fase 5).
 */
export declare function setCertificateLoader(loader: CertificateLoader): void;
/**
 * Obtém certificado por CNPJ (usa o loader configurado).
 * Usado pelo router NFSe e pelo fluxo de execução.
 */
export declare function obterCertificadoPorCnpj(cnpj: string): Promise<CertificadoEmMemoria>;
/**
 * Obtém delay entre enfileiramentos (configurável, padrão 150ms).
 */
export declare function obterDelayEnfileiramento(): Promise<number>;
/**
 * Calcula e aplica concurrency_final =
 * min(padrão, máximo das settings, slots visuais, totalEmpresas).
 *
 * Assim, com 10 na fila e 8 slots/navegadores, só 8 rodam; as demais
 * esperam na PQueue até um navegador finalizar e liberar o slot.
 */
export declare function configurarConcorrenciaParaBatch(totalEmpresas: number): Promise<number>;
/**
 * Adiciona uma execução à fila.
 * @param batchId - UUID do lote (para rastreio quando iniciado via POST /multiplas)
 * @param tipoAutenticacao - 'certificado' ou 'credenciais' (define método de login)
 */
export declare function adicionarExecucao(empresaId: number, cnpj: string, dataInicio: string, dataFim: string, tipo: string, headless?: boolean, certificado?: CertificadoEmMemoria, batchId?: string, tipoAutenticacao?: TipoAutenticacao, baixarPdf?: boolean, captchaMode?: CaptchaMode): Promise<number>;
/**
 * Obtém status de todas as execuções de um batch (para polling em lote, evita N requests).
 * @param batchId - UUID do batch
 * @param empresaIdsFallback - Se fornecido, para cada empresa_id não encontrado em memória, busca última execução no DB
 */
export declare function obterStatusBatch(batchId: string, empresaIdsFallback?: number[]): Promise<Record<string, unknown>[]>;
/**
 * Obtém o status de uma execução em andamento.
 */
export declare function obterStatus(empresaId: string): Record<string, unknown> | null;
export {};
//# sourceMappingURL=execution-service.d.ts.map