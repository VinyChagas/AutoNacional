import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export type ToastType = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  message: string;
  type: ToastType;
  duration?: number;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private toasts$ = new BehaviorSubject<Toast[]>([]);
  private nextId = 0;

  get toasts() {
    return this.toasts$.asObservable();
  }

  get currentToasts() {
    return this.toasts$.getValue();
  }

  success(message: string, duration = 3500): void {
    this.show({ message, type: 'success', duration });
  }

  error(message: string, duration = 4000): void {
    this.show({ message, type: 'error', duration });
  }

  info(message: string, duration = 3000): void {
    this.show({ message, type: 'info', duration });
  }

  private show(options: { message: string; type: ToastType; duration?: number }): void {
    const toast: Toast = {
      id: ++this.nextId,
      message: options.message,
      type: options.type,
      duration: options.duration ?? 3500,
    };
    const list = [...this.toasts$.getValue(), toast];
    this.toasts$.next(list);
    if (toast.duration && toast.duration > 0) {
      setTimeout(() => this.dismiss(toast.id), toast.duration);
    }
  }

  dismiss(id: number): void {
    this.toasts$.next(this.toasts$.getValue().filter((t) => t.id !== id));
  }
}
