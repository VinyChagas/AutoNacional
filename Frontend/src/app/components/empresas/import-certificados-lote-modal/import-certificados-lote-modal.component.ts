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
import type {
  ConfirmCertAction,
  PreviewCertAction,
  PreviewCertificadosItem,
} from '../../../models/empresas-unificado.model';

export type ItemStatus =
  | 'PENDENTE'
  | 'NOVO'
  | 'ATUALIZAR'
  | 'DUPLICADO'
  | 'ANTIGO'
  | 'VENCIDO'
  | 'ERRO'
  | 'IMPORTANDO'
  | 'IMPORTADO'
  | 'IGNORADO';

export interface CertificadoLoteItem {
  localId: string;
  file: File;
  filename: string;
  cnpj: string;
  razao_social: string;
  validade: string | null;
  existingValidade: string | null;
  isExpired: boolean;
  contabilidade_id: number | null;
  senha: string;
  status: ItemStatus;
  message?: string;
  validating?: boolean;
  sessionId?: string;
  sessionIndice?: number;
  previewAction?: PreviewCertAction;
  canConfirm?: boolean;
  daysDelta?: number | null;
}

export type FiltroStatus = 'todos' | 'elegiveis' | 'bloqueados';

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
  importingBatch = false;
  filtroStatus: FiltroStatus = 'todos';
  ordenarElegiveisPrimeiro = true;
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
    this.importingBatch = false;
    this.filtroStatus = 'todos';
    this.ordenarElegiveisPrimeiro = true;
    this.busca = '';
    this.previewSenha = '';
    this.nextId = 0;
    this.fileInput = null;
  }

  get totalCount(): number {
    return this.items.length;
  }

  get elegiveisCount(): number {
    return this.items.filter((i) => i.status === 'NOVO' || i.status === 'ATUALIZAR').length;
  }

  get bloqueadosCount(): number {
    return this.items.filter((i) =>
      ['DUPLICADO', 'ANTIGO', 'VENCIDO', 'ERRO'].includes(i.status)
    ).length;
  }

  get pendentesCount(): number {
    return this.items.filter((i) =>
      ['PENDENTE', 'NOVO', 'ATUALIZAR', 'VENCIDO', 'ANTIGO', 'DUPLICADO'].includes(i.status)
    ).length;
  }

  get itemsFiltradosOrdenados(): CertificadoLoteItem[] {
    let list = [...this.items];

    if (this.filtroStatus === 'elegiveis') {
      list = list.filter((i) => i.status === 'NOVO' || i.status === 'ATUALIZAR');
    } else if (this.filtroStatus === 'bloqueados') {
      list = list.filter((i) =>
        ['DUPLICADO', 'ANTIGO', 'VENCIDO', 'ERRO'].includes(i.status)
      );
    }

    if (this.busca.trim()) {
      const q = this.busca.trim().toLowerCase();
      list = list.filter(
        (i) =>
          (i.cnpj && i.cnpj.toLowerCase().includes(q)) ||
          (i.razao_social && i.razao_social.toLowerCase().includes(q)) ||
          (i.filename && i.filename.toLowerCase().includes(q))
      );
    }

    if (this.ordenarElegiveisPrimeiro) {
      const order: Record<ItemStatus, number> = {
        NOVO: 0,
        ATUALIZAR: 1,
        PENDENTE: 2,
        ANTIGO: 3,
        DUPLICADO: 4,
        VENCIDO: 5,
        ERRO: 6,
        IMPORTANDO: 7,
        IMPORTADO: 8,
        IGNORADO: 9,
      };
      list.sort((a, b) => (order[a.status] ?? 99) - (order[b.status] ?? 99));
    }

    return list;
  }

  canCadastrar(item: CertificadoLoteItem): boolean {
    return (
      item.status === 'NOVO' &&
      !!item.canConfirm &&
      !!item.sessionId &&
      item.sessionIndice != null &&
      !!item.contabilidade_id &&
      item.contabilidade_id > 0 &&
      (item.senha || this.previewSenha || '').trim().length >= 3
    );
  }

  canAtualizar(item: CertificadoLoteItem): boolean {
    return (
      item.status === 'ATUALIZAR' &&
      !!item.canConfirm &&
      !!item.sessionId &&
      item.sessionIndice != null &&
      !!item.contabilidade_id &&
      item.contabilidade_id > 0 &&
      (item.senha || this.previewSenha || '').trim().length >= 3
    );
  }

  canIgnorar(item: CertificadoLoteItem): boolean {
    return !['IMPORTANDO', 'IMPORTADO', 'IGNORADO', 'PENDENTE'].includes(item.status);
  }

  get canImportarElegiveis(): boolean {
    return (
      !this.importingBatch &&
      this.items.some((i) => this.canCadastrar(i) || this.canAtualizar(i))
    );
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
        existingValidade: null,
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
        const byIndice = new Map<number, PreviewCertificadosItem>();
        sessionItems.forEach((s) => byIndice.set(s.indice, s));

        this.items = this.items.map((item) => {
          if (item.status !== 'PENDENTE') return item;
          const pendenteIdx = pendentes.indexOf(item);
          if (pendenteIdx < 0) return item;
          const si = byIndice.get(pendenteIdx);
          if (!si) return item;
          return this.applyPreviewToItem(item, si, r.session_id, senha);
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

  private applyPreviewToItem(
    item: CertificadoLoteItem,
    si: PreviewCertificadosItem,
    sessionId: string,
    senha: string
  ): CertificadoLoteItem {
    const action = si.action ?? this.legacyToAction(si.acao);
    const status = this.statusFromAction(action);
    const validade = si.data_validade ?? null;
    return {
      ...item,
      cnpj: si.cnpj ?? '',
      razao_social: si.razao_social ?? '',
      validade,
      existingValidade: si.existing_valid_until ?? null,
      isExpired: action === 'EXPIRED_CERTIFICATE',
      senha,
      status,
      message: si.message || si.erro,
      sessionId,
      sessionIndice: si.indice,
      previewAction: action,
      canConfirm: si.can_confirm ?? (status === 'NOVO' || status === 'ATUALIZAR'),
      daysDelta: si.days_delta,
    };
  }

  private legacyToAction(
    acao: PreviewCertificadosItem['acao']
  ): PreviewCertAction {
    switch (acao) {
      case 'IMPORTAR':
        return 'NEW';
      case 'UPDATE_AVAILABLE':
        return 'UPDATE_AVAILABLE';
      case 'DUPLICADO':
        return 'EXACT_DUPLICATE';
      case 'OLDER_CERTIFICATE':
        return 'OLDER_CERTIFICATE';
      case 'EXPIRED_CERTIFICATE':
        return 'EXPIRED_CERTIFICATE';
      case 'ERRO':
      default:
        return 'ERROR';
    }
  }

  private statusFromAction(action: PreviewCertAction): ItemStatus {
    switch (action) {
      case 'NEW':
        return 'NOVO';
      case 'UPDATE_AVAILABLE':
        return 'ATUALIZAR';
      case 'EXACT_DUPLICATE':
        return 'DUPLICADO';
      case 'OLDER_CERTIFICATE':
        return 'ANTIGO';
      case 'EXPIRED_CERTIFICATE':
        return 'VENCIDO';
      default:
        return 'ERRO';
    }
  }

  canRetentar(item: CertificadoLoteItem): boolean {
    return item.status === 'ERRO' && (item.senha || '').trim().length >= 3;
  }

  onRetentar(item: CertificadoLoteItem): void {
    if (item.status !== 'ERRO' || !this.canRetentar(item)) return;

    const senha = (item.senha || '').trim();
    item.validating = true;
    item.message = undefined;
    this.cdr.markForCheck();

    this.empresasService.previewCertificados([item.file], senha).subscribe({
      next: (r) => {
        const si = r.items?.[0];
        if (!si) {
          item.validating = false;
          item.message = 'Resposta inválida do servidor';
          this.cdr.markForCheck();
          return;
        }
        Object.assign(item, this.applyPreviewToItem(item, si, r.session_id, senha), {
          validating: false,
        });
        this.cdr.markForCheck();
        if (item.status !== 'ERRO') {
          this.toast.success(`Certificado ${item.filename} validado com sucesso`);
        }
      },
      error: (err) => {
        item.validating = false;
        item.message = (err as Error)?.message || 'Erro ao validar';
        this.cdr.markForCheck();
      },
    });
  }

  onCadastrar(item: CertificadoLoteItem): void {
    if (!this.canCadastrar(item)) return;
    this.confirmarItem(item, 'CREATE');
  }

  onAtualizar(item: CertificadoLoteItem): void {
    if (!this.canAtualizar(item)) return;
    const msg =
      item.daysDelta != null && item.daysDelta > 0
        ? `Substituir o certificado atual (validade ${item.existingValidade || '?'}) pelo novo (validade ${item.validade || '?'}, +${item.daysDelta} dia(s))?`
        : `Substituir o certificado existente deste CNPJ pelo arquivo ${item.filename}?`;
    if (!confirm(msg)) return;
    this.confirmarItem(item, 'REPLACE_EXISTING');
  }

  onIgnorar(item: CertificadoLoteItem): void {
    if (!this.canIgnorar(item)) return;
    item.status = 'IGNORADO';
    item.message = 'Ignorado pelo usuário';
    this.cdr.markForCheck();
  }

  private confirmarItem(item: CertificadoLoteItem, action: ConfirmCertAction): void {
    const senha = (item.senha || this.previewSenha || '').trim();
    if (!item.sessionId || item.sessionIndice == null || !item.contabilidade_id) return;

    item.status = 'IMPORTANDO';
    item.message = undefined;
    this.cdr.markForCheck();

    this.empresasService
      .confirmarCertificados({
        session_id: item.sessionId,
        senha,
        itens: [{ indice: item.sessionIndice, action }],
        contabilidade_id: item.contabilidade_id,
      })
      .subscribe({
        next: (r) => {
          const err = r.erros?.find((e) => e.indice === item.sessionIndice);
          if (err) {
            item.status = action === 'REPLACE_EXISTING' ? 'ATUALIZAR' : 'NOVO';
            item.message = err.mensagem;
            this.cdr.markForCheck();
            return;
          }
          item.status = 'IMPORTADO';
          this.cdr.markForCheck();
          setTimeout(() => {
            this.items = this.items.filter((i) => i.localId !== item.localId);
            this.cdr.markForCheck();
          }, 300);
          this.toast.success(
            action === 'REPLACE_EXISTING'
              ? `Certificado ${item.filename} atualizado`
              : `Certificado ${item.filename} cadastrado`
          );
        },
        error: (err) => {
          item.status = action === 'REPLACE_EXISTING' ? 'ATUALIZAR' : 'NOVO';
          item.message = (err as Error)?.message || 'Erro ao confirmar';
          this.cdr.markForCheck();
        },
      });
  }

  onImportarElegiveis(): void {
    const elegiveis = this.items.filter(
      (i) => this.canCadastrar(i) || this.canAtualizar(i)
    );
    if (elegiveis.length === 0) return;

    const atualizar = elegiveis.filter((i) => i.status === 'ATUALIZAR');
    if (atualizar.length > 0) {
      if (
        !confirm(
          `${atualizar.length} certificado(s) vão SUBSTITUIR o atual. ${elegiveis.length - atualizar.length} serão cadastrados como novos. Continuar?`
        )
      ) {
        return;
      }
    }

    // Agrupa por sessionId (preview em lote compartilha; retentativas podem diferir)
    const bySession = new Map<string, CertificadoLoteItem[]>();
    for (const item of elegiveis) {
      if (!item.sessionId) continue;
      const list = bySession.get(item.sessionId) ?? [];
      list.push(item);
      bySession.set(item.sessionId, list);
    }

    const actionByLocalId = new Map<string, ConfirmCertAction>();
    for (const item of elegiveis) {
      actionByLocalId.set(
        item.localId,
        item.previewAction === 'UPDATE_AVAILABLE' ? 'REPLACE_EXISTING' : 'CREATE'
      );
    }

    this.importingBatch = true;
    elegiveis.forEach((i) => {
      i.status = 'IMPORTANDO';
      i.message = undefined;
    });
    this.cdr.markForCheck();

    let pending = bySession.size;
    let totalOk = 0;
    let totalErr = 0;

    const doneOne = () => {
      pending--;
      if (pending > 0) return;
      this.importingBatch = false;
      this.items = this.items.filter((i) => i.status !== 'IMPORTADO');
      this.cdr.markForCheck();
      if (totalErr === 0) {
        this.toast.success(`${totalOk} certificado(s) processado(s) com sucesso`);
      } else {
        this.toast.error(
          `${totalOk} ok, ${totalErr} com erro. Verifique as mensagens na lista.`
        );
      }
    };

    if (pending === 0) {
      this.importingBatch = false;
      return;
    }

    for (const [sessionId, group] of bySession) {
      const senha = (group[0].senha || this.previewSenha || '').trim();
      const contab = group[0].contabilidade_id!;
      this.empresasService
        .confirmarCertificados({
          session_id: sessionId,
          senha,
          contabilidade_id: contab,
          itens: group.map((item) => ({
            indice: item.sessionIndice!,
            action: actionByLocalId.get(item.localId) ?? 'CREATE',
          })),
        })
        .subscribe({
          next: (r) => {
            const errMap = new Map((r.erros ?? []).map((e) => [e.indice, e.mensagem]));
            for (const item of group) {
              const errMsg = errMap.get(item.sessionIndice!);
              if (errMsg) {
                totalErr++;
                item.status =
                  actionByLocalId.get(item.localId) === 'REPLACE_EXISTING'
                    ? 'ATUALIZAR'
                    : 'NOVO';
                item.message = errMsg;
              } else {
                totalOk++;
                item.status = 'IMPORTADO';
              }
            }
            doneOne();
            this.cdr.markForCheck();
          },
          error: (err) => {
            const msg = (err as Error)?.message || 'Erro ao confirmar lote';
            for (const item of group) {
              totalErr++;
              item.status =
                actionByLocalId.get(item.localId) === 'REPLACE_EXISTING'
                  ? 'ATUALIZAR'
                  : 'NOVO';
              item.message = msg;
            }
            doneOne();
            this.cdr.markForCheck();
          },
        });
    }
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
      case 'NOVO':
        return 'badge-valido';
      case 'ATUALIZAR':
        return 'badge-atualizar';
      case 'VENCIDO':
        return 'badge-vencido';
      case 'DUPLICADO':
        return 'badge-duplicado';
      case 'ANTIGO':
        return 'badge-antigo';
      case 'ERRO':
        return 'badge-erro';
      case 'IMPORTANDO':
        return 'badge-importando';
      case 'IMPORTADO':
        return 'badge-importado';
      case 'IGNORADO':
        return 'badge-ignorado';
      default:
        return 'badge-pendente';
    }
  }

  getStatusLabel(status: ItemStatus): string {
    const map: Record<ItemStatus, string> = {
      PENDENTE: 'Pendente',
      NOVO: 'Novo',
      ATUALIZAR: 'Atualizar',
      DUPLICADO: 'Duplicado',
      ANTIGO: 'Mais antigo',
      VENCIDO: 'Vencido',
      ERRO: 'Erro',
      IMPORTANDO: 'Processando...',
      IMPORTADO: 'Concluído',
      IGNORADO: 'Ignorado',
    };
    return map[status] ?? status;
  }
}
