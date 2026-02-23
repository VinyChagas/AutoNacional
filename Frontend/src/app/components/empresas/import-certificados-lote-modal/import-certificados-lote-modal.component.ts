import {
  Component,
  EventEmitter,
  Input,
  Output,
  ChangeDetectorRef,
  OnChanges,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EmpresasUnificadoService } from '../../../services/empresas-unificado.service';
import { ToastService } from '../../../services/toast.service';

export type ItemStatus =
  | 'PENDENTE'
  | 'VALIDO'
  | 'VENCIDO'
  | 'DUPLICADO'
  | 'ERRO'
  | 'IMPORTANDO'
  | 'IMPORTADO';

export interface CertificadoLoteItem {
  localId: string;
  file: File;
  filename: string;
  cnpj: string;
  razao_social: string;
  validade: string | null;
  isExpired: boolean;
  contabilidade_id: number | null;
  senha: string;
  status: ItemStatus;
  message?: string;
  validating?: boolean;
}

export type FiltroStatus = 'todos' | 'validos' | 'vencidos';

@Component({
  selector: 'app-import-certificados-lote-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './import-certificados-lote-modal.component.html',
  styleUrls: ['./import-certificados-lote-modal.component.scss'],
})
export class ImportCertificadosLoteModalComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() contabilidadeIdSelecionada: number | null = null;
  @Input() contabilidadeNomeSelecionada: string | null = null;
  @Output() close = new EventEmitter<void>();
  @Output() concluido = new EventEmitter<void>();

  items: CertificadoLoteItem[] = [];
  loadingPreview = false;
  filtroStatus: FiltroStatus = 'todos';
  ordenarValidosPrimeiro = true;
  busca = '';
  previewSenha = '';

  private nextId = 0;
  private fileInput: HTMLInputElement | null = null;

  constructor(
    private cdr: ChangeDetectorRef,
    private empresasService: EmpresasUnificadoService,
    private toast: ToastService
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && !changes['isOpen'].currentValue && changes['isOpen'].previousValue) {
      this.resetState();
    }
  }

  private resetState(): void {
    this.items = [];
    this.loadingPreview = false;
    this.filtroStatus = 'todos';
    this.ordenarValidosPrimeiro = true;
    this.busca = '';
    this.previewSenha = '';
    this.nextId = 0;
    this.fileInput = null;
  }

  get totalCount(): number {
    return this.items.length;
  }

  get validosCount(): number {
    return this.items.filter((i) => i.status === 'VALIDO').length;
  }

  get vencidosCount(): number {
    return this.items.filter((i) => i.status === 'VENCIDO').length;
  }

  get pendentesCount(): number {
    return this.items.filter(
      (i) =>
        i.status === 'PENDENTE' ||
        i.status === 'VALIDO' ||
        i.status === 'VENCIDO'
    ).length;
  }

  get itemsFiltradosOrdenados(): CertificadoLoteItem[] {
    let list = [...this.items];

    if (this.filtroStatus === 'validos') {
      list = list.filter((i) => i.status === 'VALIDO' || i.status === 'VENCIDO');
    } else if (this.filtroStatus === 'vencidos') {
      list = list.filter((i) => i.status === 'VENCIDO');
    }

    if (this.busca.trim()) {
      const q = this.busca.trim().toLowerCase();
      list = list.filter(
        (i) =>
          (i.cnpj && i.cnpj.toLowerCase().includes(q)) ||
          (i.razao_social && i.razao_social.toLowerCase().includes(q))
      );
    }

    if (this.ordenarValidosPrimeiro) {
      const order: Record<ItemStatus, number> = {
        VALIDO: 0,
        VENCIDO: 1,
        PENDENTE: 2,
        DUPLICADO: 3,
        ERRO: 4,
        IMPORTANDO: 5,
        IMPORTADO: 6,
      };
      list.sort((a, b) => (order[a.status] ?? 99) - (order[b.status] ?? 99));
    }

    return list;
  }

  canImportar(item: CertificadoLoteItem): boolean {
    if (
      item.status === 'DUPLICADO' ||
      item.status === 'ERRO' ||
      item.status === 'VENCIDO' ||
      item.status === 'IMPORTANDO' ||
      item.status === 'IMPORTADO'
    )
      return false;
    if (item.status !== 'VALIDO' && item.status !== 'PENDENTE') return false;
    if (!item.contabilidade_id || item.contabilidade_id < 1) return false;
    const senha = (item.senha || this.previewSenha || '').trim();
    return senha.length >= 3;
  }

  aplicarSenhaParaTodos(): void {
    const senhaBase = this.previewSenha.trim();
    if (!senhaBase) {
      this.toast.error('Preencha a senha padrão antes de aplicar para todos.');
      return;
    }
    this.items = this.items.map((item) => ({
      ...item,
      senha: senhaBase,
    }));
    this.toast.success('Senha aplicada para todos os certificados.');
    this.cdr.markForCheck();
  }

  acionarFileInput(input: HTMLInputElement): void {
    this.fileInput = input;
    input.value = '';
    input.click();
  }

  onFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = input?.files;
    if (!files?.length) return;

    const novos: CertificadoLoteItem[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (!f.name?.toLowerCase().match(/\.(pfx|p12)$/)) continue;
      novos.push({
        localId: `cert-${++this.nextId}`,
        file: f,
        filename: f.name,
        cnpj: '',
        razao_social: '',
        validade: null,
        isExpired: false,
        contabilidade_id: this.contabilidadeIdSelecionada,
        senha: this.previewSenha || '',
        status: 'PENDENTE',
      });
    }
    this.items = [...this.items, ...novos];
    this.cdr.markForCheck();
    input.value = '';
  }

  onPreview(): void {
    const senha = this.previewSenha.trim();
    if (!senha || senha.length < 3 || this.items.length === 0) return;

    const pendentes = this.items.filter((i) => i.status === 'PENDENTE');
    if (pendentes.length === 0) return;

    this.loadingPreview = true;
    this.cdr.markForCheck();

    const files = pendentes.map((i) => i.file);
    this.empresasService.previewCertificados(files, senha).subscribe({
      next: (r) => {
        const sessionItems = r.items ?? [];
        const byIndice = new Map<number, (typeof sessionItems)[0]>();
        sessionItems.forEach((s) => byIndice.set(s.indice, s));

        this.items = this.items.map((item) => {
          const wasPendente = item.status === 'PENDENTE';
          if (!wasPendente) return item;

          const pendenteIdx = pendentes.indexOf(item);
          if (pendenteIdx < 0) return item;

          const si = byIndice.get(pendenteIdx);
          if (!si) return item;

          const validade = si.data_validade ?? null;
          const isExpired = this.isValidadeVencida(validade);
          let status: ItemStatus = 'VALIDO';
          if (si.acao === 'DUPLICADO') status = 'DUPLICADO';
          else if (si.acao === 'ERRO') status = 'ERRO';
          else if (isExpired) status = 'VENCIDO';
          else status = 'VALIDO';

          return {
            ...item,
            cnpj: si.cnpj ?? '',
            razao_social: si.razao_social ?? '',
            validade,
            isExpired,
            senha: senha,
            status,
            message: si.erro,
          };
        });
        this.previewSenha = senha;
        this.loadingPreview = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.toast.error((err as Error)?.message || 'Erro ao pré-visualizar');
        this.loadingPreview = false;
        this.cdr.markForCheck();
      },
    });
  }

  private isValidadeVencida(val: string | null): boolean {
    if (!val) return false;
    try {
      const ddmmyy = val.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      let d: Date;
      if (ddmmyy) {
        d = new Date(
          parseInt(ddmmyy[3], 10),
          parseInt(ddmmyy[2], 10) - 1,
          parseInt(ddmmyy[1], 10)
        );
      } else {
        d = new Date(val);
      }
      return d.getTime() < Date.now();
    } catch {
      return false;
    }
  }

  onImportar(item: CertificadoLoteItem): void {
    if (!this.canImportar(item)) return;

    const senha = (item.senha || this.previewSenha || '').trim();
    if (!item.contabilidade_id || senha.length < 3) return;

    item.status = 'IMPORTANDO';
    item.message = undefined;
    this.cdr.markForCheck();

    this.empresasService
      .cadastroCertificado(item.file, senha, item.contabilidade_id)
      .subscribe({
        next: () => {
          item.status = 'IMPORTADO';
          this.cdr.markForCheck();
          setTimeout(() => {
            this.items = this.items.filter((i) => i.localId !== item.localId);
            this.cdr.markForCheck();
          }, 300);
          this.toast.success(`Certificado ${item.filename} importado com sucesso`);
        },
        error: (err) => {
          item.status = item.isExpired ? 'VENCIDO' : 'VALIDO';
          if (item.status === 'VALIDO' && item.isExpired) item.status = 'VENCIDO';
          item.message = (err as Error)?.message || 'Erro ao importar';
          this.cdr.markForCheck();
        },
      });
  }

  onConcluir(): void {
    if (this.pendentesCount > 0) {
      if (
        !confirm(
          `Existem ${this.pendentesCount} certificado(s) pendente(s). Deseja sair mesmo assim?`
        )
      ) {
        return;
      }
    }
    this.resetState();
    this.concluido.emit();
  }

  fechar(): void {
    this.resetState();
    this.close.emit();
  }

  formatarCNPJ(cnpj: string): string {
    const l = (cnpj || '').replace(/\D/g, '');
    if (l.length === 14)
      return l.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
    return cnpj || '-';
  }

  getStatusBadgeClass(status: ItemStatus): string {
    switch (status) {
      case 'VALIDO':
        return 'badge-valido';
      case 'VENCIDO':
        return 'badge-vencido';
      case 'DUPLICADO':
        return 'badge-duplicado';
      case 'ERRO':
        return 'badge-erro';
      case 'IMPORTANDO':
        return 'badge-importando';
      case 'IMPORTADO':
        return 'badge-importado';
      default:
        return 'badge-pendente';
    }
  }

  getStatusLabel(status: ItemStatus): string {
    const map: Record<ItemStatus, string> = {
      PENDENTE: 'Pendente',
      VALIDO: 'Válido',
      VENCIDO: 'Vencido',
      DUPLICADO: 'Duplicado',
      ERRO: 'Erro',
      IMPORTANDO: 'Importando...',
      IMPORTADO: 'Importado',
    };
    return map[status] ?? status;
  }
}
