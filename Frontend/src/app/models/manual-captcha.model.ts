/**
 * Modelos da Central Manual de Captchas (Socket.IO) — modo remote_click.
 */

export type CaptchaMode = 'TWO_CAPTCHA' | 'MANUAL';

export type ManualInteractionMode = 'remote_click' | 'token';

export interface ManualCaptchaFrame {
  seq: number;
  mime: 'image/jpeg' | 'image/png';
  base64: string;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
  capturedAt: string;
}

export interface ManualCaptchaRequest {
  captchaId: string;
  attemptId: string;
  batchId: string;
  executionId: string;
  empresaId: string;
  empresaNome: string;
  cnpj: string;
  siteKey: string;
  pageUrl: string;
  interactionMode?: ManualInteractionMode;
  latestFrame?: ManualCaptchaFrame;
  rqdata?: string;
  action?: string;
  userAgent?: string;
  callbackName?: string;
  payloadFingerprint: string;
  createdAt: string;
  expiresAt: string;
  timeoutSeconds: number;
  debug?: boolean;
}

export type CaptchaCardLocalStatus =
  | 'waiting'
  | 'clicking'
  | 'refreshing'
  | 'confirming'
  | 'resolved'
  | 'skipping'
  | 'expired'
  | 'error';

export interface CaptchaCardState extends ManualCaptchaRequest {
  localStatus: CaptchaCardLocalStatus;
  errorMessage?: string;
  panelOpen?: boolean;
  clickCount?: number;
}

export type SocketConnectionStatus = 'connected' | 'reconnecting' | 'disconnected';

export interface CaptchaResolveAck {
  ok: boolean;
  error?: string;
  message?: string;
  captchaId?: string;
  attemptId?: string;
  tokenLength?: number;
  tokenHash?: string;
  receivedAt?: string;
}

export interface CaptchaFrameEvent {
  captchaId: string;
  attemptId: string;
  batchId: string;
  seq: number;
  mime: 'image/jpeg' | 'image/png';
  base64: string;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
  capturedAt: string;
}
