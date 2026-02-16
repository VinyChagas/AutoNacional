import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { trigger, transition, style, animate } from '@angular/animations';
import { ToastService, Toast } from '../../../services/toast.service';

@Component({
  selector: 'app-toast-container',
  standalone: true,
  imports: [CommonModule],
  animations: [
    trigger('toastAnim', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(-12px)' }),
        animate('300ms cubic-bezier(0.16, 1, 0.3, 1)', style({ opacity: 1, transform: 'translateY(0)' })),
      ]),
    ]),
  ],
  template: `
    <div class="toast-container">
      @for (toast of toasts; track toast.id) {
        <div
          class="toast toast-{{ toast.type }}"
          [@toastAnim]
          (click)="dismiss(toast.id)"
        >
          @if (toast.type === 'success') {
            <svg class="toast-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
          } @else if (toast.type === 'error') {
            <svg class="toast-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
          } @else {
            <svg class="toast-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
          }
          <span class="toast-message">{{ toast.message }}</span>
        </div>
      }
    </div>
  `,
  styles: [`
    .toast-container {
      position: fixed;
      top: 1rem;
      left: 50%;
      transform: translateX(-50%);
      z-index: 9999;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.5rem;
      pointer-events: none;
    }

    .toast-container > * {
      pointer-events: auto;
    }

    .toast {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.75rem 1.25rem;
      border-radius: 14px;
      font-size: 0.9rem;
      font-weight: 500;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.08);
      cursor: pointer;
      transition: transform 0.2s ease, box-shadow 0.2s ease;

      &:hover {
        transform: translateY(-2px);
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.15);
      }
    }

    .toast-icon {
      width: 20px;
      height: 20px;
      flex-shrink: 0;
    }

    .toast-success {
      background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
      color: white;
      border: 1px solid rgba(255, 255, 255, 0.2);
    }

    .toast-error {
      background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
      color: white;
      border: 1px solid rgba(255, 255, 255, 0.2);
    }

    .toast-info {
      background: var(--bg-card);
      color: var(--text-primary);
      border: 1px solid var(--border-color);
    }

    .dark .toast-info {
      background: var(--surface);
      border-color: rgba(255, 255, 255, 0.1);
    }
  `,
  ],
})
export class ToastContainerComponent {
  toasts: Toast[] = [];

  constructor(private toastService: ToastService) {
    this.toastService.toasts.subscribe((t) => (this.toasts = t));
  }

  dismiss(id: number): void {
    this.toastService.dismiss(id);
  }
}
