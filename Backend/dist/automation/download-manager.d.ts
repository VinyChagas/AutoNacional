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
 * Formata a competência para uso como nome de pasta.
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
 * Estrutura: {base_path}/{competencia}/{empresa}/{tipo_nota}/
 */
export declare function montarCaminhoCompleto(basePath: string, competencia: string, empresa: string, tipoNota: string): string;
/**
 * Salva um download já interceptado no diretório correto.
 */
export declare function salvarDownloadDireto(download: Download, basePath: string, competencia: string, empresa: string, tipoNota: string, nomeArquivoPrefixo?: string): Promise<string>;
/**
 * Baixa um arquivo diretamente via requisição HTTP usando a sessão autenticada.
 * Estratégia RECOMENDADA para downloads.
 */
export declare function baixarArquivoDireto(page: Page, seletorLink: string, basePath: string, competencia: string, empresa: string, tipoNota: string): Promise<string>;
//# sourceMappingURL=download-manager.d.ts.map