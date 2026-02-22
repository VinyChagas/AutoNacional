import {
  Component,
  EventEmitter,
  Input,
  Output,
  OnChanges,
  SimpleChanges,
  OnInit,
  OnDestroy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { merge, Subscription } from 'rxjs';
import { ReactiveFormsModule, FormsModule, FormBuilder, FormGroup } from '@angular/forms';
import { EmpresaListagemItem } from '../../../models/empresas-unificado.model';
import { EmpresaDetalhes } from '../../../models/empresas-unificado.model';
import type { Contabilidade } from '../../../models/contabilidade.model';

/** Snapshot inicial para comparação dirty */
export interface EditorSnapshot {
  contabilidade_id: number | null;
  credenciaisEnabled: boolean;
  credencialId: number | null;
  credencialUsuario: string;
  credencialTipo: string;
  credencialStatus: string;
}

/** Payload unificado para salvar */
export interface EditorSavePayload {
  contabilidade_id?: number;
  credenciais?:
    | { action: 'CREATE'; usuario: string; senha: string; tipo: string }
    | { action: 'UPDATE'; credencialId: number; senha?: string }
    | { action: 'REACTIVATE'; credencialId: number; senha?: string }
    | { action: 'MARK_INACTIVE'; credencialId: number };
}

@Component({
  selector: 'app-empresa-drawer',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule],
  templateUrl: './empresa-drawer.component.html',
  styleUrls: ['./empresa-drawer.component.scss'],
})
export class EmpresaDrawerComponent implements OnInit, OnChanges, OnDestroy {
  @Input() isOpen = false;
  @Input() inline = false;
  @Input() empresa: EmpresaListagemItem | null = null;
  @Input() detalhes: EmpresaDetalhes | null = null;
  @Input() contabilidades: Contabilidade[] = [];
  @Input() savingCertificado = false;
  @Input() saving = false;
  @Input() removendoCertificado = false;
  @Input() error: string | null = null;

  @Output() closeDrawer = new EventEmitter<void>();
  @Output() closeRequest = new EventEmitter<{ hasDirty: boolean }>();
  @Output() certificadoEnviado = new EventEmitter<{ file: File; senha: string; contabilidade_id: number }>();
  @Output() certificadoSolicitouRemocao = new EventEmitter<{ cnpj: string }>();
  @Output() save = new EventEmitter<EditorSavePayload>();
  @Output() dirtyChange = new EventEmitter<boolean>();

  readonly TOTAL_COLUNAS = 8;

  formContabilidade: FormGroup;
  formCredencial: FormGroup;

  /** Estado editável */
  formState = {
    contabilidade_id: null as number | null,
    credenciaisEnabled: false,
    credencialId: null as number | null,
    credencialUsuario: '',
    credencialTipo: 'CNPJ_SENHA',
    credencialStatus: '',
    credencialSenha: '',
  };

  /** Snapshot para dirty check */
  initialSnapshot: EditorSnapshot | null = null;

  certificadoFile: File | null = null;
  modalSenhaAberta = false;
  modalSenha = '';

  private dirtySub?: Subscription;

  constructor(private fb: FormBuilder) {
    this.formContabilidade = this.fb.group({
      contabilidade_id: [''],
    });
    this.formCredencial = this.fb.group({
      usuario: [''],
      senha: [''],
      tipo: ['CNPJ_SENHA'],
    });
  }

  ngOnInit(): void {
    this.dirtySub = merge(
      this.formContabilidade.valueChanges,
      this.formCredencial.valueChanges
    ).subscribe(() => this.dirtyChange.emit(this.isDirty));
  }

  ngOnDestroy(): void {
    this.dirtySub?.unsubscribe();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['empresa'] || changes['detalhes']) {
      this.buildSnapshotAndState();
      this.dirtyChange.emit(this.isDirty);
    }
  }

  private buildSnapshotAndState(): void {
    if (!this.empresa) return;

    const contabId = this.empresa.contabilidade_id ?? null;
    const credencialPrincipal = this.detalhes?.credenciais?.[0];
    const credencialAtiva = !!(credencialPrincipal && credencialPrincipal.status !== 'INATIVA');

    this.formState = {
      contabilidade_id: contabId,
      credenciaisEnabled: credencialAtiva,
      credencialId: credencialPrincipal?.id ?? null,
      credencialUsuario: credencialPrincipal?.usuario ?? this.limparCnpj(this.empresa.cnpj),
      credencialTipo: credencialPrincipal?.tipo ?? 'CNPJ_SENHA',
      credencialStatus: credencialPrincipal?.status ?? '',
      credencialSenha: '',
    };

    const { credencialSenha: _s, ...rest } = this.formState;
    this.initialSnapshot = { ...rest };

    this.formContabilidade.patchValue({
      contabilidade_id: contabId != null ? String(contabId) : '',
    });
    this.formCredencial.patchValue({
      usuario: this.formState.credencialUsuario,
      senha: '',
      tipo: this.formState.credencialTipo,
    });

    this.certificadoFile = null;
    this.modalSenhaAberta = false;
    this.modalSenha = '';
  }

  get isDirty(): boolean {
    if (!this.initialSnapshot) return false;

    const contabForm = this.formContabilidade.get('contabilidade_id')?.value ?? '';
    const contabVal = contabForm ? parseInt(contabForm, 10) : null;
    const contabChanged = contabVal !== this.initialSnapshot.contabilidade_id;

    const credEnabledChanged = this.formState.credenciaisEnabled !== this.initialSnapshot.credenciaisEnabled;

    const usuarioForm = this.formCredencial.get('usuario')?.value ?? '';
    const usuarioChanged = usuarioForm !== this.initialSnapshot.credencialUsuario;

    const senhaForm = this.formCredencial.get('senha')?.value ?? '';
    const senhaChanged = !!senhaForm.trim();

    return contabChanged || credEnabledChanged || usuarioChanged || senhaChanged;
  }

  get canSave(): boolean {
    if (!this.isDirty) return false;

    if (this.formState.credenciaisEnabled) {
      const usuario = (this.formCredencial.get('usuario')?.value ?? '').replace(/\D/g, '');
      const senha = (this.formCredencial.get('senha')?.value ?? '').trim();
      const tipo = this.formCredencial.get('tipo')?.value ?? 'CNPJ_SENHA';

      if (this.formState.credencialId == null) {
        const usuarioOk =
          tipo === 'CPF_SENHA' ? usuario.length === 11 : usuario.length === 14;
        return usuarioOk && senha.length >= 4;
      }
      const usuarioOk =
        tipo === 'CPF_SENHA' ? usuario.length === 11 : usuario.length === 14;
      return usuarioOk;
    }

    return true;
  }

  get credencialStatusLabel(): string {
    const s = this.formState.credencialStatus?.toUpperCase() ?? '';
    if (s === 'OK') return 'OK';
    if (s === 'INVALIDA' || s.includes('INVÁLID')) return 'Inválida';
    if (s === 'INATIVA') return 'Inativa';
    return 'Não testado';
  }

  get credencialStatusClass(): string {
    const s = this.formState.credencialStatus?.toUpperCase() ?? '';
    if (s === 'OK') return 'status-ok';
    if (s === 'INVALIDA' || s.includes('INVÁLID')) return 'status-invalida';
    if (s === 'INATIVA') return 'status-inativa';
    return 'status-nao-testado';
  }

  get certLabel(): string {
    if (this.empresa?.has_certificado && this.empresa.cert_validade) {
      const vencido = this.isCertVencido(this.empresa.cert_validade);
      return `Sim (validade ${this.empresa.cert_validade})`;
    }
    return 'Não';
  }

  get certVencido(): boolean {
    return !!(this.empresa?.has_certificado && this.empresa.cert_validade && this.isCertVencido(this.empresa.cert_validade));
  }

  private isCertVencido(val: string): boolean {
    try {
      const ddmmyy = val.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      let d: Date;
      if (ddmmyy) {
        d = new Date(parseInt(ddmmyy[3], 10), parseInt(ddmmyy[2], 10) - 1, parseInt(ddmmyy[1], 10));
      } else {
        d = new Date(val);
      }
      return d.getTime() < Date.now();
    } catch {
      return false;
    }
  }

  onContabilidadeChange(): void {
    const v = this.formContabilidade.get('contabilidade_id')?.value ?? '';
    this.formState.contabilidade_id = v ? parseInt(v, 10) : null;
  }

  onCredenciaisToggleChange(checked: boolean): void {
    this.formState.credenciaisEnabled = checked;
    if (!checked) {
      this.formState.credencialSenha = '';
      this.formCredencial.get('senha')?.setValue('');
    }
    this.dirtyChange.emit(this.isDirty);
  }

  onUsuarioChange(): void {
    this.formState.credencialUsuario = this.formCredencial.get('usuario')?.value ?? '';
  }

  acionarFileInput(fileInput: HTMLInputElement): void {
    fileInput.click();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files?.length) {
      this.certificadoFile = input.files[0];
      this.modalSenhaAberta = true;
      this.modalSenha = '';
    }
    input.value = '';
  }

  fecharModalSenha(): void {
    this.modalSenhaAberta = false;
    this.certificadoFile = null;
    this.modalSenha = '';
  }

  confirmarImportarCertificado(): void {
    if (!this.certificadoFile || !this.modalSenha.trim() || this.modalSenha.length < 4) return;

    const contabVal = this.formContabilidade.get('contabilidade_id')?.value ?? '';
    const contabilidadeId = contabVal ? parseInt(contabVal, 10) : 0;
    if (isNaN(contabilidadeId) || contabilidadeId < 1) return;

    this.certificadoEnviado.emit({
      file: this.certificadoFile,
      senha: this.modalSenha,
      contabilidade_id: contabilidadeId,
    });
    this.fecharModalSenha();
  }

  onRemoverCertificado(): void {
    if (!this.empresa?.cnpj) return;
    this.certificadoSolicitouRemocao.emit({ cnpj: this.empresa.cnpj });
  }

  fechar(): void {
    if (this.isDirty) {
      this.closeRequest.emit({ hasDirty: true });
    } else {
      this.closeDrawer.emit();
    }
  }

  cancelar(): void {
    this.buildSnapshotAndState();
    this.formContabilidade.patchValue({
      contabilidade_id: this.initialSnapshot?.contabilidade_id != null ? String(this.initialSnapshot.contabilidade_id) : '',
    });
    this.formCredencial.patchValue({
      usuario: this.initialSnapshot?.credencialUsuario ?? '',
      senha: '',
      tipo: this.initialSnapshot?.credencialTipo ?? 'CNPJ_SENHA',
    });
    this.formState = { ...this.initialSnapshot!, credencialSenha: '' };
    this.closeDrawer.emit();
  }

  salvar(): void {
    if (!this.canSave || !this.empresa) return;

    const payload: EditorSavePayload = {};
    const contabVal = this.formContabilidade.get('contabilidade_id')?.value ?? '';
    const contabId = contabVal ? parseInt(contabVal, 10) : null;
    if (contabId !== this.initialSnapshot?.contabilidade_id && contabId != null) {
      payload.contabilidade_id = contabId;
    }

    if (this.formState.credenciaisEnabled !== this.initialSnapshot?.credenciaisEnabled) {
      if (this.formState.credenciaisEnabled) {
        const usuario = (this.formCredencial.get('usuario')?.value ?? '').replace(/\D/g, '');
        const senha = (this.formCredencial.get('senha')?.value ?? '').trim();
        if (this.formState.credencialId != null) {
          const wasInativa = this.initialSnapshot?.credencialStatus?.toUpperCase() === 'INATIVA';
          payload.credenciais = wasInativa
            ? { action: 'REACTIVATE', credencialId: this.formState.credencialId, ...(senha.length >= 4 ? { senha } : {}) }
            : { action: 'UPDATE', credencialId: this.formState.credencialId, ...(senha.length >= 4 ? { senha } : {}) };
        } else {
          payload.credenciais = {
            action: 'CREATE',
            usuario,
            senha,
            tipo: this.formCredencial.get('tipo')?.value ?? 'CNPJ_SENHA',
          };
        }
      } else {
        if (this.formState.credencialId != null) {
          payload.credenciais = {
            action: 'MARK_INACTIVE',
            credencialId: this.formState.credencialId,
          };
        }
      }
    } else if (this.formState.credenciaisEnabled) {
      const senha = (this.formCredencial.get('senha')?.value ?? '').trim();
      const usuario = (this.formCredencial.get('usuario')?.value ?? '').replace(/\D/g, '');
      if (this.formState.credencialId != null && senha.length >= 4) {
        payload.credenciais = {
          action: 'UPDATE',
          credencialId: this.formState.credencialId,
          senha,
        };
      } else if (this.formState.credencialId == null && usuario && senha.length >= 4) {
        payload.credenciais = {
          action: 'CREATE',
          usuario,
          senha,
          tipo: this.formCredencial.get('tipo')?.value ?? 'CNPJ_SENHA',
        };
      } else if (usuario !== this.initialSnapshot?.credencialUsuario && this.formState.credencialId == null) {
        if (senha.length >= 4) {
          payload.credenciais = {
            action: 'CREATE',
            usuario,
            senha,
            tipo: this.formCredencial.get('tipo')?.value ?? 'CNPJ_SENHA',
          };
        }
      }
    }

    if (Object.keys(payload).length > 0) {
      this.save.emit(payload);
    }
  }

  limparCnpj(cnpj: string): string {
    return (cnpj || '').replace(/\D/g, '');
  }

  formatarCNPJ(cnpj: string): string {
    const l = this.limparCnpj(cnpj);
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
