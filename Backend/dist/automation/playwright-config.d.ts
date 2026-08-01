/**
 * Configuração do Playwright para automação NFSe.
 *
 * Centraliza timeout, headless e outras configurações usadas
 * pelos scripts de automação.
 */
import { BrowserContext } from 'playwright';
export interface PlaywrightConfig {
    /** Timeout em milissegundos para operações (default: 60000) */
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
/**
 * Aplica zoom de página em todas as navegações do contexto (padrão 80%).
 * Usa CSS zoom no documentElement — estável no Chromium e reaplicado a cada load.
 */
export declare function aplicarZoomPaginaNoContexto(context: BrowserContext, zoom?: number): Promise<void>;
//# sourceMappingURL=playwright-config.d.ts.map