/**
 * Service de orquestração de execuções de automação NFSe.
 *
 * Gerencia fila de execuções e coordena: playwright_nfse → processar_notas → salvamento.
 */
import type { CertificadoEmMemoria } from '../automation/playwright-nfse';
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
 * Adiciona uma execução à fila.
 * @param batchId - UUID do lote (para rastreio quando iniciado via POST /multiplas)
 * @param tipoAutenticacao - 'certificado' ou 'credenciais' (define método de login)
 */
export declare function adicionarExecucao(empresaId: number, cnpj: string, dataInicio: string, dataFim: string, tipo: string, headless?: boolean, certificado?: CertificadoEmMemoria, batchId?: string, tipoAutenticacao?: TipoAutenticacao): Promise<number>;
/**
 * Obtém o status de uma execução em andamento.
 */
export declare function obterStatus(empresaId: string): Record<string, unknown> | null;
export {};
//# sourceMappingURL=execution-service.d.ts.map