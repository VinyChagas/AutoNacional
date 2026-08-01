/**
 * Tipagens mínimas do widget hCaptcha (render explícito).
 */
export interface HCaptchaRenderConfig {
  sitekey: string;
  callback?: (token: string) => void;
  'expired-callback'?: () => void;
  'error-callback'?: (error?: string) => void;
  size?: 'normal' | 'compact' | 'invisible';
  theme?: 'light' | 'dark';
  rqdata?: string;
}

export interface HCaptchaApi {
  render(container: string | HTMLElement, config: HCaptchaRenderConfig): string | number;
  reset(widgetId?: string | number): void;
  remove?(widgetId: string | number): void;
  getResponse(widgetId?: string | number): string;
}

declare global {
  interface Window {
    hcaptcha?: HCaptchaApi;
    onHCaptchaApiReady?: () => void;
  }
}

let loadPromise: Promise<void> | null = null;

/** Carrega o script oficial do hCaptcha uma única vez (render=explicit). */
export function loadHCaptchaScript(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('window indisponível'));
  }
  if (window.hcaptcha) {
    return Promise.resolve();
  }
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector('script[data-hcaptcha-api]') as HTMLScriptElement | null;
    if (existing) {
      const check = () => {
        if (window.hcaptcha) resolve();
        else setTimeout(check, 50);
      };
      check();
      return;
    }

    window.onHCaptchaApiReady = () => resolve();

    const script = document.createElement('script');
    script.src = 'https://js.hcaptcha.com/1/api.js?render=explicit&onload=onHCaptchaApiReady';
    script.async = true;
    script.defer = true;
    script.dataset['hcaptchaApi'] = '1';
    script.onerror = () => {
      loadPromise = null;
      reject(new Error('Falha ao carregar script hCaptcha'));
    };
    document.head.appendChild(script);
  });

  return loadPromise;
}
