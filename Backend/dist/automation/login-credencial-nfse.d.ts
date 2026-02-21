import type { ResultadoAutenticacao } from './playwright-nfse';
export interface OpcoesLoginCredencial {
    headless?: boolean;
    timeout?: number;
    viewport?: {
        width: number;
        height: number;
    };
}
/**
 * Abre o dashboard do portal NFSe Nacional autenticado com credencial (CNPJ/CPF + senha).
 * Retorna page e browser abertos para o fluxo continuar (processar notas).
 * Não fecha o browser - o chamador é responsável por fechar após o uso.
 */
export declare function abrirDashboardNfseComCredencial(documento: string, senha: string, opcoes?: OpcoesLoginCredencial): Promise<ResultadoAutenticacao>;
//# sourceMappingURL=login-credencial-nfse.d.ts.map