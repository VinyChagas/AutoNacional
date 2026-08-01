/**
 * Configuração do ambiente de desenvolvimento.
 * Backend Node.js em http://localhost:4321
 */
export const environment = {
  production: false,
  apiUrl: 'http://localhost:4321/api',
  /** Espelha CAPTCHA_DEBUG do backend para painel técnico na Central. */
  captchaDebug: true,
};
