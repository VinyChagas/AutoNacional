import {
  Component,
  EventEmitter,
  Input,
  Output,
  OnInit,
  ChangeDetectorRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ContabilidadeService } from '../../../services/contabilidade.service';
import { EmpresasUnificadoService } from '../../../services/empresas-unificado.service';
import { ToastService } from '../../../services/toast.service';
import type { Contabilidade } from '../../../models/contabilidade.model';

@Component({
  selector: 'app-empresas-cadastro',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './empresas-cadastro.component.html',
  styleUrls: ['./empresas-cadastro.component.scss'],
})
export class EmpresasCadastroComponent implements OnInit {
  @Input() isOpen = false;
  @Output() close = new EventEmitter<void>();
  @Output() saved = new EventEmitter<void>();

  metodo: 'cert' | 'cred' = 'cert';
  tipoDocumento: 'CNPJ' | 'CPF' = 'CNPJ';
  contabilidadeId: number | null = null;
  certFile: File | null = null;
  certSenha = '';
  credDocumento = '';
  credRazao = '';
  credSenha = '';

  contabilidades: Array<{ id: number; nome_contabilidade: string }> = [];
  loadingContabilidades = false;
  isSaving = false;
  erro: string | null = null;

  constructor(
    private cdr: ChangeDetectorRef,
    private contabilidadeService: ContabilidadeService,
    private empresasService: EmpresasUnificadoService,
    private toast: ToastService
  ) {}

  ngOnInit(): void {
    this.carregarContabilidades();
  }

  carregarContabilidades(): void {
    this.loadingContabilidades = true;
    this.cdr.markForCheck();

    this.contabilidadeService.listar().subscribe({
      next: (r) => {
        this.contabilidades = (r.contabilidades ?? []).map((c) => ({
          id: c.id,
          nome_contabilidade: c.nome_contabilidade,
        }));
        this.loadingContabilidades = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.loadingContabilidades = false;
        this.contabilidades = [];
        this.cdr.markForCheck();
      },
    });
  }

  get isFormValid(): boolean {
    if (!this.contabilidadeId || this.contabilidadeId < 1) return false;

    if (this.metodo === 'cert') {
      return !!this.certFile && this.certSenha.trim().length >= 3;
    }

    const docLimpo = this.limparDocumento(this.credDocumento);
    const docValido =
      this.tipoDocumento === 'CPF'
        ? docLimpo.length === 11
        : docLimpo.length === 14;
    return (
      docValido &&
      this.credRazao.trim().length >= 2 &&
      this.credSenha.trim().length >= 4
    );
  }

  get contabilidadeObrigatoriaMsg(): string | null {
    if (this.contabilidadeId != null && this.contabilidadeId >= 1) return null;
    return 'Selecione a contabilidade antes de salvar.';
  }

  onSelectMetodo(m: 'cert' | 'cred'): void {
    this.metodo = m;
    this.erro = null;
    if (m === 'cert') {
      this.credDocumento = '';
      this.credRazao = '';
      this.credSenha = '';
    } else {
      this.certFile = null;
      this.certSenha = '';
    }
    this.cdr.markForCheck();
  }

  acionarFileInput(input: HTMLInputElement): void {
    input.value = '';
    input.click();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files?.length) {
      this.certFile = input.files[0];
      this.erro = null;
      this.cdr.markForCheck();
    }
    input.value = '';
  }

  onSelectTipoDocumento(tipo: 'CNPJ' | 'CPF'): void {
    this.tipoDocumento = tipo;
    this.credDocumento = '';
    this.cdr.markForCheck();
  }

  onDocumentoInput(val: string): void {
    const mascara =
      this.tipoDocumento === 'CPF'
        ? this.aplicarMascaraCpf
        : this.aplicarMascaraCnpj;
    this.credDocumento = mascara.call(this, val ?? this.credDocumento);
  }

  private aplicarMascaraCnpj(val: string): string {
    const nums = val.replace(/\D/g, '').slice(0, 14);
    if (nums.length <= 2) return nums;
    if (nums.length <= 5) return `${nums.slice(0, 2)}.${nums.slice(2)}`;
    if (nums.length <= 8)
      return `${nums.slice(0, 2)}.${nums.slice(2, 5)}.${nums.slice(5)}`;
    if (nums.length <= 12)
      return `${nums.slice(0, 2)}.${nums.slice(2, 5)}.${nums.slice(5, 8)}/${nums.slice(8)}`;
    return `${nums.slice(0, 2)}.${nums.slice(2, 5)}.${nums.slice(5, 8)}/${nums.slice(8, 12)}-${nums.slice(12)}`;
  }

  private aplicarMascaraCpf(val: string): string {
    const nums = val.replace(/\D/g, '').slice(0, 11);
    if (nums.length <= 3) return nums;
    if (nums.length <= 6) return `${nums.slice(0, 3)}.${nums.slice(3)}`;
    if (nums.length <= 9)
      return `${nums.slice(0, 3)}.${nums.slice(3, 6)}.${nums.slice(6)}`;
    return `${nums.slice(0, 3)}.${nums.slice(3, 6)}.${nums.slice(6, 9)}-${nums.slice(9)}`;
  }

  private limparDocumento(val: string): string {
    return (val || '').replace(/\D/g, '');
  }

  onSalvar(): void {
    if (!this.isFormValid) return;
    if (!this.contabilidadeId || this.contabilidadeId < 1) {
      this.erro = 'Selecione a contabilidade antes de salvar.';
      this.cdr.markForCheck();
      return;
    }

    this.isSaving = true;
    this.erro = null;
    this.cdr.markForCheck();

    if (this.metodo === 'cert') {
      this.empresasService
        .cadastroCertificado(
          this.certFile!,
          this.certSenha,
          this.contabilidadeId
        )
        .subscribe({
          next: () => {
            this.toast.success('Empresa cadastrada com sucesso via certificado!');
            this.limparEfechar(true);
          },
          error: (err) => {
            this.erro = (err as Error)?.message || 'Erro ao cadastrar empresa';
            this.isSaving = false;
            this.cdr.markForCheck();
          },
        });
    } else {
      const docLimpo = this.limparDocumento(this.credDocumento);
      this.empresasService
        .cadastroCredencial({
          cnpj: docLimpo,
          tipo: this.tipoDocumento === 'CPF' ? 'CPF_SENHA' : 'CNPJ_SENHA',
          razao_social: this.credRazao.trim(),
          senha: this.credSenha,
          contabilidade_id: this.contabilidadeId,
        })
        .subscribe({
          next: () => {
            this.toast.success('Empresa cadastrada com sucesso via credenciais!');
            this.limparEfechar(true);
          },
          error: (err) => {
            this.erro = (err as Error)?.message || 'Erro ao cadastrar empresa';
            this.isSaving = false;
            this.cdr.markForCheck();
          },
        });
    }
  }

  onCancelar(): void {
    this.limparEfechar(false);
  }

  private limparEfechar(emitSaved: boolean): void {
    this.metodo = 'cert';
    this.tipoDocumento = 'CNPJ';
    this.contabilidadeId = null;
    this.certFile = null;
    this.certSenha = '';
    this.credDocumento = '';
    this.credRazao = '';
    this.credSenha = '';
    this.erro = null;
    this.isSaving = false;
    this.cdr.markForCheck();
    if (emitSaved) this.saved.emit();
    this.close.emit();
  }

  fechar(): void {
    this.limparEfechar(false);
  }
}
