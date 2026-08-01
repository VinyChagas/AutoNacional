import type { ResultadoAutenticacao } from './playwright-nfse';
export interface OpcoesLoginCredencial {
    headless?: boolean;
    timeout?: number;
    /** Viewport da página (tamanho do conteúdo — NÃO a resolução do monitor). */
    viewport?: {
        width: number;
        height: number;
    };
    /** Args extras do Chromium (ex.: --window-size / --window-position do slot). */
    launchArgs?: string[];
    onLoginPageReady?: () => void;
}
/**
 * Abre o dashboard do portal NFSe Nacional autenticado com credencial (CNPJ/CPF + senha).
 * Retorna page e browser abertos para o fluxo continuar (processar notas).
 * Não fecha o browser - o chamador é responsável por fechar após o uso.
 */
export declare function abrirDashboardNfseComCredencial(documento: string, senha: string, opcoes?: OpcoesLoginCredencial): Promise<ResultadoAutenticacao>;
//# sourceMappingURL=login-credencial-nfse.d.ts.map