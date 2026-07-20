/**
 * Resolução de hCaptcha via 2captcha (API v1 e v2).
 *
 * API v1 (in.php / res.php):
 *   { key, method: 'hcaptcha', sitekey, pageurl, json: 1 }
 *
 * API v2 (createTask / getTaskResult):
 *   Com proxy:    type = HCaptchaTask
 *   Sem proxy:    type = HCaptchaTaskProxyless
 *
 * Versão controlada por TWOCAPTCHA_API_VERSION (padrão: v2).
 */
export declare class CaptchaError extends Error {
    /** Código tipado da API 2Captcha (ex.: ERROR_CAPTCHA_UNSOLVABLE), quando disponível. */
    readonly code?: string;
    constructor(message: string, code?: string);
}
export declare function captchaConfigurado(): boolean;
/**
 * Resolve hCaptcha e retorna o token.
 * @param sitekey - websiteKey / sitekey do widget
 * @param pageurl - URL da página (websiteURL)
 * @param options - userAgent e rqdata opcional (enterprisePayload).
 *                 rqdata só é enviado quando houver valor real não vazio.
 *                 Nunca use c.req como substituto; nunca envie "" ou null.
 */
export declare function resolverHCaptcha(sitekey: string, pageurl: string, options?: {
    userAgent?: string;
    rqdata?: string;
}): Promise<string>;
//# sourceMappingURL=captcha-solver.d.ts.map