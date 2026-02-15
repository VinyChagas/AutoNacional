import {
  Component,
  OnInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
} from '@angular/core';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
  FormsModule,
} from '@angular/forms';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { EmpresasUnificadoService } from '../../services/empresas-unificado.service';
import { ContabilidadeService } from '../../services/contabilidade.service';
import { ValidacoesService } from '../../services/validacoes.service';
import {
  EmpresaListagemItem,
  EmpresaDetalhes,
  CadastroCredencialPayload,
  SortField,
} from '../../models/empresas-unificado.model';
import { Contabilidade } from '../../models/contabilidade.model';

@Component({
  selector: 'app-empresas',
  standalone: true,
  imports: [ReactiveFormsModule, FormsModule, CommonModule, RouterModule],
  templateUrl: './empresas.component.html',
  styleUrls: ['./empresas.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmpresasComponent implements OnInit {
  items: EmpresaListagemItem[] = [];
  filtrados: EmpresaListagemItem[] = [];
  total = 0;
  page = 1;
  limit = 50;

  // Seleção para exclusão em massa
  selectedIds = new Set<string>();
  modalExcluirAberto = false;
  excluindoEmMassa = false;

  search = '';
  contabilidadeId: number | null = null;
  toggleComCert = false;
  toggleComCred = false;
  toggleCertVencido = false;
  toggleSemCert = false;
  toggleSemCred = false;
  toggleSemMetodo = false;

  sortField: SortField | null = null;
  sortOrder: 'asc' | 'desc' = 'asc';

  contabilidades: Contabilidade[] = [];
  loading = false;
  loadingContabilidades = false;

  // Feedback
  toastSucesso: string | null = null;
  toastErro: string | null = null;

  // Modal Cadastrar
  modalCadastrarAberto = false;
  passoCadastrar: 'escolha' | 'cert' | 'cred' = 'escolha';
  certFile: File | null = null;
  certSenha = '';
  credForm: FormGroup;
  salvandoCadastro = false;

  // Modal Editar
  modalEditarAberto = false;
  editandoEmpresa: EmpresaDetalhes | null = null;
  editTab: 'dados' | 'cert' | 'cred' = 'dados';
  editDadosForm: FormGroup;
  editCertFile: File | null = null;
  editCertSenha = '';
  editCredForm: FormGroup;
  salvandoEdicao = false;
  adicionandoCert = false;
  adicionandoCred = false;

  // Modal Import Certificados
  modalImportCertAberto = false;
  importCertFiles: File[] = [];
  importCertSenha = '';
  importCertPreview: { session_id: string; items: any[] } | null = null;
  importCertConfirmando = false;
  loadingPreviewCert = false;

  // Modal Validar
  modalValidarAberto = false;
  validarCert = false;
  validarCred = false;
  validarEscopo: 'SELECTED' | 'FILTERED' | 'ALL' = 'FILTERED';
  validarAvancadoAberto = false;
  validarConcorrencia = 2;
  validarTimeout = 60;
  validarStopErros = 5;
  validarIniciando = false;
  validarJobId: string | null = null;
  validarStatus: 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELED' | null = null;
  validarProgress = 0;
  validarTotal = 0;
  validarOk = 0;
  validarErrors = 0;
  validarProcessed = 0;
  validarPollInterval: ReturnType<typeof setInterval> | null = null;

  // Modal Import Credenciais
  modalImportCredAberto = false;
  importCredFile: File | null = null;
  importCredSessionId: string | null = null;
  importCredPreview: { session_id: string; items: any[] } | null = null;
  importCredSelecionados = new Set<number>(); // linha dos itens selecionados
  importCredConfirmando = false;
  loadingPreviewCred = false;

  constructor(
    private svc: EmpresasUnificadoService,
    private contSvc: ContabilidadeService,
    private validacoesSvc: ValidacoesService,
    private fb: FormBuilder,
    private cdr: ChangeDetectorRef
  ) {
    this.credForm = this.fb.group({
      cnpj: ['', [Validators.required]],
      razao_social: ['', [Validators.required, Validators.minLength(2)]],
      senha: ['', [Validators.required]],
      contabilidade_id: [null as number | null],
    });
    this.editDadosForm = this.fb.group({
      razao_social: ['', [Validators.required, Validators.minLength(2)]],
      regime: [''],
      contabilidade_id: [null as number | null],
    });
    this.editCredForm = this.fb.group({
      senha: ['', [Validators.required]],
    });
  }

  ngOnInit(): void {
    this.carregarContabilidades();
    this.carregar();
  }

  carregar(): void {
    this.loading = true;
    this.cdr.markForCheck();
    const params: Record<string, unknown> = {
      page: this.page,
      limit: this.limit,
    };
    if (this.search.trim()) params['search'] = this.search.trim();
    if (this.contabilidadeId != null && this.contabilidadeId > 0) {
      params['contabilidade_id'] = this.contabilidadeId;
    }
    if (this.toggleComCert || this.toggleCertVencido) params['has_cert'] = true;
    if (this.toggleComCred) params['has_cred'] = true;
    if (this.toggleSemCert) params['sem_cert'] = true;
    if (this.toggleSemCred) params['sem_cred'] = true;
    if (this.toggleSemMetodo) params['sem_metodo'] = true;
    if (this.sortField) {
      params['sort'] = this.sortField;
      params['order'] = this.sortOrder;
    }

    this.svc.listar(params as any).subscribe({
      next: (r) => {
        this.items = r.items ?? [];
        this.total = r.total ?? 0;
        this.aplicarFiltroCertVencido();
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (e) => {
        this.toastErro = e?.message || 'Erro ao carregar';
        this.loading = false;
        this.cdr.markForCheck();
        this.limparToastErro(4000);
      },
    });
  }

  aplicarFiltroCertVencido(): void {
    if (!this.toggleCertVencido) {
      this.filtrados = [...this.items];
      return;
    }
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    this.filtrados = this.items.filter((e) => {
      if (!e.has_certificado || !e.cert_validade) return false;
      const dt = this.parseDataValidade(e.cert_validade);
      return dt && dt < hoje;
    });
  }

  parseDataValidade(val: string): Date | null {
    if (!val) return null;
    const m = val.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      const d = new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
      return isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }

  carregarContabilidades(): void {
    this.loadingContabilidades = true;
    this.contSvc.listar().subscribe({
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

  getContabilidadeNome(item: EmpresaListagemItem): string {
    if (item.contabilidade_nome) return item.contabilidade_nome;
    if (item.contabilidade_id == null) return '-';
    const c = this.contabilidades.find((x) => x.id === item.contabilidade_id);
    return c?.nome_contabilidade ?? `ID ${item.contabilidade_id}`;
  }

  toggleSort(field: SortField): void {
    if (this.sortField === field) {
      if (this.sortOrder === 'asc') {
        this.sortOrder = 'desc';
      } else {
        this.sortField = null;
        this.sortOrder = 'asc';
      }
    } else {
      this.sortField = field;
      this.sortOrder = 'asc';
    }
    this.carregar();
    this.cdr.markForCheck();
  }

  getSortIcon(field: SortField): string {
    if (this.sortField !== field) return '↕';
    return this.sortOrder === 'asc' ? '↑' : '↓';
  }

  formatarCNPJ(cnpj: string): string {
    const l = (cnpj || '').replace(/\D/g, '');
    if (l.length === 14) {
      return l.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
    }
    return cnpj || '-';
  }

  isCertificadoVencido(item: EmpresaListagemItem): boolean {
    if (!item.cert_validade) return false;
    const d = this.parseDataValidade(item.cert_validade);
    return d ? d < new Date() : false;
  }

  // --- Cadastrar ---
  abrirModalCadastrar(): void {
    this.modalCadastrarAberto = true;
    this.passoCadastrar = 'escolha';
    this.certFile = null;
    this.certSenha = '';
    this.credForm.reset({ contabilidade_id: null });
    this.cdr.markForCheck();
  }

  fecharModalCadastrar(): void {
    this.modalCadastrarAberto = false;
    this.passoCadastrar = 'escolha';
    this.salvandoCadastro = false;
    this.cdr.markForCheck();
  }

  escolherCadastroCert(): void {
    this.passoCadastrar = 'cert';
    this.cdr.markForCheck();
  }

  escolherCadastroCred(): void {
    this.passoCadastrar = 'cred';
    this.credForm.reset({
      cnpj: '',
      razao_social: '',
      senha: '',
      contabilidade_id: this.contabilidadeId,
    });
    this.cdr.markForCheck();
  }

  onCertFileChange(e: Event): void {
    const inp = e.target as HTMLInputElement;
    this.certFile = inp?.files?.[0] ?? null;
    this.cdr.markForCheck();
  }

  salvarCadastroCert(): void {
    if (!this.certFile || !this.certSenha?.trim()) return;
    this.salvandoCadastro = true;
    this.cdr.markForCheck();
    this.svc
      .cadastroCertificado(
        this.certFile,
        this.certSenha,
        this.contabilidadeId
      )
      .subscribe({
        next: () => {
          this.toastSucesso = 'Certificado cadastrado com sucesso!';
          this.carregar();
          this.fecharModalCadastrar();
          this.limparToastSucesso(3000);
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.toastErro = err?.message || 'Erro ao cadastrar';
          this.salvandoCadastro = false;
          this.limparToastErro(4000);
          this.cdr.markForCheck();
        },
      });
  }

  salvarCadastroCred(): void {
    if (this.credForm.invalid) {
      this.credForm.markAllAsTouched();
      return;
    }
    const v = this.credForm.value;
    const cnpj = String(v.cnpj ?? '').replace(/\D/g, '');
    if (cnpj.length !== 14) {
      this.toastErro = 'CNPJ deve ter 14 dígitos';
      this.limparToastErro(3000);
      return;
    }
    this.salvandoCadastro = true;
    this.cdr.markForCheck();
    const payload: CadastroCredencialPayload = {
      cnpj,
      razao_social: v.razao_social?.trim(),
      senha: v.senha,
      contabilidade_id: v.contabilidade_id || null,
    };
    this.svc.cadastroCredencial(payload).subscribe({
      next: () => {
        this.toastSucesso = 'Credencial cadastrada com sucesso!';
        this.carregar();
        this.fecharModalCadastrar();
        this.limparToastSucesso(3000);
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.toastErro = err?.message || 'Erro ao cadastrar';
        this.salvandoCadastro = false;
        this.limparToastErro(4000);
        this.cdr.markForCheck();
      },
    });
  }

  // --- Editar ---
  abrirModalEditar(item: EmpresaListagemItem): void {
    const id = parseInt(item.id, 10);
    if (isNaN(id)) return;
    this.svc.obterPorId(id).subscribe({
      next: (d) => {
        this.editandoEmpresa = d;
        this.editTab = 'dados';
        this.editDadosForm.patchValue({
          razao_social: d.empresa.razao_social,
          regime: d.empresa.regime ?? '',
          contabilidade_id: d.empresa.contabilidade_id ?? null,
        });
        this.editCredForm.reset({ senha: '' });
        this.editCertFile = null;
        this.editCertSenha = '';
        this.modalEditarAberto = true;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.toastErro = err?.message || 'Erro ao carregar';
        this.limparToastErro(4000);
        this.cdr.markForCheck();
      },
    });
  }

  fecharModalEditar(): void {
    this.modalEditarAberto = false;
    this.editandoEmpresa = null;
    this.salvandoEdicao = false;
    this.adicionandoCert = false;
    this.adicionandoCred = false;
    this.cdr.markForCheck();
  }

  onEditCertFileChange(e: Event): void {
    const inp = e.target as HTMLInputElement;
    this.editCertFile = inp?.files?.[0] ?? null;
    this.cdr.markForCheck();
  }

  adicionarCertificado(): void {
    if (!this.editandoEmpresa || !this.editCertFile || !this.editCertSenha?.trim())
      return;
    this.adicionandoCert = true;
    this.cdr.markForCheck();
    this.svc
      .cadastroCertificado(
        this.editCertFile,
        this.editCertSenha,
        this.editandoEmpresa.empresa.contabilidade_id
      )
      .subscribe({
        next: () => {
          this.toastSucesso = 'Certificado adicionado!';
          this.adicionandoCert = false;
          this.editCertFile = null;
          this.editCertSenha = '';
          this.recarregarEdicao();
          this.limparToastSucesso(3000);
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.toastErro = err?.message || 'Erro';
          this.adicionandoCert = false;
          this.limparToastErro(4000);
          this.cdr.markForCheck();
        },
      });
  }

  adicionarCredencial(): void {
    if (!this.editandoEmpresa || this.editCredForm.invalid) return;
    const senha = this.editCredForm.get('senha')?.value;
    if (!senha?.trim()) return;
    this.adicionandoCred = true;
    this.cdr.markForCheck();
    const payload: CadastroCredencialPayload = {
      cnpj: this.editandoEmpresa.empresa.cnpj,
      senha,
      contabilidade_id: this.editandoEmpresa.empresa.contabilidade_id,
    };
    this.svc.cadastroCredencial(payload).subscribe({
      next: () => {
        this.toastSucesso = 'Credencial adicionada!';
        this.adicionandoCred = false;
        this.editCredForm.reset({ senha: '' });
        this.recarregarEdicao();
        this.limparToastSucesso(3000);
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.toastErro = err?.message || 'Erro';
        this.adicionandoCred = false;
        this.limparToastErro(4000);
        this.cdr.markForCheck();
      },
    });
  }

  get editCertificados() {
    const d = this.editandoEmpresa;
    if (!d) return [];
    return d.certificados ?? d.certificados_digitais ?? [];
  }

  salvarEdicaoDados(): void {
    if (!this.editandoEmpresa || this.editDadosForm.invalid) return;
    this.salvandoEdicao = true;
    this.cdr.markForCheck();
    const v = this.editDadosForm.value;
    this.svc
      .atualizar(this.editandoEmpresa.empresa.id, {
        razao_social: v.razao_social?.trim(),
        regime: v.regime?.trim() || undefined,
        contabilidade_id: v.contabilidade_id ?? null,
      })
      .subscribe({
        next: () => {
          this.toastSucesso = 'Dados atualizados!';
          this.salvandoEdicao = false;
          this.recarregarEdicao();
          this.limparToastSucesso(3000);
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.toastErro = err?.message || 'Erro';
          this.salvandoEdicao = false;
          this.limparToastErro(4000);
          this.cdr.markForCheck();
        },
      });
  }

  recarregarEdicao(): void {
    if (!this.editandoEmpresa) return;
    this.svc.obterPorId(this.editandoEmpresa.empresa.id).subscribe({
      next: (d) => {
        this.editandoEmpresa = d;
        this.carregar();
        this.cdr.markForCheck();
      },
    });
  }

  // --- Import Certificados ---
  abrirModalImportCert(): void {
    this.modalImportCertAberto = true;
    this.importCertFiles = [];
    this.importCertSenha = '';
    this.importCertPreview = null;
    this.cdr.markForCheck();
  }

  fecharModalImportCert(): void {
    this.modalImportCertAberto = false;
    this.importCertPreview = null;
    this.importCertConfirmando = false;
    this.loadingPreviewCert = false;
    this.cdr.markForCheck();
  }

  onImportCertFilesChange(e: Event): void {
    const inp = e.target as HTMLInputElement;
    this.importCertFiles = Array.from(inp?.files ?? []);
    this.importCertPreview = null;
    this.cdr.markForCheck();
  }

  fazerPreviewCert(): void {
    if (!this.importCertFiles.length || !this.importCertSenha?.trim()) return;
    this.loadingPreviewCert = true;
    this.cdr.markForCheck();
    this.svc.previewCertificados(this.importCertFiles, this.importCertSenha).subscribe({
      next: (r) => {
        this.importCertPreview = { session_id: r.session_id, items: r.items };
        this.loadingPreviewCert = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.toastErro = err?.message || 'Erro no preview';
        this.loadingPreviewCert = false;
        this.limparToastErro(4000);
        this.cdr.markForCheck();
      },
    });
  }

  confirmarImportCert(): void {
    if (!this.importCertPreview) return;
    const aprovados = this.importCertPreview.items
      .filter((i) => i.acao === 'IMPORTAR')
      .map((i) => ({ indice: i.indice }));
    if (!aprovados.length) return;
    this.importCertConfirmando = true;
    this.cdr.markForCheck();
    this.svc
      .confirmarCertificados({
        session_id: this.importCertPreview.session_id,
        senha: this.importCertSenha,
        itens: aprovados,
        contabilidade_id: this.contabilidadeId,
      })
      .subscribe({
        next: (r) => {
          this.toastSucesso = `${r.importados} certificado(s) importado(s) com sucesso!`;
          if (r.erros?.length) {
            this.toastErro = `${r.erros.length} erro(s): ${r.erros.map((x) => x.mensagem).join('; ')}`;
            this.limparToastErro(5000);
          }
          this.carregar();
          this.fecharModalImportCert();
          this.limparToastSucesso(3000);
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.toastErro = err?.message || 'Erro ao importar';
          this.importCertConfirmando = false;
          this.limparToastErro(4000);
          this.cdr.markForCheck();
        },
      });
  }

  // --- Import Credenciais ---
  abrirModalImportCred(): void {
    this.modalImportCredAberto = true;
    this.importCredFile = null;
    this.importCredSessionId = null;
    this.importCredPreview = null;
    this.importCredSelecionados = new Set();
    this.cdr.markForCheck();
  }

  fecharModalImportCred(): void {
    this.modalImportCredAberto = false;
    this.importCredSessionId = null;
    this.importCredPreview = null;
    this.importCredSelecionados = new Set();
    this.importCredConfirmando = false;
    this.loadingPreviewCred = false;
    this.cdr.markForCheck();
  }

  async baixarPlanilhaModeloCred(): Promise<void> {
    const xlsxModule = await import('xlsx');
    const XLSX = xlsxModule.default ?? xlsxModule;
    const dados = [
      ['Planilha modelo de importação'], // Linha 1: título (ignorada pelo parser)
      ['Razão Social', 'Tipo de Login', 'CNPJ ou CPF', 'Senha', 'Regime Tributário'],
      ['BLESSED LICENCAS LTDA', 'CNPJ', '54246893000189', 'SenhaExemplo1@', 'Simples Nacional'],
      ['CARX - SERVICOS AUTOMOTIVOS LTDA', 'CNPJ', '32639996000176', 'SenhaExemplo2*', 'Simples Nacional'],
    ];
    const ws = XLSX.utils.aoa_to_sheet(dados);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Credenciais');
    XLSX.writeFile(wb, 'planilha_modelo_credenciais.xlsx');
  }

  onImportCredFileChange(e: Event): void {
    const inp = e.target as HTMLInputElement;
    this.importCredFile = inp?.files?.[0] ?? null;
    this.importCredPreview = null;
    this.importCredSessionId = null;
    this.importCredSelecionados = new Set();
    this.cdr.markForCheck();
    if (this.importCredFile) {
      this.fazerPreviewCredComDados();
    }
  }

  fazerPreviewCred(): void {
    this.fazerPreviewCredComDados();
  }

  fazerPreviewCredComDados(): void {
    if (!this.importCredFile) {
      this.toastErro = 'Selecione um arquivo primeiro';
      this.limparToastErro(3000);
      this.cdr.markForCheck();
      return;
    }
    this.loadingPreviewCred = true;
    this.cdr.markForCheck();
    this.svc.previewCredenciais(this.importCredFile).subscribe({
      next: (r) => {
        this.importCredSessionId = r.session_id;
        this.importCredPreview = { session_id: r.session_id, items: r.items ?? [] };
        this.importCredSelecionados = new Set(
          (r.items ?? []).filter((i) => i.acao !== 'ERRO').map((i) => i.linha)
        );
        this.loadingPreviewCred = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.toastErro = err?.message || err?.error?.detail || 'Erro ao carregar preview. Verifique se o backend está rodando.';
        this.loadingPreviewCred = false;
        this.limparToastErro(5000);
        this.cdr.markForCheck();
      },
    });
  }

  confirmarImportCred(): void {
    if (!this.importCredSessionId || this.importCredSelecionados.size === 0) return;
    this.importCredConfirmando = true;
    this.cdr.markForCheck();
    this.svc.confirmarCredenciais({
      session_id: this.importCredSessionId,
      linhas_aprovadas: Array.from(this.importCredSelecionados),
    }).subscribe({
      next: (r) => {
        const total = r.criadas + r.atualizadas;
        this.toastSucesso = `${total} credencial(is) processada(s)! (${r.criadas} criadas, ${r.atualizadas} atualizadas)`;
        if (r.erros > 0) {
          this.toastErro = `${r.erros} erro(s) durante a importação`;
          this.limparToastErro(5000);
        }
        this.carregar();
        this.fecharModalImportCred();
        this.limparToastSucesso(3000);
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.toastErro = err?.message || 'Erro';
        this.importCredConfirmando = false;
        this.limparToastErro(4000);
        this.cdr.markForCheck();
      },
    });
  }

  toggleImportCredItem(linha: number, podeImportar: boolean): void {
    if (!podeImportar) return;
    if (this.importCredSelecionados.has(linha)) {
      this.importCredSelecionados.delete(linha);
    } else {
      this.importCredSelecionados.add(linha);
    }
    this.importCredSelecionados = new Set(this.importCredSelecionados);
    this.cdr.markForCheck();
  }

  selecionarTodosImportCred(): void {
    const importaveis = (this.importCredPreview?.items ?? []).filter((i) => i.acao !== 'ERRO').map((i) => i.linha);
    this.importCredSelecionados = new Set(importaveis);
    this.cdr.markForCheck();
  }

  desmarcarTodosImportCred(): void {
    this.importCredSelecionados = new Set();
    this.cdr.markForCheck();
  }

  getImportCredCountImportaveis(): number {
    return (this.importCredPreview?.items ?? []).filter((i) => i.acao !== 'ERRO').length;
  }

  // Preview cred usa índice da planilha - os índices no preview são linha-1 (0-based).
  // importCredPlanilhaDados é preenchido na ordem das linhas (índice 0 = linha 2, etc).
  // Os items do preview têm indice = row.linha - 1. Então importCredPlanilhaDados[indice] deve corresponder.
  // Porém no parse local fazemos dados.push para cada linha não-vazia - então índice i em dados = linha i+1 = indice do preview.
  // Ok, estamos alinhados.

  // --- Exclusão em massa ---
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
    if (this.selectedIds.size === this.filtrados.length) {
      this.selectedIds.clear();
    } else {
      this.filtrados.forEach((e) => this.selectedIds.add(e.id));
    }
    this.selectedIds = new Set(this.selectedIds);
    this.cdr.markForCheck();
  }

  isTodosSelecionados(): boolean {
    return this.filtrados.length > 0 && this.selectedIds.size === this.filtrados.length;
  }

  isIndeterminado(): boolean {
    return this.selectedIds.size > 0 && this.selectedIds.size < this.filtrados.length;
  }

  limparSelecao(): void {
    this.selectedIds.clear();
    this.cdr.markForCheck();
  }

  abrirModalExcluir(): void {
    if (this.selectedIds.size === 0) return;
    this.modalExcluirAberto = true;
    this.cdr.markForCheck();
  }

  fecharModalExcluir(): void {
    this.modalExcluirAberto = false;
    this.excluindoEmMassa = false;
    this.cdr.markForCheck();
  }

  // --- Validar ---
  abrirModalValidar(): void {
    this.modalValidarAberto = true;
    this.validarCert = false;
    this.validarCred = false;
    this.validarEscopo =
      this.selectedIds.size > 0 ? 'SELECTED' : 'FILTERED';
    this.validarAvancadoAberto = false;
    this.validarJobId = null;
    this.validarStatus = null;
    this.cdr.markForCheck();
  }

  fecharModalValidar(): void {
    this.modalValidarAberto = false;
    this.validarIniciando = false;
    this.cdr.markForCheck();
  }

  private pararPollValidacao(): void {
    if (this.validarPollInterval) {
      clearInterval(this.validarPollInterval);
      this.validarPollInterval = null;
    }
  }

  podeIniciarValidacao(): boolean {
    return this.validarCert || this.validarCred;
  }

  resumoValidacao(): string {
    const alvos: string[] = [];
    if (this.validarCert) alvos.push('Certificados');
    if (this.validarCred) alvos.push('Credenciais');
    let escopo = '';
    if (this.validarEscopo === 'SELECTED') {
      escopo = `${this.selectedIds.size} empresa(s) selecionada(s)`;
    } else if (this.validarEscopo === 'FILTERED') {
      escopo = 'Empresas filtradas';
    } else {
      escopo = 'Todas as empresas';
    }
    return `Validar ${alvos.join(' e ')} em ${escopo}.`;
  }

  iniciarValidacao(): void {
    if (!this.podeIniciarValidacao()) return;
    const targets: ('CERTIFICADO' | 'CREDENCIAL')[] = [];
    if (this.validarCert) targets.push('CERTIFICADO');
    if (this.validarCred) targets.push('CREDENCIAL');

    const scope: { mode: 'SELECTED' | 'FILTERED' | 'ALL'; empresa_ids?: number[] } = {
      mode: this.validarEscopo,
    };
    if (this.validarEscopo === 'SELECTED' && this.selectedIds.size > 0) {
      scope.empresa_ids = Array.from(this.selectedIds)
        .map((s) => parseInt(s, 10))
        .filter((n) => !isNaN(n) && n > 0);
    }

    const filters: Record<string, unknown> = {};
    if (this.search.trim()) filters['search'] = this.search.trim();
    if (this.contabilidadeId != null && this.contabilidadeId > 0) {
      filters['contabilidade_id'] = this.contabilidadeId;
    }
    if (this.toggleComCert || this.toggleCertVencido) filters['has_cert'] = true;
    if (this.toggleComCred) filters['has_cred'] = true;
    if (this.toggleSemCert) filters['sem_cert'] = true;
    if (this.toggleSemCred) filters['sem_cred'] = true;
    if (this.toggleSemMetodo) filters['sem_metodo'] = true;
    if (this.sortField) {
      filters['sort'] = this.sortField;
      filters['order'] = this.sortOrder;
    }

    const payload = {
      targets,
      scope,
      filters: Object.keys(filters).length ? filters : undefined,
      options: {
        concurrency: this.validarConcorrencia,
        timeoutSeconds: this.validarTimeout,
        stopOnConsecutiveErrors: this.validarStopErros,
      },
    };

    this.validarIniciando = true;
    this.cdr.markForCheck();
    this.validacoesSvc.start(payload).subscribe({
      next: (r) => {
        this.validarJobId = r.job_id;
        this.validarStatus = 'RUNNING';
        this.validarIniciando = false;
        this.toastSucesso = 'Validação iniciada!';
        this.fecharModalValidar();
        this.iniciarPollValidacao(r.job_id);
        this.limparToastSucesso(3000);
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.toastErro = err?.message || 'Erro ao iniciar validação';
        this.validarIniciando = false;
        this.limparToastErro(4000);
        this.cdr.markForCheck();
      },
    });
  }

  private iniciarPollValidacao(jobId: string): void {
    this.pararPollValidacao();
    const poll = () => {
      this.validacoesSvc.getStatus(jobId).subscribe({
        next: (s) => {
          this.validarStatus = s.status;
          this.validarProgress = s.progress;
          this.validarTotal = s.total;
          this.validarOk = s.ok;
          this.validarErrors = s.errors;
          this.validarProcessed = s.processed;
          this.cdr.markForCheck();
          if (s.status === 'DONE' || s.status === 'FAILED' || s.status === 'CANCELED') {
            this.pararPollValidacao();
            this.carregar();
            if (s.status === 'DONE') {
              this.toastSucesso = `Validação concluída: ${s.ok} OK, ${s.errors} erros`;
              this.limparToastSucesso(4000);
            }
          }
        },
      });
    };
    poll();
    this.validarPollInterval = setInterval(poll, 2000);
  }

  confirmarExclusaoEmMassa(): void {
    if (this.selectedIds.size === 0) return;
    const ids = Array.from(this.selectedIds)
      .map((s) => parseInt(s, 10))
      .filter((n) => !isNaN(n) && n > 0);
    if (ids.length === 0) return;
    this.excluindoEmMassa = true;
    this.cdr.markForCheck();
    this.svc.excluirEmMassa(ids).subscribe({
      next: (r) => {
        this.toastSucesso = `${r.deleted} empresa(s) excluída(s) com sucesso!`;
        this.limparSelecao();
        this.fecharModalExcluir();
        this.carregar();
        this.limparToastSucesso(3000);
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.toastErro = err?.message || 'Erro ao excluir';
        this.excluindoEmMassa = false;
        this.limparToastErro(4000);
        this.cdr.markForCheck();
      },
    });
  }

  limparToastSucesso(ms: number): void {
    setTimeout(() => {
      this.toastSucesso = null;
      this.cdr.markForCheck();
    }, ms);
  }

  limparToastErro(ms: number): void {
    setTimeout(() => {
      this.toastErro = null;
      this.cdr.markForCheck();
    }, ms);
  }
}
