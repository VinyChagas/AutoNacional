import {
  Component,
  EventEmitter,
  Input,
  Output,
  OnInit,
  OnChanges,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Contabilidade } from '../../../models/contabilidade.model';

export type DrawerMode = 'create' | 'edit';

@Component({
  selector: 'app-contabilidade-drawer',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './contabilidade-drawer.component.html',
  styleUrls: ['./contabilidade-drawer.component.scss'],
})
export class ContabilidadeDrawerComponent implements OnInit, OnChanges {
  @Input() isOpen = false;
  @Input() mode: DrawerMode = 'create';
  @Input() contabilidade: Contabilidade | null = null;
  @Input() saving = false;
  @Input() error: string | null = null;

  @Output() closeDrawer = new EventEmitter<void>();
  @Output() saved = new EventEmitter<Record<string, unknown>>();

  form: FormGroup;

  constructor(private fb: FormBuilder) {
    this.form = this.fb.group({
      nome_contabilidade: ['', [Validators.required, Validators.minLength(3)]],
      cnpj: ['', [Validators.required, this.validarCNPJ]],
      responsavel: [''],
      telefone: [''],
      email: ['', [Validators.email]],
    });
  }

  ngOnInit(): void {
    this.patchFormIfEdit();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['contabilidade'] || changes['mode']) {
      this.patchFormIfEdit();
    }
  }

  private patchFormIfEdit(): void {
    if (this.mode === 'edit' && this.contabilidade) {
      this.form.patchValue({
        nome_contabilidade: this.contabilidade.nome_contabilidade,
        cnpj: this.formatarCNPJ(this.contabilidade.cnpj),
        responsavel: this.contabilidade.responsavel || '',
        telefone: this.formatarTelefone(this.contabilidade.telefone || ''),
        email: this.contabilidade.email || '',
      });
      this.form.get('cnpj')?.disable();
    } else {
      this.form.reset();
      this.form.get('cnpj')?.enable();
    }
  }

  validarCNPJ(control: { value: string }): { [key: string]: boolean } | null {
    if (!control.value) return null;
    const limpo = control.value.replace(/[^\d]/g, '');
    if (limpo.length !== 14) return { cnpjInvalido: true };
    return null;
  }

  onCnpjInput(e: Event): void {
    const input = e.target as HTMLInputElement;
    const v = input.value.replace(/\D/g, '');
    if (v.length <= 14) {
      input.value = this.formatarCNPJ(v);
      this.form.get('cnpj')?.setValue(input.value, { emitEvent: false });
    }
  }

  onTelefoneInput(e: Event): void {
    const input = e.target as HTMLInputElement;
    const v = input.value.replace(/\D/g, '');
    if (v.length <= 11) {
      input.value = this.formatarTelefone(v);
      this.form.get('telefone')?.setValue(input.value, { emitEvent: false });
    }
  }

  formatarCNPJ(v: string): string {
    const n = v.replace(/\D/g, '');
    if (n.length <= 2) return n;
    if (n.length <= 5) return `${n.slice(0, 2)}.${n.slice(2)}`;
    if (n.length <= 8) return `${n.slice(0, 2)}.${n.slice(2, 5)}.${n.slice(5)}`;
    if (n.length <= 12) return `${n.slice(0, 2)}.${n.slice(2, 5)}.${n.slice(5, 8)}/${n.slice(8)}`;
    return `${n.slice(0, 2)}.${n.slice(2, 5)}.${n.slice(5, 8)}/${n.slice(8, 12)}-${n.slice(12, 14)}`;
  }

  formatarTelefone(v: string): string {
    const n = v.replace(/\D/g, '');
    if (n.length <= 2) return n ? `(${n}` : '';
    if (n.length <= 6) return `(${n.slice(0, 2)}) ${n.slice(2)}`;
    return `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7, 11)}`;
  }

  get titulo(): string {
    return this.mode === 'edit' ? 'Editar Contabilidade' : 'Nova Contabilidade';
  }

  get botaoSalvar(): string {
    return this.mode === 'edit' ? 'Salvar Alterações' : 'Salvar';
  }

  fechar(): void {
    this.closeDrawer.emit();
  }

  salvar(): void {
    if (this.form.invalid) {
      Object.keys(this.form.controls).forEach((k) => {
        this.form.get(k)?.markAsTouched();
      });
      return;
    }
    this.saved.emit(this.form.getRawValue());
  }
}
