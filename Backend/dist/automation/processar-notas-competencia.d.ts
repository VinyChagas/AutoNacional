/**
 * Automação para processar notas fiscais de uma competência no portal NFSe Nacional.
 *
 * Varredura de notas emitidas e recebidas, com download de XML e DANFS-e (PDF).
 */
import { Page } from 'playwright';
import { setDownloadsBasePath } from './download-manager';
export { setDownloadsBasePath };
export declare function setMinActionDelayMs(ms: number): void;
export declare function getMinActionDelayMs(): number;
/**
 * Normaliza a competência para comparação.
 * Aceita: "MM/AAAA", "MM-AAAA", "MMAAAA"
 */
export declare function normalizarCompetencia(valor: string): string;
/**
 * Verifica se a página exibe "Nenhum registro encontrado".
 */
export declare function verificarSemRegistros(page: Page): Promise<boolean>;
/**
 * Processa a tabela de notas emitidas.
 */
export declare function processarTabelaEmitidas(page: Page, competenciaAlvo: string, nomeEmpresa: string): Promise<{
    qtd_baixadas: number;
    sem_registros: boolean;
    encontrou_notas: boolean;
}>;
/**
 * Processa a tabela de notas recebidas.
 */
export declare function processarTabelaRecebidas(page: Page, competenciaAlvo: string, nomeEmpresa: string): Promise<{
    qtd_baixadas: number;
    sem_registros: boolean;
    encontrou_notas: boolean;
}>;
/**
 * Preenche datas e clica em filtrar.
 */
export declare function preencherDatasEFiltrar(page: Page, dataInicio: string, dataFim: string): Promise<void>;
//# sourceMappingURL=processar-notas-competencia.d.ts.map