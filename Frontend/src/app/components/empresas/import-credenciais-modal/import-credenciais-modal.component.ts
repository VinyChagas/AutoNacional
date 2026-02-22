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
import type {
  PreviewCredenciaisResponse,
  PreviewCredenciaisRow,
  ConfirmarCredenciaisResultItem,
} from '../../../models/empresas-unificado.model';

export type RowImportStatus =
  | 'PENDENTE'
  | 'IMPORTANDO'
  | 'OK'
  | 'ERRO'
  | 'JA_EXISTE'
  | 'INVALIDA';

export interface CredencialRow extends PreviewCredenciaisRow {
  selected: boolean;
  contabilidade_id: number | null;
  importStatus?: RowImportStatus;
  importMessage?: string;
  senhaRevelada?: boolean;
}

@Component({
  selector: 'app-import-credenciais-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './import-credenciais-modal.component.html',
  styleUrls: ['./import-credenciais-modal.component.scss'],
})
export class ImportCredenciaisModalComponent implements OnInit {
  @Input() isOpen = false;
  @Output() close = new EventEmitter<void>();
  @Output() concluido = new EventEmitter<void>();

  rows: CredencialRow[] = [];
  contabilidades: Array<{ id: number; nome_contabilidade: string }> = [];
  loadingContabilidades = false;
  loadingPreview = false;
  importing = false;
  concluindo = false;

  sessionId: string | null = null;
  contabilidadePadraoId: number | null = null;
  updateExisting = false;
  fileName = '';

  // Resumo após importação
  importacaoFinalizada = false;
  resumo = { importadas: 0, jaExistentes: 0, erros: 0 };

  private fileInput: HTMLInputElement | null = null;

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

  get validasCount(): number {
    return this.rows.filter((r) => r.valid).length;
  }

  get selectedValidasCount(): number {
    return this.rows.filter(
      (r) => r.valid && r.selected && this.temContabilidade(r)
    ).length;
  }

  get todasValidasSelecionaveis(): CredencialRow[] {
    return this.rows.filter((r) => this.podeSelecionar(r));
  }

  get isTodosValidasSelecionados(): boolean {
    const pode = this.todasValidasSelecionaveis;
    return pode.length > 0 && pode.every((r) => r.selected);
  }

  get isIndeterminadoValidas(): boolean {
    const pode = this.todasValidasSelecionaveis;
    return pode.some((r) => r.selected) && !this.isTodosValidasSelecionados;
  }

  podeSelecionar(row: CredencialRow): boolean {
    if (!row.valid) return false;
    if (row.exists && !this.updateExisting) return false;
    return true;
  }

  temContabilidade(row: CredencialRow): boolean {
    const cid = row.contabilidade_id ?? this.contabilidadePadraoId;
    return cid != null && cid > 0;
  }

  onContabilidadePadraoChange(): void {
    if (
      this.contabilidadePadraoId != null &&
      this.contabilidadePadraoId > 0
    ) {
      this.rows.forEach((r) => {
        if (r.valid && !r.contabilidade_id) {
          r.contabilidade_id = this.contabilidadePadraoId;
        }
      });
    }
    this.cdr.markForCheck();
  }

  acionarFileInput(input: HTMLInputElement): void {
    this.fileInput = input;
    input.value = '';
    input.click();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input?.files?.[0];
    if (!file) return;

    const ext = (file.name || '').toLowerCase();
    if (!ext.endsWith('.xlsx') && !ext.endsWith('.xls') && !ext.endsWith('.csv')) {
      this.toast.error('Arquivo deve ser .xlsx, .xls ou .csv');
      return;
    }

    this.fileName = file.name;
    this.loadingPreview = true;
    this.importacaoFinalizada = false;
    this.cdr.markForCheck();

    this.empresasService.previewCredenciais(file).subscribe({
      next: (r: PreviewCredenciaisResponse) => {
        this.sessionId = r.session_id ?? null;
        const rawRows = r.rows ?? [];
        this.rows = rawRows.map((row) => ({
          ...row,
          selected: row.valid && !row.exists,
          contabilidade_id: this.contabilidadePadraoId,
          importStatus: undefined,
          importMessage: undefined,
          senhaRevelada: false,
        }));
        this.loadingPreview = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.toast.error((err as Error)?.message || 'Erro ao processar planilha');
        this.loadingPreview = false;
        this.cdr.markForCheck();
      },
    });
    input.value = '';
  }

  reprocessarArquivo(): void {
    if (this.fileInput) {
      this.fileInput.click();
    }
  }

  toggleSelecionar(row: CredencialRow): void {
    if (!this.podeSelecionar(row)) return;
    row.selected = !row.selected;
    this.cdr.markForCheck();
  }

  selecionarTodasValidas(): void {
    const pode = this.todasValidasSelecionaveis;
    const todasJaSelecionadas = pode.every((r) => r.selected);
    pode.forEach((r) => {
      r.selected = !todasJaSelecionadas;
    });
    this.cdr.markForCheck();
  }

  toggleRevelarSenha(row: CredencialRow): void {
    row.senhaRevelada = !row.senhaRevelada;
    this.cdr.markForCheck();
  }

  getStatusRow(row: CredencialRow): string {
    if (row.importStatus) {
      const map: Record<RowImportStatus, string> = {
        PENDENTE: 'Pendente',
        IMPORTANDO: 'Importando...',
        OK: 'OK',
        ERRO: 'Erro',
        JA_EXISTE: 'Já existe',
        INVALIDA: 'Inválida',
      };
      return map[row.importStatus] ?? row.importStatus;
    }
    if (!row.valid) return 'Inválida';
    if (row.exists && !this.updateExisting) return 'Já existe';
    return 'Válida';
  }

  getStatusBadgeClass(row: CredencialRow): string {
    if (row.importStatus === 'OK') return 'badge-ok';
    if (row.importStatus === 'IMPORTANDO') return 'badge-importando';
    if (row.importStatus === 'ERRO' || row.importStatus === 'INVALIDA')
      return 'badge-erro';
    if (row.importStatus === 'JA_EXISTE') return 'badge-ja-existe';
    if (!row.valid) return 'badge-invalida';
    if (row.exists && !this.updateExisting) return 'badge-ja-existe';
    return 'badge-valida';
  }

  canImportar(): boolean {
    if (
      !this.sessionId ||
      !this.contabilidadePadraoId ||
      this.contabilidadePadraoId < 1
    )
      return false;
    return this.selectedValidasCount > 0 && !this.importing;
  }

  importarTodasValidas(): void {
    this.rows.forEach((r) => {
      if (this.podeSelecionar(r) && this.temContabilidade(r)) {
        r.selected = true;
      }
    });
    this.importarSelecionadas();
  }

  importarSelecionadas(): void {
    if (!this.canImportar()) return;

    const selecionadas = this.rows.filter(
      (r) => r.selected && r.valid && this.temContabilidade(r)
    );
    if (selecionadas.length === 0) {
      this.toast.error('Selecione ao menos uma linha válida');
      return;
    }

    this.importing = true;
    this.cdr.markForCheck();

    const rowsPayload = selecionadas.map((r) => ({
      rowIndex: r.rowIndex,
      contabilidade_id: r.contabilidade_id ?? this.contabilidadePadraoId!,
    }));

    this.empresasService
      .confirmarCredenciais({
        session_id: this.sessionId!,
        contabilidade_id_default: this.contabilidadePadraoId!,
        updateExisting: this.updateExisting,
        rows: rowsPayload,
      })
      .subscribe({
        next: (resp) => {
          const results = resp.results ?? [];
          const byIndex = new Map<number, ConfirmarCredenciaisResultItem>();
          results.forEach((item) => byIndex.set(item.rowIndex, item));

          this.rows.forEach((row) => {
            const res = byIndex.get(row.rowIndex);
            if (res) {
              if (res.status === 'IMPORTED')
                row.importStatus = 'OK';
              else if (res.status === 'UPDATED')
                row.importStatus = 'OK';
              else if (res.status === 'SKIPPED_EXISTS')
                row.importStatus = 'JA_EXISTE';
              else row.importStatus = 'ERRO';
              row.importMessage = res.message;
            }
          });

          this.resumo = {
            importadas: (resp.criadas ?? 0) + (resp.atualizadas ?? 0),
            jaExistentes: resp.skipped ?? 0,
            erros: resp.erros ?? 0,
          };
          this.importacaoFinalizada = true;
          this.importing = false;
          this.toast.success('Importação concluída');
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.toast.error(
            (err as Error)?.message || 'Erro ao importar credenciais'
          );
          this.importing = false;
          this.cdr.markForCheck();
        },
      });
  }

  onConcluir(): void {
    this.concluindo = true;
    this.concluido.emit();
  }

  fechar(): void {
    this.close.emit();
  }

  resetModal(): void {
    this.rows = [];
    this.sessionId = null;
    this.fileName = '';
    this.importacaoFinalizada = false;
  }
}
