/**
 * Configuração do Playwright para automação NFSe.
 *
 * Centraliza timeout, headless e outras configurações usadas
 * pelos scripts de automação.
 */
export interface PlaywrightConfig {
    /** Timeout em milissegundos para operações (default: 30000) */
    timeout: number;
    /** Se true, executa navegador em modo headless */
    headless: boolean;
    /** Ignorar erros de certificado SSL */
    ignoreHttpsErrors: boolean;
    /** Configuração do viewport (width, height) */
    viewport: {
        width: number;
        height: number;
    };
    /** Argumentos extras para o Chromium */
    args: string[];
}
export declare const defaultPlaywrightConfig: PlaywrightConfig;
/**
 * Retorna a configuração do Playwright para uso nos scripts.
 */
export declare function getPlaywrightConfig(overrides?: Partial<PlaywrightConfig>): PlaywrightConfig;
//# sourceMappingURL=playwright-config.d.ts.map