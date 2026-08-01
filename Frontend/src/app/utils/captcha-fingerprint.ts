/**
 * Fingerprint/hash compartilhados com o backend (diagnóstico CAPTCHA_DEBUG).
 * Usa Web Crypto quando disponível; fallback síncrono simples para testes.
 */

export async function sha256Hex(input: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const data = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Fallback não criptográfico (apenas para ambientes sem subtle)
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h << 5) - h + input.charCodeAt(i);
    h |= 0;
  }
  return `fallback${Math.abs(h).toString(16)}`.padEnd(16, '0').slice(0, 64);
}

export async function fingerprintToken(token: string): Promise<{
  tokenLength: number;
  tokenHash: string;
  tokenPreview: string;
}> {
  const tokenLength = token?.length ?? 0;
  const full = await sha256Hex(token || '');
  const tokenHash = full.slice(0, 16);
  const tokenPreview =
    tokenLength > 12 ? `${token.slice(0, 6)}...${token.slice(-3)}` : '***';
  return { tokenLength, tokenHash, tokenPreview };
}

export async function payloadFingerprint(parts: {
  captchaId: string;
  attemptId: string;
  siteKey: string;
  pageUrl: string;
  rqdata?: string;
  action?: string;
}): Promise<string> {
  const raw = [
    parts.captchaId,
    parts.attemptId,
    parts.siteKey,
    parts.pageUrl,
    parts.rqdata ?? '',
    parts.action ?? '',
  ].join('|');
  const full = await sha256Hex(raw);
  return full.slice(0, 24);
}

export function maskSiteKey(siteKey: string): string {
  if (!siteKey) return '—';
  if (siteKey.length <= 10) return '***';
  return `${siteKey.slice(0, 6)}…${siteKey.slice(-4)}`;
}
