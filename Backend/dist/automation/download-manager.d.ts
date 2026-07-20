/**
 * Gerenciador de downloads para automação NFSe.
 *
 * Fornece funções utilitárias para interceptar, identificar,
 * nomear e salvar downloads de forma robusta e reutilizável.
 */
import { Page, Download } from 'playwright';
/**
 * Define o caminho base para downloads.
 */
export declare function setDownloadsBasePath(basePath: string): void;
/**
 * Obtém o caminho base para downloads.
 * Se não configurado, usa pasta de testes dentro do backend.
 */
export declare function getDownloadBasePath(): string;
/**
 * Formata o mês da execução para uso como nome de pasta.
 * Usa o mês que está sendo executado (não a competência da nota).
 * Ex: (2026, 1) → "janeiro-2026"
 */
export declare function formatarMesExecucaoParaPasta(ano: number, mes: number): string;
/**
 * Formata a competência para uso como nome de pasta.
 * @deprecated Use formatarMesExecucaoParaPasta para nova estrutura (contabilidade/mês-ano/empresa).
 * Ex: "10/2025" → "10-2025"
 */
export declare function formatarCompetenciaParaPasta(competencia: string): string;
/**
 * Sanitiza o nome do arquivo removendo caracteres inválidos.
 */
export declare function sanitizarNomeArquivo(nome: string): string;
/**
 * Sanitiza o nome para uso como nome de pasta.
 */
export declare function sanitizarNomePasta(nome: string): string;
/**
 * Detecta a extensão correta do arquivo baixado.
 */
export declare function detectarExtensaoArquivo(download: Download): Promise<string>;
/**
 * Gera o nome final do arquivo.
 */
export declare function gerarNomeArquivo(download: Download, extensao: string, prefixo?: string): Promise<string>;
/**
 * Monta o caminho completo seguindo a hierarquia definida.
 * Estrutura: {base_path}/{contabilidade}/{mes_extenso}-{ano}/{empresa}/{tipo_nota}/
 * - contabilidade: nome da contabilidade em execução
 * - mes_extenso: mês da execução por extenso (ex: janeiro-2026), NÃO a competência da nota
 */
export declare function montarCaminhoCompleto(basePath: string, nomeContabilidade: string, mesExecucaoExtenso: string, empresa: string, tipoNota: string): string;
/**
 * Salva um download já interceptado no diretório correto.
 * Estrutura: {base}/{contabilidade}/{mes_extenso}-{ano}/{empresa}/{tipo}/
 */
export declare function salvarDownloadDireto(download: Download, basePath: string, nomeContabilidade: string, mesExecucaoExtenso: string, empresa: string, tipoNota: string, nomeArquivoPrefixo?: string): Promise<string>;
export interface FileValidationResult {
    valid: boolean;
    path?: string;
    reason?: string;
    size?: number;
}
/**
 * Valida arquivo baixado (existência, tamanho e assinatura mínima XML/PDF).
 */
export declare function validarArquivoBaixado(filePath: string, tipoArquivo: 'xml' | 'pdf'): Promise<FileValidationResult>;
/** Remove arquivo inválido (best-effort) antes de retry. */
export declare function removerArquivoInvalido(filePath: string): Promise<void>;
/**
 * Procura arquivo válido já existente na pasta destino (idempotência).
 * Usa prefixo do número da nota e extensão esperada.
 */
export declare function localizarArquivoExistenteValido(basePath: string, nomeContabilidade: string, mesExecucaoExtenso: string, empresa: string, tipoNota: string, tipoArquivo: 'xml' | 'pdf', nomeArquivoPrefixo?: string): Promise<FileValidationResult>;
/**
 * Baixa um arquivo diretamente via requisição HTTP usando a sessão autenticada.
 * Estratégia RECOMENDADA para downloads.
 */
export declare function baixarArquivoDireto(page: Page, seletorLink: string, basePath: string, nomeContabilidade: string, mesExecucaoExtenso: string, empresa: string, tipoNota: string): Promise<string>;
//# sourceMappingURL=download-manager.d.ts.map