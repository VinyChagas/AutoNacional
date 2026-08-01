import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { environment } from '../../environments/environment';
import type {
  CaptchaFrameEvent,
  CaptchaResolveAck,
  ManualCaptchaRequest,
  SocketConnectionStatus,
} from '../models/manual-captcha.model';

function socketBaseUrl(): string {
  const api = environment.apiUrl || '';
  if (api.startsWith('http')) {
    return api.replace(/\/api\/?$/, '');
  }
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  return '';
}

@Injectable({ providedIn: 'root' })
export class CaptchaCentralService {
  private socket: Socket | null = null;
  private currentBatchId: string | null = null;

  private readonly captchasSubject = new BehaviorSubject<ManualCaptchaRequest[]>([]);
  private readonly connectionSubject = new BehaviorSubject<SocketConnectionStatus>('disconnected');
  private readonly errorSubject = new Subject<{ captchaId?: string; error: string; message?: string }>();
  private readonly frameSubject = new Subject<CaptchaFrameEvent>();

  readonly captchas$: Observable<ManualCaptchaRequest[]> = this.captchasSubject.asObservable();
  readonly connection$: Observable<SocketConnectionStatus> = this.connectionSubject.asObservable();
  readonly errors$ = this.errorSubject.asObservable();
  readonly frames$ = this.frameSubject.asObservable();

  constructor(private zone: NgZone) {}

  get batchId(): string | null {
    return this.currentBatchId;
  }

  connect(batchId: string): void {
    if (!batchId) return;

    if (this.socket && this.currentBatchId === batchId) {
      this.joinBatch(batchId);
      return;
    }

    this.disconnect();
    this.currentBatchId = batchId;

    const url = socketBaseUrl();
    this.socket = io(url, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: 20,
      reconnectionDelay: 1000,
    });

    this.socket.on('connect', () => {
      this.zone.run(() => {
        this.connectionSubject.next('connected');
        this.joinBatch(batchId);
      });
    });

    this.socket.on('reconnect_attempt', () => {
      this.zone.run(() => this.connectionSubject.next('reconnecting'));
    });

    this.socket.on('disconnect', () => {
      this.zone.run(() => this.connectionSubject.next('disconnected'));
    });

    this.socket.on('connect_error', () => {
      this.zone.run(() => this.connectionSubject.next('disconnected'));
    });

    this.socket.on('captcha:created', (payload: ManualCaptchaRequest) => {
      this.zone.run(() => this.upsertCaptcha(payload));
    });

    this.socket.on('captcha:frame', (payload: CaptchaFrameEvent) => {
      this.zone.run(() => {
        this.applyFrame(payload);
        this.frameSubject.next(payload);
      });
    });

    this.socket.on('captcha:batch-state', (payload: { batchId: string; captchas: ManualCaptchaRequest[] }) => {
      this.zone.run(() => {
        if (payload?.batchId === this.currentBatchId) {
          this.captchasSubject.next([...(payload.captchas || [])]);
        }
      });
    });

    this.socket.on('captcha:removed', (payload: { captchaId: string }) => {
      this.zone.run(() => this.removeCaptcha(payload.captchaId));
    });

    this.socket.on('captcha:resolved', (payload: { captchaId: string }) => {
      this.zone.run(() => this.removeCaptcha(payload.captchaId));
    });

    this.socket.on('captcha:expired', (payload: { captchaId: string }) => {
      this.zone.run(() => this.removeCaptcha(payload.captchaId));
    });

    this.socket.on(
      'captcha:error',
      (payload: { captchaId?: string; error: string; message?: string }) => {
        this.zone.run(() => this.errorSubject.next(payload));
      }
    );
  }

  disconnect(): void {
    if (this.socket && this.currentBatchId) {
      this.socket.emit('captcha:leave-batch', { batchId: this.currentBatchId });
    }
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.socket = null;
    this.currentBatchId = null;
    this.captchasSubject.next([]);
    this.connectionSubject.next('disconnected');
  }

  sendClick(captchaId: string, xNorm: number, yNorm: number): Promise<CaptchaResolveAck> {
    return this.emitWithAck('captcha:click', {
      batchId: this.currentBatchId,
      captchaId,
      xNorm,
      yNorm,
    });
  }

  refreshFrame(captchaId: string): Promise<CaptchaResolveAck> {
    return this.emitWithAck('captcha:refresh', {
      batchId: this.currentBatchId,
      captchaId,
    });
  }

  confirmPortal(captchaId: string): Promise<CaptchaResolveAck> {
    return this.emitWithAck('captcha:confirm', {
      batchId: this.currentBatchId,
      captchaId,
    });
  }

  skipCaptcha(captchaId: string): Promise<CaptchaResolveAck> {
    return this.emitWithAck('captcha:skip', {
      batchId: this.currentBatchId,
      captchaId,
    });
  }

  private joinBatch(batchId: string): void {
    this.socket?.emit('captcha:join-batch', { batchId }, (ack?: { ok?: boolean }) => {
      if (ack && ack.ok === false) {
        this.errorSubject.next({ error: 'JOIN_FAILED', message: 'Falha ao entrar na sala do lote' });
      }
    });
  }

  private emitWithAck(event: string, payload: Record<string, unknown>): Promise<CaptchaResolveAck> {
    return new Promise((resolve) => {
      if (!this.socket || !this.socket.connected) {
        resolve({ ok: false, error: 'SOCKET_DISCONNECTED', message: 'Socket desconectado' });
        return;
      }
      this.socket.emit(event, payload, (ack: CaptchaResolveAck) => {
        this.zone.run(() => resolve(ack || { ok: false, error: 'NO_ACK' }));
      });
    });
  }

  private applyFrame(frame: CaptchaFrameEvent): void {
    if (!frame?.captchaId) return;
    const list = this.captchasSubject.value.map((c) => {
      if (c.captchaId !== frame.captchaId) return c;
      return {
        ...c,
        latestFrame: {
          seq: frame.seq,
          mime: frame.mime,
          base64: frame.base64,
          width: frame.width,
          height: frame.height,
          viewportWidth: frame.viewportWidth,
          viewportHeight: frame.viewportHeight,
          capturedAt: frame.capturedAt,
        },
      };
    });
    this.captchasSubject.next(list);
  }

  private upsertCaptcha(captcha: ManualCaptchaRequest): void {
    if (!captcha?.captchaId) return;
    if (this.currentBatchId && captcha.batchId !== this.currentBatchId) return;
    const list = this.captchasSubject.value.filter((c) => c.captchaId !== captcha.captchaId);
    this.captchasSubject.next([...list, captcha]);
  }

  private removeCaptcha(captchaId: string): void {
    if (!captchaId) return;
    this.captchasSubject.next(
      this.captchasSubject.value.filter((c) => c.captchaId !== captchaId)
    );
  }
}
