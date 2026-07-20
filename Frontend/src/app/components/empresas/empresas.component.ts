import {
  Component,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Subject, of } from 'rxjs';
import { catchError, finalize, switchMap, takeUntil } from 'rxjs/operators';
import { ContabilidadeService } from '../../services/contabilidade.service';
import { EmpresasUnificadoService } from '../../services/empresas-unificado.service';
import { CredenciaisService } from '../../services/credenciais.service';
import { ToastService } from '../../services/toast.service';
import type { Contabilidade } from '../../models/contabilidade.model';
import type {
  EmpresaListagemItem,
  EmpresaDetalhes,
  EmpresasSummaryResponse,
} from '../../models/empresas-unificado.model';
import { toEmpresaRow } from '../../models/empresas-unificado.model';
import {
  displayStatusGeral,
  displayStatusReason,
  getCertDisplayInfo as getCertDisplayInfoUtil,
} from './status.utils';
import { EmpresaDrawerComponent, type EditorSavePayload } from './empresa-drawer/empresa-drawer.component';
import { EmpresasCadastroComponent } from './empresas-cadastro/empresas-cadastro.component';
import { ImportCertificadosLoteModalComponent } from './import-certificados-lote-modal/import-certificados-lote-modal.component';
import { ImportCredenciaisModalComponent } from './import-credenciais-modal/import-credenciais-modal.component';
import {
  EmpresasSummaryCardsComponent,
  type EmpresasFilterPreset,
} from './empresas-summary-cards/empresas-summary-cards.component';
import { EmpresasValidacaoModalComponent } from './empresas-validacao-modal/empresas-validacao-modal.component';

/** Chip de filtro */
export interface ChipFilter {
  id: string;
  label: string;
}

/** Segmento enviado à API ao clicar nos cards. */
export type EmpresaListSegment =
  | 'ALL'
  | 'CERT_EXPIRED'
  | 'CREDENTIAL_REVALIDATION_REQUIRED'
  | 'OPERATIONAL'
  | 'NOT_ELIGIBLE';

function presetToSegment(
  preset: EmpresasFilterPreset | null
): EmpresaListSegment {
  if (!preset || preset.type === 'ALL') return 'ALL';
  switch (preset.type) {
    case 'CERT_VENCIDO':
      return 'CERT_EXPIRED';
    case 'CRED_VALIDAR':
      return 'CREDENTIAL_REVALIDATION_REQUIRED';
    case 'OPERACIONAIS':
      return 'OPERATIONAL';
    default:
      return 'ALL';
  }
}

@Component({
  selector: 'app-empresas',
  standalone: true,
  imports: [
    FormsModule,
    CommonModule,
    RouterModule,
    EmpresaDrawerComponent,
    EmpresasCadastroComponent,
    ImportCertificadosLoteModalComponent,
    ImportCredenciaisModalComponent,
    EmpresasSummaryCardsComponent,
    EmpresasValidacaoModalComponent,
  ],
  templateUrl: './empresas.component.html',
  styleUrls: ['./empresas.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmpresasComponent implements OnInit, OnDestroy {
  title = 'Empresas';
  subtitle = 'Cadastro unificado de empresas, certificados e credenciais';

  /** Preset de filtro ativo (clique nos cards) — enviado como segment à API. */
  presetActive: EmpresasFilterPreset | null = null;

  search = '';
  empresasCount = 0;
  sortLabel = 'padrão';
  sortOpen = false;

  // Paginação
  page = 1;
  pageSize = 20;
  pageSizeOptions = [20, 50, 100];
  totalCount = 0;

  // Summary (cards)
  summary: EmpresasSummaryResponse = {
    total_empresas: 0,
    certificados_vencidos: 0,
    credenciais_para_validar: 0,
    operacionais: 0,
  };
  loadingSummary = false;

  contabilidades: Contabilidade[] = [];
  contabilidadeId: number | null = null;
  contabDropdownOpen = false;
  loadingContabilidades = false;

  chipsDisponiveis: ChipFilter[] = [
    { id: 'com_cert', label: 'Com certificado' },
    { id: 'com_cred', label: 'Com credenciais' },
    { id: 'cert_vencido', label: 'Cert. vencido' },
    { id: 'sem_cert', label: 'Sem certificado' },
    { id: 'sem_cred', label: 'Sem credenciais' },
    { id: 'sem_metodo', label: 'Sem método' },
  ];
  chipsAtivos = new Set<string>([]);

  listaEmpresas: EmpresaListagemItem[] = [];
  selectedIds = new Set<string>();
  carregando = false;
  erro: string | null = null;

  // Linha expandida (edição)
  empresaSelecionada: EmpresaListagemItem | null = null;
  empresaDetalhes: EmpresaDetalhes | null = null;
  carregandoDetalhes = false;
  salvandoCertificado = false;
  salvandoGeral = false;
  removendoCertificado = false;

  // Modal de exclusão
  excluirConfirmando: EmpresaListagemItem | null = null;
  excluindo = false;

  // Modal confirmar remover certificado
  removerCertificadoConfirmando: { cnpj: string; razaoSocial?: string } | null = null;

  // Editor dirty (alterações não salvas)
  editorDirty = false;

  private readonly destroy$ = new Subject<void>();
  private readonly listTrigger$ = new Subject<void>();
  private readonly summaryTrigger$ = new Subject<void>();
  private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private cdr: ChangeDetectorRef,
    private contabilidadeService: ContabilidadeService,
    private empresasService: EmpresasUnificadoService,
    private credenciaisService: CredenciaisService,
    private toast: ToastService
  ) {}

  ngOnInit(): void {
    this.listTrigger$
      .pipe(
        switchMap(() => {
          this.carregando = true;
          this.erro = null;
          this.cdr.markForCheck();
          return this.empresasService.listar(this.buildListParams()).pipe(
            catchError((err: unknown) => {
              this.erro =
                err instanceof Error
                  ? err.message
                  : 'Erro ao carregar empresas';
              this.listaEmpresas = [];
              this.totalCount = 0;
              this.empresasCount = 0;
              return of(null);
            }),
            finalize(() => {
              this.carregando = false;
              this.cdr.markForCheck();
            })
          );
        }),
        takeUntil(this.destroy$)
      )
      .subscribe((r) => {
        if (!r) {
          this.cdr.markForCheck();
          return;
        }
        this.listaEmpresas = r.items ?? [];
        this.totalCount = r.total ?? 0;
        this.empresasCount = r.total ?? 0;
        if (this.empresaSelecionada) {
          const updated = this.listaEmpresas.find(
            (e) => e.id === this.empresaSelecionada?.id
          );
          if (updated) this.empresaSelecionada = updated;
        }
        this.cdr.markForCheck();
      });

    this.summaryTrigger$
      .pipe(
        switchMap(() => {
          this.loadingSummary = true;
          this.cdr.markForCheck();
          return this.empresasService.getSummary(this.buildSummaryParams()).pipe(
            catchError(() => of(null)),
            finalize(() => {
              this.loadingSummary = false;
              this.cdr.markForCheck();
            })
          );
        }),
        takeUntil(this.destroy$)
      )
      .subscribe((s) => {
        if (s) this.summary = s;
        this.cdr.markForCheck();
      });

    this.carregarContabilidades();
    this.carregarEmpresas();
    this.carregarSummary();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.listTrigger$.complete();
    this.summaryTrigger$.complete();
    if (this.searchDebounceTimer) clearTimeout(this.searchDebounceTimer);
  }

  private buildListParams(): {
    search?: string;
    contabilidade_id?: number | null;
    has_cert?: boolean;
    has_cred?: boolean;
    sem_cert?: boolean;
    sem_cred?: boolean;
    sem_metodo?: boolean;
    segment?: EmpresaListSegment;
    sort?: string;
    order?: 'asc' | 'desc';
    page?: number;
    limit?: number;
  } {
    const params: {
      search?: string;
      contabilidade_id?: number | null;
      has_cert?: boolean;
      has_cred?: boolean;
      sem_cert?: boolean;
      sem_cred?: boolean;
      sem_metodo?: boolean;
      segment?: EmpresaListSegment;
      sort?: string;
      order?: 'asc' | 'desc';
      page?: number;
      limit?: number;
    } = {
      page: this.page,
      limit: this.pageSize,
      segment: presetToSegment(this.presetActive),
    };

    if (this.search.trim()) {
      params.search = this.search.trim();
    }
    if (this.contabilidadeId != null && this.contabilidadeId > 0) {
      params.contabilidade_id = this.contabilidadeId;
    }

    if (this.chipsAtivos.has('com_cert')) params.has_cert = true;
    if (this.chipsAtivos.has('com_cred')) params.has_cred = true;
    if (this.chipsAtivos.has('sem_cert')) params.sem_cert = true;
    if (this.chipsAtivos.has('sem_cred')) params.sem_cred = true;
    if (this.chipsAtivos.has('sem_metodo')) params.sem_metodo = true;

    if (this.sortLabel !== 'padrão') {
      const sortMap: Record<string, string> = {
        CNPJ: 'cnpj',
        'Razão Social': 'razao_social',
        Contabilidade: 'contabilidade_nome',
        Certificado: 'cert_validade',
        Status: 'status_geral',
      };
      params.sort = sortMap[this.sortLabel] ?? 'razao_social';
      params.order = 'asc';
    }

    return params;
  }

  private buildSummaryParams(): {
    contabilidade_id?: number | null;
    search?: string;
    has_cert?: boolean;
    has_cred?: boolean;
    sem_cert?: boolean;
    sem_cred?: boolean;
    sem_metodo?: boolean;
  } {
    const params: {
      contabilidade_id?: number | null;
      search?: string;
      has_cert?: boolean;
      has_cred?: boolean;
      sem_cert?: boolean;
      sem_cred?: boolean;
      sem_metodo?: boolean;
    } = {};

    if (this.contabilidadeId != null && this.contabilidadeId > 0) {
      params.contabilidade_id = this.contabilidadeId;
    }
    if (this.search.trim()) {
      params.search = this.search.trim();
    }
    if (this.chipsAtivos.has('com_cert')) params.has_cert = true;
    if (this.chipsAtivos.has('com_cred')) params.has_cred = true;
    if (this.chipsAtivos.has('sem_cert')) params.sem_cert = true;
    if (this.chipsAtivos.has('sem_cred')) params.sem_cred = true;
    if (this.chipsAtivos.has('sem_metodo')) params.sem_metodo = true;

    return params;
  }

  carregarContabilidades(): void {
    this.loadingContabilidades = true;
    this.cdr.markForCheck();
    this.contabilidadeService.listar().subscribe({
      next: (r) => {
        this.contabilidades = r.contabilidades ?? [];
        this.loadingContabilidades = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.loadingContabilidades = false;
        this.cdr.markForCheck();
      },
    });
  }

  carregarEmpresas(): void {
    this.listTrigger$.next();
  }

  carregarSummary(): void {
    this.summaryTrigger$.next();
  }

  /** Rows para os cards (conversão da lista). */
  get rowsForCards() {
    return this.listaEmpresas.map(toEmpresaRow);
  }

  onFilterPresetRequested(preset: EmpresasFilterPreset): void {
    this.presetActive =
      this.presetActive?.type === preset.type ? null : preset;
    this.page = 1;
    this.carregarEmpresas();
    this.cdr.markForCheck();
  }

  /** Retorna info de exibição do certificado (validade + dias restantes/vencidos) */
  getCertDisplayInfo(item: EmpresaListagemItem) {
    const info = getCertDisplayInfoUtil(item);
    return info
      ? {
          label: info.label,
          diasText: info.diasText,
          vencido: info.vencido,
          certStatus: info.certStatus,
        }
      : null;
  }

  getStatusGeral(item: EmpresaListagemItem) {
    return displayStatusGeral(item);
  }

  getStatusReason(item: EmpresaListagemItem) {
    return displayStatusReason(item);
  }

  /** Status e motivo vindos da API (sem recálculo local). */
  getStatusInfo(item: EmpresaListagemItem): { status: string; reason: string } {
    return {
      status: displayStatusGeral(item),
      reason: displayStatusReason(item),
    };
  }

  /** Exibição de credenciais (status + mensagem para INVALIDA). */
  getCredDisplay(item: EmpresaListagemItem): { status: string; mensagem?: string } | null {
    if (!item.has_credenciais) return null;
    const row = toEmpresaRow(item);
    const status = row.cred_status ?? 'NAO_TESTADO';
    return {
      status,
      mensagem: row.cred_ultima_mensagem ?? undefined,
    };
  }

  /** Contagem exibida: total retornado pela API (já com segment + filtros). */
  get displayedCount(): number {
    return this.empresasCount;
  }

  getContabilidadeLabel(): string {
    if (!this.contabilidadeId) return 'Todas as contabilidades';
    const c = this.contabilidades.find((x) => x.id === this.contabilidadeId);
    return c?.nome_contabilidade ?? 'Todas as contabilidades';
  }

  onContabilidadeSelect(id: number | null): void {
    this.contabilidadeId = id;
    this.contabDropdownOpen = false;
    this.page = 1;
    this.carregarEmpresas();
    this.carregarSummary();
  }

  // Paginação
  get totalPages(): number {
    return Math.max(1, Math.ceil(this.totalCount / this.pageSize));
  }

  get pageNumbers(): number[] {
    const total = this.totalPages;
    const current = this.page;
    const pages: number[] = [];
    const delta = 2;
    const start = Math.max(1, current - delta);
    const end = Math.min(total, current + delta);
    for (let i = start; i <= end; i++) {
      pages.push(i);
    }
    return pages;
  }

  onPageChange(newPage: number): void {
    if (newPage < 1 || newPage > this.totalPages || newPage === this.page) return;
    this.page = newPage;
    this.carregarEmpresas();
  }

  onPageSizeChange(newSize: number): void {
    this.pageSize = newSize;
    this.page = 1;
    this.carregarEmpresas();
  }

  toggleChip(chipId: string): void {
    if (this.chipsAtivos.has(chipId)) {
      this.chipsAtivos.delete(chipId);
    } else {
      this.chipsAtivos.add(chipId);
    }
    this.chipsAtivos = new Set(this.chipsAtivos);
    this.page = 1;
    this.carregarEmpresas();
    this.carregarSummary();
  }

  removeChip(chipId: string): void {
    this.chipsAtivos.delete(chipId);
    this.chipsAtivos = new Set(this.chipsAtivos);
    this.page = 1;
    this.carregarEmpresas();
    this.carregarSummary();
  }

  clearAllChips(): void {
    this.chipsAtivos.clear();
    this.chipsAtivos = new Set(this.chipsAtivos);
    this.page = 1;
    this.carregarEmpresas();
    this.carregarSummary();
  }

  isChipAtivo(chipId: string): boolean {
    return this.chipsAtivos.has(chipId);
  }

  onSearchChange(): void {
    if (this.searchDebounceTimer) clearTimeout(this.searchDebounceTimer);
    this.searchDebounceTimer = setTimeout(() => {
      this.page = 1;
      this.carregarEmpresas();
      this.carregarSummary();
      this.searchDebounceTimer = null;
    }, 350);
  }

  onExportar(): void {
    this.exportOpen = !this.exportOpen;
    this.sortOpen = false;
    this.cdr.markForCheck();
  }

  exportOpen = false;
  exportando = false;

  onExportReport(
    report: 'NOT_ELIGIBLE' | 'ALL_PENDING' | 'FILTERED'
  ): void {
    if (this.exportando) return;
    this.exportOpen = false;
    this.exportando = true;
    this.cdr.markForCheck();

    const listParams = this.buildListParams();
    this.empresasService
      .exportar({
        report,
        search: listParams.search,
        contabilidade_id: listParams.contabilidade_id,
        has_cert: listParams.has_cert,
        has_cred: listParams.has_cred,
        sem_cert: listParams.sem_cert,
        sem_cred: listParams.sem_cred,
        sem_metodo: listParams.sem_metodo,
        segment: listParams.segment,
        sort: listParams.sort,
        order: listParams.order,
      })
      .subscribe({
        next: ({ blob, filename }) => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          a.click();
          URL.revokeObjectURL(url);
          this.toast.success('Exportação concluída');
          this.exportando = false;
          this.cdr.markForCheck();
        },
        error: (err: unknown) => {
          this.toast.error(
            err instanceof Error ? err.message : 'Erro ao exportar'
          );
          this.exportando = false;
          this.cdr.markForCheck();
        },
      });
  }

  onSortChange(label: string): void {
    this.sortLabel = label;
    this.sortOpen = false;
    this.page = 1;
    this.carregarEmpresas();
  }

  cadastroAberto = false;
  importCertificadosLoteAberto = false;
  importCredenciaisModalAberto = false;

  onCadastrar(): void {
    this.cadastroAberto = true;
    this.cdr.markForCheck();
  }

  fecharCadastro(): void {
    this.cadastroAberto = false;
    this.cdr.markForCheck();
  }

  onCadastroSaved(): void {
    this.cadastroAberto = false;
    this.carregarEmpresas();
    this.carregarSummary();
    this.cdr.markForCheck();
  }

  onImportarCertificados(): void {
    this.importCertificadosLoteAberto = true;
    this.cdr.markForCheck();
  }

  fecharImportCertificadosLote(): void {
    this.importCertificadosLoteAberto = false;
    this.cdr.markForCheck();
  }

  onImportCertificadosLoteConcluido(): void {
    this.importCertificadosLoteAberto = false;
    this.carregarEmpresas();
    this.carregarSummary();
    this.cdr.markForCheck();
  }

  onImportarCredenciais(): void {
    this.importCredenciaisModalAberto = true;
    this.cdr.markForCheck();
  }

  fecharImportCredenciaisModal(): void {
    this.importCredenciaisModalAberto = false;
    this.cdr.markForCheck();
  }

  onImportCredenciaisConcluido(): void {
    this.importCredenciaisModalAberto = false;
    this.carregarEmpresas();
    this.carregarSummary();
    this.cdr.markForCheck();
  }

  validacaoModalAberto = false;

  onValidar(): void {
    this.validacaoModalAberto = true;
    this.cdr.markForCheck();
  }

  fecharValidacaoModal(): void {
    this.validacaoModalAberto = false;
    this.cdr.markForCheck();
  }

  onValidacaoConcluida(): void {
    this.validacaoModalAberto = false;
    this.carregarEmpresas();
    this.carregarSummary();
    this.cdr.markForCheck();
  }

  /** Empresas para o modal de validação (página atual já filtrada pela API). */
  get empresasParaValidacao() {
    return this.listaEmpresas.map((e) => ({
      id: parseInt(e.id, 10),
      cnpj: e.cnpj,
      razao_social: e.razao_social,
    }));
  }

  /** IDs selecionados como números (para escopo SELECTED). */
  get empresaIdsSelecionados(): number[] {
    return this.listaEmpresas
      .filter((e) => this.selectedIds.has(e.id))
      .map((e) => parseInt(e.id, 10));
  }

  toggleSelecionar(item: EmpresaListagemItem): void {
    if (this.selectedIds.has(item.id)) {
      this.selectedIds.delete(item.id);
    } else {
      this.selectedIds.add(item.id);
    }
    this.selectedIds = new Set(this.selectedIds);
    this.cdr.markForCheck();
  }

  toggleSelecionarTodos(): void {
    if (this.selectedIds.size === this.listaEmpresas.length) {
      this.selectedIds.clear();
    } else {
      this.listaEmpresas.forEach((e) => this.selectedIds.add(e.id));
    }
    this.selectedIds = new Set(this.selectedIds);
    this.cdr.markForCheck();
  }

  isTodosSelecionados(): boolean {
    return (
      this.listaEmpresas.length > 0 &&
      this.selectedIds.size === this.listaEmpresas.length
    );
  }

  isIndeterminado(): boolean {
    return (
      this.selectedIds.size > 0 &&
      this.selectedIds.size < this.listaEmpresas.length
    );
  }

  onEditar(item: EmpresaListagemItem): void {
    if (this.empresaSelecionada?.id === item.id) {
      this.fecharDrawer();
      return;
    }
    if (this.empresaSelecionada && this.editorDirty) {
      if (!confirm('Você tem alterações não salvas. Deseja descartar?')) {
        return;
      }
    }
    this.empresaSelecionada = item;
    this.empresaDetalhes = null;
    this.erro = null;
    this.carregandoDetalhes = true;
    this.cdr.markForCheck();

    this.empresasService.obterPorId(item.id).subscribe({
      next: (detalhes) => {
        this.empresaDetalhes = detalhes;
        this.carregandoDetalhes = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.erro = err.message || 'Erro ao carregar detalhes';
        this.carregandoDetalhes = false;
        this.cdr.markForCheck();
      },
    });
  }

  fecharDrawer(): void {
    this.empresaSelecionada = null;
    this.empresaDetalhes = null;
    this.erro = null;
    this.editorDirty = false;
    this.cdr.markForCheck();
  }

  onCloseRequest(event: { hasDirty: boolean }): void {
    if (event.hasDirty && !confirm('Você tem alterações não salvas. Deseja descartar?')) {
      return;
    }
    this.fecharDrawer();
  }

  onEditorSave(payload: EditorSavePayload): void {
    if (!this.empresaSelecionada) return;

    const total =
      (payload.contabilidade_id != null ? 1 : 0) + (payload.credenciais ? 1 : 0);
    if (total === 0) return;

    this.salvandoGeral = true;
    this.erro = null;
    this.cdr.markForCheck();

    let completed = 0;
    const done = () => {
      completed++;
      if (completed >= total) {
        this.salvandoGeral = false;
        this.editorDirty = false;
        this.toast.success('Alterações salvas');
        this.carregarEmpresas();
        this.empresasService.obterPorId(this.empresaSelecionada!.id).subscribe({
          next: (d) => {
            this.empresaDetalhes = d;
            this.cdr.markForCheck();
          },
        });
        this.cdr.markForCheck();
      }
    };

    const fail = (msg: string) => (err: unknown) => {
      this.erro = (err as Error)?.message || msg;
      this.salvandoGeral = false;
      this.cdr.markForCheck();
    };

    if (payload.contabilidade_id != null) {
      this.empresasService
        .atualizar(this.empresaSelecionada.id, {
          contabilidade_id: payload.contabilidade_id,
        })
        .subscribe({ next: done, error: fail('Erro ao alterar contabilidade') });
    }

    if (payload.credenciais) {
      const cred = payload.credenciais;
      if (cred.action === 'MARK_INACTIVE') {
        this.credenciaisService
          .atualizarStatus(cred.credencialId, 'INATIVA')
          .subscribe({
            next: done,
            error: fail('Erro ao marcar credencial como inativa'),
          });
      } else if (cred.action === 'REACTIVATE') {
        this.credenciaisService
          .atualizarStatus(cred.credencialId, 'NAO_TESTADO')
          .subscribe({
            next: () => {
              if (cred.senha && cred.senha.length >= 4) {
                this.credenciaisService
                  .atualizar(cred.credencialId, { senha: cred.senha })
                  .subscribe({
                    next: done,
                    error: fail('Erro ao atualizar senha'),
                  });
              } else {
                done();
              }
            },
            error: fail('Erro ao reativar credencial'),
          });
      } else if (cred.action === 'UPDATE') {
        if (cred.senha) {
          this.credenciaisService
            .atualizar(cred.credencialId, { senha: cred.senha })
            .subscribe({
              next: done,
              error: fail('Erro ao atualizar credencial'),
            });
        } else {
          done();
        }
      } else if (cred.action === 'CREATE') {
        this.empresasService
          .cadastroCredencial({
            cnpj: this.empresaSelecionada.cnpj,
            razao_social: this.empresaSelecionada.razao_social,
            senha: cred.senha,
            usuario: cred.usuario,
            tipo: cred.tipo as 'CNPJ_SENHA' | 'CPF_SENHA',
            contabilidade_id:
              this.empresaSelecionada.contabilidade_id ?? undefined,
          })
          .subscribe({
            next: done,
            error: fail('Erro ao cadastrar credencial'),
          });
      }
    }
  }

  abrirConfirmRemoverCertificado(payload: { cnpj: string }): void {
    this.removerCertificadoConfirmando = {
      cnpj: payload.cnpj,
      razaoSocial: this.empresaSelecionada?.razao_social,
    };
    this.cdr.markForCheck();
  }

  fecharConfirmRemoverCertificado(): void {
    if (!this.removendoCertificado) {
      this.removerCertificadoConfirmando = null;
      this.cdr.markForCheck();
    }
  }

  confirmarRemoverCertificado(): void {
    if (!this.removerCertificadoConfirmando) return;

    this.removendoCertificado = true;
    this.erro = null;
    this.cdr.markForCheck();

    const cnpj = this.removerCertificadoConfirmando.cnpj;

    this.empresasService.removerCertificado(cnpj).subscribe({
      next: () => {
        this.toast.success('Certificado removido com sucesso.');
        this.removerCertificadoConfirmando = null;
        this.removendoCertificado = false;
        this.carregarEmpresas();
        if (this.empresaSelecionada) {
          this.empresasService.obterPorId(this.empresaSelecionada.id).subscribe({
            next: (d) => {
              this.empresaDetalhes = d;
              this.cdr.markForCheck();
            },
          });
        }
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.erro = (err as Error)?.message || 'Erro ao remover certificado';
        this.removendoCertificado = false;
        this.cdr.markForCheck();
      },
    });
  }

  onCertificadoEnviado(payload: {
    file: File;
    senha: string;
    contabilidade_id: number;
  }): void {
    this.salvandoCertificado = true;
    this.erro = null;
    this.cdr.markForCheck();

    this.empresasService
      .cadastroCertificado(payload.file, payload.senha, payload.contabilidade_id)
      .subscribe({
        next: () => {
          this.toast.success('Certificado importado com sucesso!');
          this.carregarEmpresas();
          this.salvandoCertificado = false;
          setTimeout(() => this.fecharDrawer(), 700);
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.erro = err.message || 'Erro ao importar certificado';
          this.salvandoCertificado = false;
          this.cdr.markForCheck();
        },
      });
  }

  onDeletar(item: EmpresaListagemItem): void {
    this.excluirConfirmando = item;
  }

  fecharConfirmExcluir(): void {
    if (!this.excluindo) {
      this.excluirConfirmando = null;
      this.cdr.markForCheck();
    }
  }

  confirmarExcluir(): void {
    if (!this.excluirConfirmando) return;

    this.excluindo = true;
    this.cdr.markForCheck();

    const id = parseInt(this.excluirConfirmando.id, 10);
    this.empresasService.excluir(id).subscribe({
      next: () => {
        this.toast.success('Empresa excluída com sucesso!');
        this.carregarEmpresas();
        this.excluirConfirmando = null;
        this.excluindo = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.erro = err.message || 'Erro ao excluir empresa';
        this.excluindo = false;
        this.cdr.markForCheck();
      },
    });
  }

  fecharDropdownSeAberto(): void {
    let changed = false;
    if (this.sortOpen) {
      this.sortOpen = false;
      changed = true;
    }
    if (this.exportOpen) {
      this.exportOpen = false;
      changed = true;
    }
    if (this.contabDropdownOpen) {
      this.contabDropdownOpen = false;
      changed = true;
    }
    if (changed) this.cdr.markForCheck();
  }

  formatarCNPJ(cnpj: string): string {
    return this.formatarDocumento(cnpj);
  }

  /** Formata CNPJ ou CPF. CPF é detectado quando valor tem 14 dígitos começando com 000 (pad do backend). */
  formatarDocumento(valor: string): string {
    const l = (valor || '').replace(/\D/g, '');
    if (l.length === 11) {
      return l.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
    }
    if (l.length === 14) {
      if (l.startsWith('000')) {
        const cpf = l.slice(-11);
        return cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
      }
      return l.replace(
        /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
        '$1.$2.$3/$4-$5'
      );
    }
    return valor || '-';
  }
}
