/**
 * Automação do portal NFSe Nacional usando Playwright com certificado A1.
 *
 * Implementa autenticação via certificado digital A1 (.pfx) diretamente
 * no navegador Chromium controlado pelo Playwright, sem exibir popups de seleção.
 */
import { Browser, BrowserContext, Page } from 'playwright';
export declare class NFSeAutenticacaoError extends Error {
    constructor(message: string);
}
export interface CertificadoEmMemoria {
    /** Conteúdo do arquivo PFX em Buffer */
    pfx: Buffer;
    /** Senha do certificado */
    passphrase: string;
}
export interface ResultadoAutenticacao {
    sucesso: boolean;
    url_atual: string;
    titulo: string;
    mensagem: string;
    logs: string[];
    page?: Page;
    context?: BrowserContext;
    browser?: Browser;
}
export interface OpcoesContexto {
    headless?: boolean;
    ignoreHttpsErrors?: boolean;
    /** Viewport da página (tamanho do conteúdo — NÃO a resolução do monitor). */
    viewport?: {
        width: number;
        height: number;
    };
    /** Args extras do Chromium (ex.: --window-size / --window-position do slot). */
    launchArgs?: string[];
    /** Chamado quando a tela de login está pronta (após page.goto, antes do clique) */
    onLoginPageReady?: () => void;
}
/**
 * Cria um contexto do navegador Chromium configurado para usar certificado A1.
 *
 * Aceita certificado via parâmetro (para testes) ou via loader (CertificateService).
 */
export declare function criarContextoComCertificado(certificado: CertificadoEmMemoria, opcoes?: OpcoesContexto): Promise<{
    browser: Browser;
    context: BrowserContext;
}>;
/**
 * Abre o dashboard do portal NFSe Nacional autenticado com certificado A1.
 *
 * @param certificado - Certificado PFX e senha (pode vir do CertificateService)
 * @param opcoes - headless, timeout, viewport
 */
export declare function abrirDashboardNfse(certificado: CertificadoEmMemoria, opcoes?: {
    headless?: boolean;
    timeout?: number;
    viewport?: {
        width: number;
        height: number;
    };
    launchArgs?: string[];
    onLoginPageReady?: () => void;
}): Promise<ResultadoAutenticacao>;
//# sourceMappingURL=playwright-nfse.d.ts.map