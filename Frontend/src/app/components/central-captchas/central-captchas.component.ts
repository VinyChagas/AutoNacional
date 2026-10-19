import {

  Component,

  OnDestroy,

  OnInit,

  ChangeDetectorRef,

} from '@angular/core';

import { CommonModule } from '@angular/common';

import { ActivatedRoute } from '@angular/router';

import { Subject, takeUntil } from 'rxjs';

import { CaptchaCentralService } from '../../services/captcha-central.service';

import { environment } from '../../../environments/environment';

import type {

  CaptchaCardState,

  ManualCaptchaRequest,

  SocketConnectionStatus,

} from '../../models/manual-captcha.model';



@Component({

  selector: 'app-central-captchas',

  standalone: true,

  imports: [CommonModule],

  templateUrl: './central-captchas.component.html',

  styleUrls: ['./central-captchas.component.scss'],

})

export class CentralCaptchasComponent implements OnInit, OnDestroy {

  batchId = '';

  connection: SocketConnectionStatus = 'disconnected';

  cards: CaptchaCardState[] = [];

  nowMs = Date.now();

  routeError = '';

  captchaDebug = !!(environment as { captchaDebug?: boolean }).captchaDebug;

  private destroy$ = new Subject<void>();

  private tickTimer: ReturnType<typeof setInterval> | null = null;



  constructor(

    private route: ActivatedRoute,

    private captchaCentral: CaptchaCentralService,

    private cdr: ChangeDetectorRef

  ) {}



  ngOnInit(): void {

    this.batchId = this.route.snapshot.paramMap.get('batchId') || '';

    if (!this.batchId) {

      this.routeError = 'batchId ausente na rota';

      return;

    }



    this.captchaCentral.connect(this.batchId);



    this.captchaCentral.connection$

      .pipe(takeUntil(this.destroy$))

      .subscribe((status) => {

        this.connection = status;

        this.cdr.markForCheck();

      });



    this.captchaCentral.captchas$

      .pipe(takeUntil(this.destroy$))

      .subscribe((list) => this.syncCards(list));



    this.captchaCentral.errors$

      .pipe(takeUntil(this.destroy$))

      .subscribe((err) => {

        if (!err.captchaId) return;

        const card = this.cards.find((c) => c.captchaId === err.captchaId);

        if (card) {

          card.localStatus = 'error';

          card.errorMessage = err.message || err.error;

          this.cdr.markForCheck();

        }

      });



    this.tickTimer = setInterval(() => {

      this.nowMs = Date.now();

      for (const card of this.cards) {

        if (

          card.localStatus === 'waiting' ||

          card.localStatus === 'clicking' ||

          card.localStatus === 'error'

        ) {

          if (new Date(card.expiresAt).getTime() <= this.nowMs) {

            card.localStatus = 'expired';

          }

        }

      }

      this.cdr.markForCheck();

    }, 1000);

  }



  ngOnDestroy(): void {

    if (this.tickTimer) clearInterval(this.tickTimer);

    this.captchaCentral.disconnect();

    this.destroy$.next();

    this.destroy$.complete();

  }



  get awaitingCount(): number {

    return this.cards.filter(

      (c) =>

        c.localStatus === 'waiting' ||

        c.localStatus === 'clicking' ||

        c.localStatus === 'refreshing' ||

        c.localStatus === 'confirming'

    ).length;

  }



  get connectionLabel(): string {

    switch (this.connection) {

      case 'connected':

        return 'Conectado';

      case 'reconnecting':

        return 'Reconectando';

      default:

        return 'Desconectado';

    }

  }



  formatCnpj(cnpj: string): string {

    const d = (cnpj || '').replace(/\D/g, '');

    if (d.length !== 14) return cnpj || '-';

    return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');

  }



  expiresInLabel(card: CaptchaCardState): string {

    const remaining = Math.max(0, new Date(card.expiresAt).getTime() - this.nowMs);

    const totalSec = Math.floor(remaining / 1000);

    const m = Math.floor(totalSec / 60);

    const s = totalSec % 60;

    return `Expira em ${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

  }



  statusLabel(card: CaptchaCardState): string {

    switch (card.localStatus) {

      case 'waiting':

        return 'Clique na imagem para resolver';

      case 'clicking':

        return 'Enviando clique…';

      case 'refreshing':

        return 'Atualizando print…';

      case 'confirming':

        return 'Confirmando no portal…';

      case 'resolved':

        return 'Resolvido';

      case 'skipping':

        return 'Pulando';

      case 'expired':

        return 'Expirado';

      case 'error':

        return 'Erro';

      default:

        return card.localStatus;

    }

  }



  frameSrc(card: CaptchaCardState): string | null {

    const f = card.latestFrame;

    if (!f?.base64) return null;

    return `data:${f.mime};base64,${f.base64}`;

  }



  isBusy(card: CaptchaCardState): boolean {

    return (

      card.localStatus === 'clicking' ||

      card.localStatus === 'refreshing' ||

      card.localStatus === 'confirming' ||

      card.localStatus === 'skipping'

    );

  }



  canInteract(card: CaptchaCardState): boolean {

    if (this.isBusy(card)) return false;

    if (card.localStatus === 'expired' || card.localStatus === 'resolved') return false;

    if (new Date(card.expiresAt).getTime() <= Date.now()) return false;

    return !!card.latestFrame?.base64;

  }



  canSkip(card: CaptchaCardState): boolean {

    return (

      !this.isBusy(card) &&

      card.localStatus !== 'expired' &&

      card.localStatus !== 'resolved'

    );

  }



  togglePanel(card: CaptchaCardState): void {

    card.panelOpen = !card.panelOpen;

  }



  async onImageClick(card: CaptchaCardState, event: MouseEvent): Promise<void> {

    if (!this.canInteract(card)) return;

    const img = event.currentTarget as HTMLImageElement;

    const rect = img.getBoundingClientRect();

    if (rect.width <= 0 || rect.height <= 0) return;



    const xNorm = (event.clientX - rect.left) / rect.width;

    const yNorm = (event.clientY - rect.top) / rect.height;

    const clampedX = Math.max(0, Math.min(1, xNorm));

    const clampedY = Math.max(0, Math.min(1, yNorm));



    card.localStatus = 'clicking';

    card.errorMessage = undefined;

    card.clickCount = (card.clickCount || 0) + 1;

    this.cdr.markForCheck();



    const ack = await this.captchaCentral.sendClick(card.captchaId, clampedX, clampedY);

    if (ack.ok) {

      // card some via captcha:resolved; se ainda existir, volta a waiting

      if (this.cards.some((c) => c.captchaId === card.captchaId)) {

        card.localStatus = 'waiting';

      }

    } else {

      card.localStatus = 'error';

      card.errorMessage = ack.message || ack.error || 'Falha ao enviar clique';

    }

    this.cdr.markForCheck();

  }



  async onRefresh(card: CaptchaCardState): Promise<void> {

    if (!this.canSkip(card)) return;

    card.localStatus = 'refreshing';

    card.errorMessage = undefined;

    this.cdr.markForCheck();



    const ack = await this.captchaCentral.refreshFrame(card.captchaId);

    card.localStatus = ack.ok ? 'waiting' : 'error';

    if (!ack.ok) {

      card.errorMessage = ack.message || ack.error || 'Falha ao atualizar print';

    }

    this.cdr.markForCheck();

  }



  async onConfirm(card: CaptchaCardState): Promise<void> {

    if (!this.canSkip(card)) return;

    card.localStatus = 'confirming';

    card.errorMessage = undefined;

    this.cdr.markForCheck();



    const ack = await this.captchaCentral.confirmPortal(card.captchaId);

    if (ack.ok) {

      if (this.cards.some((c) => c.captchaId === card.captchaId)) {

        card.localStatus = 'waiting';

      }

    } else {

      card.localStatus = 'error';

      card.errorMessage = ack.message || ack.error || 'Falha ao confirmar no portal';

    }

    this.cdr.markForCheck();

  }



  async onSkip(card: CaptchaCardState): Promise<void> {

    if (!this.canSkip(card)) return;

    card.localStatus = 'skipping';

    this.cdr.markForCheck();



    const ack = await this.captchaCentral.skipCaptcha(card.captchaId);

    if (ack.ok) {

      this.cards = this.cards.filter((c) => c.captchaId !== card.captchaId);

    } else {

      card.localStatus = 'error';

      card.errorMessage = ack.message || ack.error || 'Falha ao pular captcha';

    }

    this.cdr.markForCheck();

  }



  trackByCaptchaId(_: number, card: CaptchaCardState): string {

    return card.captchaId;

  }



  private syncCards(list: ManualCaptchaRequest[]): void {

    const byId = new Map(this.cards.map((c) => [c.captchaId, c]));

    const next: CaptchaCardState[] = [];



    for (const item of list) {

      const existing = byId.get(item.captchaId);

      if (existing) {

        const prevStatus = existing.localStatus;

        Object.assign(existing, item);

        // não sobrescrever estado transitório de ação

        if (

          prevStatus === 'clicking' ||

          prevStatus === 'refreshing' ||

          prevStatus === 'confirming' ||

          prevStatus === 'skipping'

        ) {

          existing.localStatus = prevStatus;

        } else if (

          existing.localStatus !== 'error' &&

          existing.localStatus !== 'expired'

        ) {

          existing.localStatus = 'waiting';

        }

        next.push(existing);

        byId.delete(item.captchaId);

      } else {

        next.push({

          ...item,

          localStatus: 'waiting',

          panelOpen: this.captchaDebug || !!item.debug,

          clickCount: 0,

        });

      }

    }



    this.cards = next;

    this.cdr.markForCheck();

  }

}


