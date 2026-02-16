import {
  Component,
  Input,
  Output,
  EventEmitter,
  ChangeDetectorRef,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ValidacoesService, type ProgressEvent, type DoneEvent } from '../../../services/validacoes.service';
import { ToastService } from '../../../services/toast.service';
import { Subscription } from 'rxjs';

export interface EmpresaValidacaoItem {
  id: number;
  cnpj: string;
  razao_social: string;
}

export interface ValidacaoProgressItem {
  empresa_id: number;
  cnpj: string;
  razao_social: string;
  metodo: 'Cert' | 'Cred';
  status: string;
  message?: string;
  updated_at?: string;
}

@Component({
  selector: 'app-empresas-validacao-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './empresas-validacao-modal.component.html',
  styleUrls: ['./empresas-validacao-modal.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmpresasValidacaoModalComponent {
  @Input() isOpen = false;
  @Input() empresas: EmpresaValidacaoItem[] = [];
  @Input() empresaIds: number[] = [];
  @Input() scopeFilteredCount = 0;
  @Input() scopeSelectedCount = 0;
  @Output() close = new EventEmitter<void>();
  @Output() concluido = new EventEmitter<void>();

  scope: 'FILTERED' | 'SELECTED' = 'FILTERED';
  headless = true;

  rodando = false;
  progressItems: ValidacaoProgressItem[] = [];
  progressDone = 0;
  progressTotal = 0;
  apenasFalhas = false;
  doneTotals: { ok: number; invalidas: number; erros: number } | null = null;

  private sub?: Subscription;

  constructor(
    private cdr: ChangeDetectorRef,
    private validacoesService: ValidacoesService,
    private toast: ToastService
  ) {}

  get scopeLabel(): string {
    if (this.scope === 'FILTERED') {
      return `Validar empresas filtradas (${this.scopeFilteredCount})`;
    }
    return `Validar selecionadas (${this.scopeSelectedCount})`;
  }

  get idsParaValidar(): number[] {
    return this.scope === 'SELECTED' ? this.empresaIds : this.empresas.map((e) => e.id);
  }

  get filteredProgressItems(): ValidacaoProgressItem[] {
    if (!this.apenasFalhas) return this.progressItems;
    return this.progressItems.filter(
      (i) =>
        i.status === 'INVALIDA' ||
        i.status === 'ERRO_VALIDACAO' ||
        i.status === 'VENCIDO' ||
        i.status === 'ERRO'
    );
  }

  podeIniciar(): boolean {
    return this.idsParaValidar.length > 0;
  }

  onIniciar(): void {
    if (!this.podeIniciar() || this.rodando) return;

    const ids = this.idsParaValidar;
    this.rodando = true;
    this.progressItems = [];
    this.progressDone = 0;
    this.progressTotal = ids.length;
    this.doneTotals = null;
    this.cdr.markForCheck();

    const payload = {
      empresa_ids: ids,
      validar_certificados: false,
      validar_credenciais: true,
      headless: this.headless,
    };

    this.validacoesService.iniciar(payload).subscribe({
      next: (r) => {
        this.sub = this.validacoesService.stream(r.job_id).subscribe({
          next: (ev) => {
            if ('totals' in ev) {
              this.doneTotals = ev.totals;
              this.rodando = false;
              this.toast.success(`Validação concluída: ${ev.totals.ok} OK, ${ev.totals.invalidas} inválidas, ${ev.totals.erros} erros`);
              this.cdr.markForCheck();
              this.sub?.unsubscribe();
            } else {
              this.handleProgress(ev as ProgressEvent);
            }
          },
          error: (err) => {
            this.rodando = false;
            this.toast.error('Erro ao receber progresso da validação');
            this.cdr.markForCheck();
          },
          complete: () => {
            this.rodando = false;
            this.cdr.markForCheck();
          },
        });
        this.cdr.markForCheck();
      },
      error: (err: unknown) => {
        this.rodando = false;
        const e = err as { error?: { detail?: string; message?: string }; message?: string };
        const msg = e?.error?.detail ?? e?.error?.message ?? e?.message ?? 'Erro ao iniciar validação. Verifique se o backend está rodando.';
        this.toast.error(msg);
        this.cdr.markForCheck();
      },
    });
  }

  private handleProgress(ev: ProgressEvent): void {
    const metodo = ev.step === 'cert' ? 'Cert' : 'Cred';
    const idx = this.progressItems.findIndex(
      (i) => i.empresa_id === ev.empresa_id && i.metodo === metodo
    );
    const item: ValidacaoProgressItem = {
      empresa_id: ev.empresa_id,
      cnpj: ev.cnpj ?? '',
      razao_social: ev.razao_social ?? '',
      metodo,
      status: ev.status,
      message: ev.message,
      updated_at: ev.updated_at,
    };
    if (idx >= 0) {
      this.progressItems[idx] = item;
    } else {
      this.progressItems.push(item);
    }
    if (ev.status !== 'TESTANDO') {
      const doneIds = new Set(
        this.progressItems
          .filter((i) => i.status !== 'TESTANDO')
          .map((i) => i.empresa_id)
      );
      this.progressDone = doneIds.size;
    }
    this.cdr.markForCheck();
  }

  onFechar(): void {
    if (this.rodando) {
      if (!confirm('Validação em andamento. Deseja fechar mesmo assim?')) return;
      this.sub?.unsubscribe();
      this.rodando = false;
    }
    this.close.emit();
    this.cdr.markForCheck();
  }

  onConcluir(): void {
    this.concluido.emit();
    this.close.emit();
    this.cdr.markForCheck();
  }

  formatarCnpj(cnpj: string): string {
    const l = (cnpj || '').replace(/\D/g, '');
    if (l.length === 11) {
      return l.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
    }
    if (l.length === 14) {
      if (l.startsWith('000')) {
        const cpf = l.slice(-11);
        return cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
      }
      return l.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
    }
    return cnpj || '-';
  }
}
