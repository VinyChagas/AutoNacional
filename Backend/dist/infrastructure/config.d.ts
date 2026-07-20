export declare const BACKEND_DIR: string;
export declare const CERTIFICATES_DIR: string;
export declare const FERNET_KEY: string;
export declare const CRYPTO_KEY: string;
export declare const CERT_STORAGE_BUCKET: string;
export declare const DATABASE_URL: string;
export declare const APP_CRED_KEY: string;
export declare const SUPABASE_URL: string;
export declare const SUPABASE_SERVICE_ROLE_KEY: string;
export declare const SUPABASE_JWKS_URL: string;
export declare const SUPABASE_AUDIENCE: string;
export declare const SUPABASE_ISSUER: string;
export declare const INTERNAL_API_KEY: string;
export declare const CORS_ORIGINS: string[];
export declare const PLAYWRIGHT_TIMEOUT: number;
export declare const PLAYWRIGHT_HEADLESS: boolean;
/** Chave da API do 2captcha. */
export declare const TWOCAPTCHA_API_KEY: string;
/** 'v2' (createTask/getTaskResult) ou 'v1' (in.php/res.php). Padrão: v2. */
export declare const TWOCAPTCHA_API_VERSION: string;
/** Tempo máximo (ms) aguardando a solução automática. Padrão: 7 min. */
export declare const CAPTCHA_SOLVE_TIMEOUT_MS: number;
/** isInvisible na task v2. false = widget "Sou humano" (padrão do portal NFSe). */
export declare const CAPTCHA_IS_INVISIBLE: boolean;
/**
 * Override opcional de rqdata (hCaptcha Enterprise).
 * Se vazio, a automação tenta capturar na página; se não houver valor real,
 * o campo é omitido do payload (nunca envia "" ou null).
 * Nunca use c.req como substituto.
 */
export declare const TWOCAPTCHA_RQDATA: string;
/**
 * Modo de resolução:
 *  - auto        : só 2captcha
 *  - manual      : usuário resolve no navegador
 *  - auto_manual : tenta 2captcha; se falhar, aguarda resolução manual
 */
export declare const CAPTCHA_MODE: string;
/** Timeout (ms) da resolução manual no navegador. Padrão: 7 min. */
export declare const CAPTCHA_MANUAL_TIMEOUT_MS: number;
/** Proxy opcional para HCaptchaTask (API v2 com proxy). */
export declare const TWOCAPTCHA_PROXY_TYPE: string;
export declare const TWOCAPTCHA_PROXY_ADDRESS: string;
export declare const TWOCAPTCHA_PROXY_PORT: string;
export declare const TWOCAPTCHA_PROXY_LOGIN: string;
export declare const TWOCAPTCHA_PROXY_PASSWORD: string;
/** Tentativas automáticas por operação (XML/PDF), incluindo a primeira. Padrão: 2. */
export declare const CAPTCHA_OPERATION_MAX_ATTEMPTS: number;
/** Delay (ms) entre fechar o modal antigo e reclicar no download. */
export declare const CAPTCHA_OPERATION_RETRY_DELAY_MS: number;
/** Timeout (ms) para fechar o modal via #btnLimpar. */
export declare const CAPTCHA_MODAL_CLOSE_TIMEOUT_MS: number;
/** Timeout (ms) aguardando um novo desafio hCaptcha após o reclique. */
export declare const CAPTCHA_NEW_CHALLENGE_TIMEOUT_MS: number;
/** Timeout (ms) para relocalizar a nota na tabela. */
export declare const CAPTCHA_NOTE_RELOCATION_TIMEOUT_MS: number;
/** Após esgotar tentativas automáticas, usar fallback manual da operação. */
export declare const CAPTCHA_OPERATION_FALLBACK_MANUAL: boolean;
/**
 * Falhas consecutivas do 2Captcha na mesma execução antes de ir direto ao manual
 * nas próximas operações (não global entre empresas).
 */
export declare const CAPTCHA_CONSECUTIVE_FAILURE_LIMIT: number;
/** Códigos 2Captcha que autorizam regenerar CAPTCHA (retry de operação). */
export declare const CAPTCHA_RETRYABLE_ERROR_CODES: string[];
export declare const QUEUE_TIMEOUT: number;
/** Cap máximo de concorrência em batch. User pode configurar 60+; este limita para evitar sobrecarga. */
export declare const MAX_CONCURRENCY_CAP: number;
export declare const PORT: number;
//# sourceMappingURL=config.d.ts.map