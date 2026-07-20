/**
 * Relatório diagnóstico de interação com a API do 2captcha.
 *
 * Gera arquivos em Backend/logs/2captcha-report/ para enviar ao suporte do
 * fornecedor (chave mascarada). Cobre:
 *  1) solicitação com parâmetros do captcha
 *  2) código/script usado (referência + payload real)
 *  3) site onde o captcha está sendo resolvido
 *  + como a solução é submetida no site de destino
 */
export declare function mascararChave(key: string): string;
/**
 * Inicia uma sessão de relatório ao subir o backend.
 * Cria a pasta e um relatório inicial pronto para o suporte.
 */
export declare function iniciarRelatorio2Captcha(): string;
export declare function getRelatorio2CaptchaPath(): string;
/** Início de uma tentativa (sitekey/pageurl/rqdata capturados do portal). */
export declare function reportCaptchaDetectado(dados: {
    sitekey: string;
    pageurl: string;
    userAgent?: string;
    rqdata?: string;
}): void;
/** Request enviado à API (v1 ou v2), com chave mascarada. */
export declare function reportApiRequest(dados: {
    apiVersion: 'v1' | 'v2';
    endpoint: string;
    body: Record<string, unknown>;
}): void;
/** Resposta recebida da API. */
export declare function reportApiResponse(dados: {
    apiVersion: 'v1' | 'v2';
    endpoint: string;
    response: unknown;
    elapsedMs?: number;
}): void;
/** Token recebido (apenas tamanho / prefixo, nunca o token completo). */
export declare function reportTokenRecebido(dados: {
    apiVersion: 'v1' | 'v2';
    taskId?: string | number;
    tokenLength: number;
    tokenPrefix: string;
}): void;
/** Como a solução foi submetida no site NFSe. */
export declare function reportSolucaoSubmetidaNoSite(dados: {
    pageurl: string;
    camposInjetados: string[];
    botaoConfirmacao: string;
    sucesso: boolean;
    erro?: string;
}): void;
/** Falha na resolução. */
export declare function reportCaptchaFalha(dados: {
    etapa: string;
    erro: string;
}): void;
//# sourceMappingURL=captcha-report.d.ts.map