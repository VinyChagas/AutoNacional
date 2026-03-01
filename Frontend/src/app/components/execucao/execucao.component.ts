import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CertificadoService, Certificado, CertificadoResponse } from '../../services/certificado.service';
import { ExecucaoService, ExecucaoEmpresa, ExecucaoStatusResponse, StatusExecucao, ResultadoFinal, ResumoExecucoesResponse, MultiplasExecucoesRequest, ExecutionSummaryResponse, EmpresaExecucaoItem, ExecutionStreamEvent } from '../../services/execucao.service';
import { ExecucaoLogsService } from '../../services/execucao-logs.service';
import { ToastService } from '../../services/toast.service';
import { ContabilidadeService } from '../../services/contabilidade.service';
import { EmpresasService } from '../../services/empresas.service';
import { Empresa } from '../../models/empresas.model';
import { Contabilidade } from '../../models/contabilidade.model';
import type { ExecutionBatchLogPayload, ExecutionBatchLogItem } from '../../models/execucao-batch-log.model';
import type { ExecutionRow, ExecutionRowStatus } from '../../models/execution-row.model';
import { Subject, takeUntil, firstValueFrom } from 'rxjs';
import * as XLSX from 'xlsx';

@Component({
  selector: 'app-execucao',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './execucao.component.html',
  styleUrls: ['./execucao.component.scss']
})
export class ExecucaoComponent implements OnInit, OnDestroy {
  certificadosValidos: Certificado[] = [];
  certificadosCarregados: Certificado[] = [];
  execucoes: ExecucaoEmpresa[] = [];
  /** Lista unificada em linhas (modelo novo) */
  executionRows: ExecutionRow[] = [];
  /** Toggle "Mostrar apenas falhas" */
  mostrarApenasFalhas = false;
  /** True após clicar Iniciar - controla exibição dos cards de resumo */
  executionStarted = false;
  
  // Contabilidade
  contabilidades: Contabilidade[] = [];
  contabilidadeSelecionada: number | null = null;
  carregandoContabilidades = false;

  // Summary de empresas (cards ao selecionar contabilidade)
  summary: ExecutionSummaryResponse | null = null;
  carregandoSummary = false;
  modalGrupoAberto = false;
  grupoModal: 'total' | 'aptas' | 'inoperantes' | 'parciais' = 'total';
  empresasGrupoModal: EmpresaExecucaoItem[] = [];
  buscaModalGrupo = '';
  
  // Modal de seleção de certificados e empresas
  modalSelecaoAberto = false;
  certificadosDisponiveis: CertificadoResponse[] = [];
  empresasDisponiveis: Empresa[] = [];
  // Interface unificada para exibição no modal
  empresasUnificadas: Array<{
    id: string | number;
    cnpj: string;
    nomeEmpresa: string;
    tipo: 'certificado' | 'empresa';
    dataVencimento?: string;
    empresa_id?: number;
  }> = [];
  
  // Mapa para armazenar tipo de autenticação de cada empresa
  tiposAutenticacao: Map<string | number, 'certificado' | 'credenciais'> = new Map();
  empresasSelecionadas: Set<string | number> = new Set();
  todosSelecionados = false;
  carregandoCertificadosDisponiveis = false;
  buscaEmpresa: string = ''; // Campo de busca por nome da empresa
  
  carregandoCertificados = false;
  headlessMode = false;
  dataInicio: string = ''; // Formato DD/MM/YYYY (ex: 01/12/2025)
  dataFim: string = ''; // Formato DD/MM/YYYY (ex: 31/12/2025)
  tipoNotas: 'emitidas' | 'recebidas' | 'ambas' = 'ambas';

  // Formata data enquanto o usuário digita (DD/MM/YYYY)
  formatarData(event: Event, tipo: 'inicio' | 'fim') {
    const input = event.target as HTMLInputElement;
    let value = input.value.replace(/\D/g, ''); // Remove tudo que não é dígito
    
    if (value.length > 0) {
      if (value.length <= 2) {
        value = value;
      } else if (value.length <= 4) {
        value = value.substring(0, 2) + '/' + value.substring(2, 4);
      } else {
        value = value.substring(0, 2) + '/' + value.substring(2, 4) + '/' + value.substring(4, 8);
      }
    }
    
    if (tipo === 'inicio') {
      this.dataInicio = value;
    } else {
      this.dataFim = value;
    }
    
    input.value = value;
  }
  
  // Relatório
  resumo: ResumoExecucoesResponse | null = null;
  mostrandoResumo = false;
  carregandoResumo = false;
  
  // Filtros e ordenação para tabela de finalizados
  execucoesFinalizadasFiltradas: ExecucaoEmpresa[] = [];
  sortState: { column: 'nomeEmpresa' | 'cnpj' | 'resultadoFinal' | 'qtdNotasEmitidas' | 'qtdNotasRecebidas' | null; direction: 'asc' | 'desc' | null } = { column: null, direction: null };
  searchColumn: 'nomeEmpresa' | 'cnpj' | 'resultadoFinal' = 'cnpj';
  searchValue: string = '';
  
  searchColumns: { value: 'nomeEmpresa' | 'cnpj' | 'resultadoFinal'; label: string }[] = [
    { value: 'cnpj', label: 'CNPJ' },
    { value: 'nomeEmpresa', label: 'Nome da Empresa' },
    { value: 'resultadoFinal', label: 'Status' }
  ];
  
  private intervalosStatus: Map<string, any> = new Map();
  private batchPollingInterval: ReturnType<typeof setInterval> | null = null;
  private destroy$ = new Subject<void>();
  private streamSubscription: { unsubscribe: () => void } | null = null;

  // Salvar Log
  batchId: string | null = null;
  logSalvo = false;
  isSavingLog = false;

  constructor(
    private certificadoService: CertificadoService,
    private execucaoService: ExecucaoService,
    private execucaoLogsService: ExecucaoLogsService,
    private toastService: ToastService,
    private contabilidadeService: ContabilidadeService,
    private empresasService: EmpresasService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    // Carrega contabilidades
    this.carregarContabilidades();
    
    // Observa mudanças nos certificados
    this.certificadoService.certificados$
      .pipe(takeUntil(this.destroy$))
      .subscribe(certificados => {
        // Filtra apenas certificados válidos (não vencidos)
        this.certificadosValidos = certificados.filter(
          c => c.status !== 'vencido'
        );
      });
    
    // Inicializa lista filtrada
    this.atualizarExecucoesFinalizadasFiltradas();
  }

  async carregarContabilidades() {
    this.carregandoContabilidades = true;
    try {
      const response = await firstValueFrom(this.contabilidadeService.listar());
      this.contabilidades = response.contabilidades;
    } catch (error) {
      console.error('Erro ao carregar contabilidades:', error);
    } finally {
      this.carregandoContabilidades = false;
    }
  }

  onContabilidadeChange(value: number | null) {
    this.contabilidadeSelecionada = value;
    this.summary = null;
    if (value) {
      this.carregarSummary();
    }
  }

  async carregarSummary() {
    if (!this.contabilidadeSelecionada) return;
    this.carregandoSummary = true;
    try {
      this.summary = await firstValueFrom(
        this.execucaoService.obterSummaryExecucao(this.contabilidadeSelecionada!)
      );
    } catch (error) {
      console.error('Erro ao carregar summary:', error);
      this.toastService.error('Erro ao carregar resumo de empresas');
      this.summary = null;
    } finally {
      this.carregandoSummary = false;
      this.cdr.markForCheck();
    }
  }

  abrirModalGrupo(grupo: 'total' | 'aptas' | 'inoperantes' | 'parciais') {
    if (!this.summary) return;
    this.grupoModal = grupo;
    switch (grupo) {
      case 'total':
        this.empresasGrupoModal = [
          ...this.summary.aptas,
          ...this.summary.inoperantes,
          ...this.summary.parciais,
        ];
        break;
      case 'aptas':
        this.empresasGrupoModal = [...this.summary.aptas];
        break;
      case 'inoperantes':
        this.empresasGrupoModal = [...this.summary.inoperantes];
        break;
      case 'parciais':
        this.empresasGrupoModal = [...this.summary.parciais];
        break;
    }
    this.buscaModalGrupo = '';
    this.modalGrupoAberto = true;
    this.cdr.markForCheck();
  }

  fecharModalGrupo() {
    this.modalGrupoAberto = false;
    this.empresasGrupoModal = [];
    this.buscaModalGrupo = '';
    this.cdr.markForCheck();
  }

  filtrarEmpresasModalGrupo() {
    this.cdr.markForCheck();
  }

  get empresasGrupoModalFiltradas(): EmpresaExecucaoItem[] {
    if (!this.buscaModalGrupo?.trim()) return this.empresasGrupoModal;
    const termo = this.buscaModalGrupo.toLowerCase().trim();
    const termoNum = termo.replace(/\D/g, '');
    return this.empresasGrupoModal.filter((e) => {
      const nome = (e.razao_social || '').toLowerCase();
      const cnpj = (e.cnpj || '').replace(/\D/g, '');
      return nome.includes(termo) || (termoNum.length >= 4 && cnpj.includes(termoNum));
    });
  }

  obterTituloModalGrupo(): string {
    switch (this.grupoModal) {
      case 'total':
        return `Todas as empresas (${this.empresasGrupoModal.length})`;
      case 'aptas':
        return `Empresas aptas para execução (${this.empresasGrupoModal.length})`;
      case 'inoperantes':
        return `Empresas inoperantes (${this.empresasGrupoModal.length})`;
      case 'parciais':
        return `Empresas parciais (${this.empresasGrupoModal.length})`;
      default:
        return 'Empresas';
    }
  }

  ngOnDestroy() {
    this.streamSubscription?.unsubscribe();
    this.streamSubscription = null;
    if (this.batchPollingInterval) {
      clearInterval(this.batchPollingInterval);
      this.batchPollingInterval = null;
    }
    this.intervalosStatus.forEach(intervalo => clearInterval(intervalo));
    this.intervalosStatus.clear();
    this.destroy$.next();
    this.destroy$.complete();
  }

  /** Ordenação: EM_EXECUCAO primeiro, depois FILA, OK, ERRO */
  private ordemStatus(a: ExecutionRowStatus): number {
    const ord: Record<ExecutionRowStatus, number> = {
      EM_EXECUCAO: 0,
      FILA: 1,
      OK: 2,
      ERRO: 3,
    };
    return ord[a] ?? 4;
  }

  /** Linhas filtradas e ordenadas para exibição */
  get executionRowsExibidas(): ExecutionRow[] {
    let rows = [...this.executionRows];
    if (this.mostrarApenasFalhas) {
      rows = rows.filter((r) => r.status === 'ERRO');
    }
    return rows.sort((a, b) => this.ordemStatus(a.status) - this.ordemStatus(b.status));
  }

  // Getters para colunas (filtros derivados do array principal)
  get colunaFila(): ExecucaoEmpresa[] {
    return this.execucoes.filter(e => e.status === 'fila');
  }

  get colunaExecutando(): ExecucaoEmpresa[] {
    return this.execucoes.filter(e => e.status === 'executando');
  }

  get colunaFinalizado(): ExecucaoEmpresa[] {
    return this.execucoes.filter(e => e.status === 'finalizado');
  }

  // Atualiza execuções finalizadas filtradas quando necessário
  atualizarExecucoesFinalizadasFiltradas() {
    let resultado = [...this.colunaFinalizado];
    
    // Filtro de busca por texto
    if (this.searchValue.trim()) {
      const searchLower = this.searchValue.trim().toLowerCase();
      resultado = resultado.filter(exec => {
        let cellValue = '';
        
        switch (this.searchColumn) {
          case 'cnpj':
            cellValue = (exec.cnpj || '').toLowerCase();
            break;
          case 'nomeEmpresa':
            cellValue = (exec.nomeEmpresa || '').toLowerCase();
            break;
          case 'resultadoFinal':
            cellValue = this.obterTextoResultadoFinal(exec.resultadoFinal).toLowerCase();
            break;
        }
        
        return cellValue.includes(searchLower);
      });
    }
    
    // Ordenação
    if (this.sortState.column && this.sortState.direction) {
      resultado.sort((a, b) => {
        let comparison = 0;
        
        switch (this.sortState.column) {
          case 'cnpj':
            comparison = (a.cnpj || '').localeCompare(b.cnpj || '');
            break;
          case 'nomeEmpresa':
            comparison = (a.nomeEmpresa || '').localeCompare(b.nomeEmpresa || '');
            break;
          case 'resultadoFinal':
            comparison = this.obterTextoResultadoFinal(a.resultadoFinal).localeCompare(this.obterTextoResultadoFinal(b.resultadoFinal));
            break;
          case 'qtdNotasEmitidas':
            comparison = (a.qtdNotasEmitidas || 0) - (b.qtdNotasEmitidas || 0);
            break;
          case 'qtdNotasRecebidas':
            comparison = (a.qtdNotasRecebidas || 0) - (b.qtdNotasRecebidas || 0);
            break;
        }
        
        return this.sortState.direction === 'asc' ? comparison : -comparison;
      });
    }
    
    this.execucoesFinalizadasFiltradas = resultado;
  }

  onSearchChange() {
    this.atualizarExecucoesFinalizadasFiltradas();
  }

  onSearchColumnChange() {
    this.atualizarExecucoesFinalizadasFiltradas();
  }

  toggleSort(column: 'nomeEmpresa' | 'cnpj' | 'resultadoFinal' | 'qtdNotasEmitidas' | 'qtdNotasRecebidas') {
    if (this.sortState.column === column) {
      if (this.sortState.direction === 'asc') {
        this.sortState = { column, direction: 'desc' };
      } else if (this.sortState.direction === 'desc') {
        this.sortState = { column: null, direction: null };
      }
    } else {
      this.sortState = { column, direction: 'asc' };
    }
    this.atualizarExecucoesFinalizadasFiltradas();
  }

  isColumnSorted(column: string): boolean {
    return this.sortState.column === column;
  }

  getSortIcon(column: string): string {
    if (this.sortState.column !== column) return '↕';
    return this.sortState.direction === 'asc' ? '↑' : '↓';
  }

  // Getter para verificar se há execuções em andamento
  get temExecucoesEmAndamento(): boolean {
    return this.executionRows.some((r) => r.status === 'EM_EXECUCAO' || (r.status === 'FILA' && r.mensagem !== 'Aguardando início...')) ||
      this.execucoes.some((e) => e.status === 'executando' || (e.status === 'fila' && e.mensagem !== 'Aguardando início...'));
  }

  // Getter para verificar se pode habilitar botão "Carregar Empresas Validadas"
  get podeCarregarEmpresas(): boolean {
    return this.contabilidadeSelecionada !== null && !this.carregandoCertificados;
  }

  // Getter para verificar se pode habilitar botão "Iniciar"
  get podeIniciar(): boolean {
    const temPendentes = this.executionRows.some((r) => r.status === 'FILA' && r.mensagem === 'Aguardando início...') ||
      this.execucoes.some((e) => e.status === 'fila' && e.mensagem === 'Aguardando início...');
    return this.execucoes.length > 0 && temPendentes && !this.carregandoCertificados && !this.temExecucoesEmAndamento;
  }

  // Getter para habilitar botão "Salvar Log"
  get podeSalvarLog(): boolean {
    return !!this.batchId &&
           !this.temExecucoesEmAndamento &&
           !this.logSalvo &&
           !this.isSavingLog &&
           this.execucoes.length > 0;
  }

  // Formata data de vencimento
  formatarDataVencimento(dataVencimento: string): string {
    const data = new Date(dataVencimento);
    return data.toLocaleDateString('pt-BR');
  }

  // Calcula dias até vencimento
  calcularDiasAteVencimento(dataVencimento: string): number {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const vencimento = new Date(dataVencimento);
    vencimento.setHours(0, 0, 0, 0);
    const diffTime = vencimento.getTime() - hoje.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }

  // Bloco de 30 CNPJs em foco
  get emFoco(): ExecucaoEmpresa[] {
    const emExecucaoOuFila = this.execucoes.filter(
      e => e.status === 'fila' || e.status === 'executando'
    );
    return emExecucaoOuFila.slice(0, 30);
  }

  get aguardando(): number {
    const emExecucaoOuFila = this.execucoes.filter(
      e => e.status === 'fila' || e.status === 'executando'
    );
    return Math.max(emExecucaoOuFila.length - 30, 0);
  }

  // Barra de progresso geral
  get totalEmpresas(): number {
    return this.executionRows.length || this.execucoes.length;
  }

  get empresasFinalizadas(): number {
    return (this.executionRows.length ? this.executionRows.filter((r) => r.status === 'OK').length : 0) ||
      this.execucoes.filter((e) => e.status === 'finalizado').length;
  }

  get totalErro(): number {
    return (this.executionRows.length ? this.executionRows.filter((r) => r.status === 'ERRO').length : 0) ||
      this.execucoes.filter((e) => e.status === 'falhou').length;
  }

  /** Empresas aguardando na fila (ainda não iniciaram) */
  get filaRestante(): number {
    return this.executionRows.filter((r) => r.status === 'FILA').length;
  }

  /** Empresas em execução (navegadores abertos) */
  get totalEmExecucao(): number {
    return this.executionRows.filter((r) => r.status === 'EM_EXECUCAO').length;
  }

  get percentualFinalizado(): number {
    if (this.totalEmpresas === 0) return 0;
    return Math.round((this.empresasFinalizadas / this.totalEmpresas) * 100);
  }

  async carregarEmpresasValidadas() {
    // Valida se há contabilidade selecionada
    if (!this.contabilidadeSelecionada) {
      alert('Por favor, selecione uma contabilidade primeiro.');
      return;
    }

    // Abre modal de seleção
    await this.abrirModalSelecaoCertificados();
  }

  async abrirModalSelecaoCertificados() {
    if (!this.contabilidadeSelecionada) {
      return;
    }

    this.carregandoCertificadosDisponiveis = true;
    this.modalSelecaoAberto = true;
    this.buscaEmpresa = '';
    this.tiposAutenticacao.clear();

    try {
      let aptas: EmpresaExecucaoItem[];
      if (this.summary?.aptas?.length !== undefined && this.summary.aptas.length > 0) {
        aptas = this.summary.aptas;
      } else {
        const response = await firstValueFrom(
          this.execucaoService.listarEmpresasAptas(this.contabilidadeSelecionada!)
        );
        aptas = response;
      }

      this.empresasUnificadas = aptas.map((emp) => {
        const id = emp.empresa_id > 0 ? `emp-${emp.empresa_id}` : `cnpj-${emp.cnpj}`;
        const tipoAuth = emp.login_metodo === 'CERTIFICADO' ? 'certificado' : 'credenciais';
        this.tiposAutenticacao.set(id, tipoAuth);
        return {
          id,
          cnpj: emp.cnpj,
          nomeEmpresa: emp.razao_social,
          tipo: (emp.login_metodo === 'CERTIFICADO' ? 'certificado' : 'empresa') as 'certificado' | 'empresa',
          empresa_id: emp.empresa_id,
        };
      });

      this.filtrarCertificados();
      this.atualizarEstadoTodosSelecionados();
    } catch (error: unknown) {
      console.error('Erro ao carregar empresas validadas:', error);
      this.toastService.error('Erro ao carregar empresas validadas. Verifique se o backend está rodando.');
      this.modalSelecaoAberto = false;
    } finally {
      this.carregandoCertificadosDisponiveis = false;
      this.cdr.markForCheck();
    }
  }

  fecharModalSelecao() {
    // Não limpa seleções ao fechar - mantém para caso o usuário reabra
    // this.certificadosSelecionados.clear();
    this.modalSelecaoAberto = false;
    this.buscaEmpresa = '';
    // Atualiza estado ao fechar
    this.atualizarEstadoTodosSelecionados();
  }

  // Lista filtrada de empresas unificadas (atualizada em tempo real)
  empresasUnificadasFiltradas: Array<{
    id: string | number;
    cnpj: string;
    nomeEmpresa: string;
    tipo: 'certificado' | 'empresa';
    dataVencimento?: string;
  }> = [];

  // Método para filtrar empresas unificadas
  filtrarCertificados() {
    if (!this.buscaEmpresa || this.buscaEmpresa.trim() === '') {
      this.empresasUnificadasFiltradas = [...this.empresasUnificadas];
      this.cdr.markForCheck();
      return;
    }
    
    const termoBusca = this.buscaEmpresa.toLowerCase().trim();
    const termoBuscaLimpo = termoBusca.replace(/[^\d]/g, '');
    
    this.empresasUnificadasFiltradas = this.empresasUnificadas.filter(emp => {
      const nomeEmpresa = (emp.nomeEmpresa || '').toLowerCase();
      const cnpjLimpo = (emp.cnpj || '').replace(/[^\d]/g, '');
      
      // Busca no nome da empresa
      if (nomeEmpresa.includes(termoBusca)) {
        return true;
      }
      
      // Busca no CNPJ (apenas se o termo tiver números)
      if (termoBuscaLimpo.length > 0 && cnpjLimpo.includes(termoBuscaLimpo)) {
        return true;
      }
      
      return false;
    });
    
    this.cdr.markForCheck();
  }

  atualizarEstadoTodosSelecionados() {
    if (this.empresasUnificadasFiltradas.length === 0) {
      this.todosSelecionados = false;
      return;
    }
    // Verifica se todas as empresas FILTRADAS estão selecionadas
    this.todosSelecionados = this.empresasUnificadasFiltradas.every(emp => 
      this.empresasSelecionadas.has(emp.id)
    );
  }

  toggleSelecionarTodos() {
    if (this.todosSelecionados) {
      // Desmarca apenas as empresas filtradas
      this.empresasUnificadasFiltradas.forEach(emp => {
        this.empresasSelecionadas.delete(emp.id);
      });
    } else {
      // Marca apenas as empresas filtradas
      this.empresasUnificadasFiltradas.forEach(emp => {
        this.empresasSelecionadas.add(emp.id);
      });
    }
    this.atualizarEstadoTodosSelecionados();
  }

  toggleSelecionarEmpresa(empresaId: string | number) {
    if (this.empresasSelecionadas.has(empresaId)) {
      this.empresasSelecionadas.delete(empresaId);
    } else {
      this.empresasSelecionadas.add(empresaId);
    }
    // Atualiza estado de "todos selecionados" baseado nos filtrados
    this.atualizarEstadoTodosSelecionados();
  }

  estaSelecionado(empresaId: string | number): boolean {
    return this.empresasSelecionadas.has(empresaId);
  }

  async confirmarSelecaoCertificados() {
    if (this.empresasSelecionadas.size === 0) {
      alert('Por favor, selecione pelo menos uma empresa.');
      return;
    }

    // Fecha o modal
    this.modalSelecaoAberto = false;

    // Converte empresas selecionadas para o formato esperado
    const empresasSelecionadas = this.empresasUnificadas.filter(emp =>
      this.empresasSelecionadas.has(emp.id)
    );

    // Reseta batch e log ao carregar novas empresas
    this.batchId = null;
    this.logSalvo = false;

    // Cria execuções pendentes e linhas de exibição
    const cnpjLimpo = (c: string) => c.replace(/[^\d]/g, '');
    this.execucoes = empresasSelecionadas.map(emp => {
      const c = cnpjLimpo(emp.cnpj);
      const tipoAuth = this.tiposAutenticacao.get(emp.id) || (emp.tipo === 'certificado' ? 'certificado' : 'credenciais');
      const empresaIdParam = emp.empresa_id && emp.empresa_id > 0 ? String(emp.empresa_id) : c;
      return {
        id: `pendente-${emp.id}-${c}`,
        empresa_id: empresaIdParam,
        cnpj: c,
        nomeEmpresa: emp.nomeEmpresa,
        status: 'fila' as StatusExecucao,
        progresso: 0,
        logs: [],
        mensagem: 'Aguardando início...',
        dataInicio: new Date(),
        mostrarLogs: false,
        tipoAutenticacao: tipoAuth
      };
    });

    this.executionRows = empresasSelecionadas.map(emp => {
      const c = cnpjLimpo(emp.cnpj);
      const empresaIdParam = emp.empresa_id && emp.empresa_id > 0 ? String(emp.empresa_id) : c;
      const metodo = (this.tiposAutenticacao.get(emp.id) || (emp.tipo === 'certificado' ? 'certificado' : 'credenciais')) === 'certificado' ? 'CERTIFICADO' : 'CREDENCIAL';
      return {
        empresa_id: empresaIdParam,
        cnpj: c,
        razao_social: emp.nomeEmpresa || c,
        metodo,
        qtd_emitidas: 0,
        qtd_recebidas: 0,
        qtd_canceladas: 0,
        status: 'FILA' as ExecutionRowStatus,
        mensagem: 'Aguardando início...',
      };
    });

    // Limpa seleções
    this.empresasSelecionadas.clear();
    this.todosSelecionados = false;
  }

  async iniciar() {
    this.executionStarted = true;
    console.log('[Iniciar] Iniciando execução das empresas carregadas...');
    console.log('[Iniciar] Execuções carregadas:', this.execucoes.length);

    // Valida datas antes de iniciar
    if (!this.dataInicio || !this.dataFim) {
      console.error('[Iniciar] Datas inválidas:', { dataInicio: this.dataInicio, dataFim: this.dataFim });
      alert('Por favor, informe a data de início e data de fim.');
      return;
    }
    
    // Valida formato das datas (DD/MM/YYYY)
    const dataInicioRegex = /^\d{2}\/\d{2}\/\d{4}$/;
    const dataFimRegex = /^\d{2}\/\d{2}\/\d{4}$/;
    
    if (!dataInicioRegex.test(this.dataInicio) || !dataFimRegex.test(this.dataFim)) {
      alert('Por favor, informe as datas no formato DD/MM/YYYY (ex: 01/12/2025).');
      return;
    }
    
    // Valida que data fim é maior ou igual a data início
    const [diaInicio, mesInicio, anoInicio] = this.dataInicio.split('/').map(Number);
    const [diaFim, mesFim, anoFim] = this.dataFim.split('/').map(Number);
    const dataInicioObj = new Date(anoInicio, mesInicio - 1, diaInicio);
    const dataFimObj = new Date(anoFim, mesFim - 1, diaFim);
    
    if (dataFimObj < dataInicioObj) {
      alert('A data de fim deve ser maior ou igual à data de início.');
      return;
    }

    // Verifica se há empresas carregadas
    if (this.execucoes.length === 0) {
      alert('Nenhuma empresa carregada. Por favor, carregue as empresas validadas primeiro.');
      return;
    }

    // Verifica se já há execuções em andamento
    const executandoOuFila = this.execucoes.filter(
      e => e.status === 'executando' || (e.status === 'fila' && e.mensagem !== 'Aguardando início...')
    );
    
    if (executandoOuFila.length > 0) {
      console.warn('[Iniciar] Já existem execuções em andamento:', executandoOuFila.length);
      alert('Já existem execuções em andamento ou na fila. Aguarde a conclusão ou limpe as execuções.');
      return;
    }

    // Prepara lista de empresas para adicionar à fila
    const empresas = this.execucoes
      .filter(exec => exec.status === 'fila' && exec.mensagem === 'Aguardando início...')
      .map(exec => ({
        empresa_id: exec.empresa_id || exec.cnpj,
        cnpj: exec.cnpj,
        tipo_autenticacao: exec.tipoAutenticacao || 'certificado'
      }));

    if (empresas.length === 0) {
      alert('Nenhuma empresa pendente para iniciar.');
      return;
    }

    this.carregandoCertificados = true;

    try {
      const request: MultiplasExecucoesRequest = {
        empresas: empresas,
        dataInicio: this.dataInicio,
        dataFim: this.dataFim,
        tipo: this.tipoNotas,
        headless: this.headlessMode,
        contabilidade_id: this.contabilidadeSelecionada ?? undefined,
      };

      console.log('[Iniciar] Enviando requisição ao backend:', JSON.stringify(request, null, 2));

      // Chama backend para adicionar todas à fila
      const response = await firstValueFrom(
        this.execucaoService.adicionarMultiplasExecucoes(request)
      );

      console.log('[Iniciar] Resposta recebida do backend:', response);

      // Armazena batch_id e conecta ao stream SSE
      if (response.batch_id) {
        this.batchId = response.batch_id;
        this.streamSubscription?.unsubscribe();
        this.streamSubscription = this.execucaoService
          .streamExecucoes(response.batch_id)
          .pipe(takeUntil(this.destroy$))
          .subscribe((ev) => this.handleStreamEvent(ev));
      }

      // Cria um mapa de CNPJ para execução existente
      const execMap = new Map<string, ExecucaoEmpresa>();
      this.execucoes.forEach(exec => {
        execMap.set(exec.cnpj, exec);
      });

      // Atualiza execuções com os dados retornados do backend
      this.execucoes = response.execucoes.map((exec) => {
        const cnpjLimpo = exec.cnpj || '';
        const execExistente = execMap.get(cnpjLimpo);
        return {
          id: execExistente?.id || `${Date.now()}-${exec.empresa_id}-${cnpjLimpo}`,
          empresa_id: exec.empresa_id,
          cnpj: cnpjLimpo,
          nomeEmpresa: execExistente?.nomeEmpresa || cnpjLimpo,
          status: this.mapearStatusBackendParaFrontend(exec.status),
          progresso: exec.progresso || 0,
          logs: exec.logs || [],
          mensagem: exec.mensagem || 'Aguardando execução...',
          dataInicio: exec.data_inicio ? new Date(exec.data_inicio) : new Date(),
          mostrarLogs: false,
          tipoAutenticacao: execExistente?.tipoAutenticacao || 'certificado',
        };
      });

      // Sincroniza executionRows com status iniciais (EM_EXECUCAO/FILA conforme backend)
      this.executionRows = this.executionRows.map((row) => {
        const exec = this.execucoes.find((e) => String(e.empresa_id) === String(row.empresa_id) || e.cnpj === row.cnpj);
        if (exec) {
          const statusRow: ExecutionRowStatus = exec.status === 'executando' ? 'EM_EXECUCAO' : exec.status === 'fila' ? 'FILA' : exec.status === 'finalizado' ? 'OK' : exec.status === 'falhou' ? 'ERRO' : 'FILA';
          return {
            ...row,
            status: statusRow,
            mensagem: exec.mensagem || row.mensagem,
          };
        }
        return row;
      });

      this.atualizarExecucoesFinalizadasFiltradas();

      // Polling: 1 request por batch (evita N requests e crash da UI)
      if (response.batch_id) {
        this.iniciarPollingBatch(response.batch_id);
      } else {
        this.execucoes.forEach((execucao) => {
          const empresaId = execucao.empresa_id || execucao.cnpj;
          this.iniciarPollingStatus(execucao, empresaId);
        });
      }

      // Mostra mensagem de sucesso/erro
      const started = response.started ?? response.sucesso ?? 0;
      if (response.erros > 0) {
        console.warn(`${response.erros} empresas falharam ao serem adicionadas à fila:`, response.detalhes_erros);
        alert(`${started} empresas adicionadas à fila. ${response.erros} empresas falharam.`);
      } else {
        console.log(`${started} empresas adicionadas à fila com sucesso`);
      }

    } catch (error: any) {
      console.error('[Iniciar] Erro ao iniciar execuções:', error);
      
      let mensagemErro = 'Erro desconhecido ao iniciar execuções.';
      if (error.status === 0) {
        mensagemErro = 'Não foi possível conectar ao servidor. Verifique se o backend está rodando em http://localhost:8000';
      } else if (error.status === 404) {
        mensagemErro = 'Endpoint não encontrado. Verifique se a rota /api/execucao/multiplas existe no backend.';
      } else if (error.status === 500) {
        mensagemErro = `Erro no servidor: ${error.error?.detail || error.message || 'Erro interno do servidor'}`;
      } else if (error.error?.detail) {
        mensagemErro = error.error.detail;
      } else if (error.message) {
        mensagemErro = error.message;
      }
      
      alert(`Erro ao iniciar execuções: ${mensagemErro}`);
    } finally {
      this.carregandoCertificados = false;
      console.log('[Iniciar] Inicialização finalizada');
    }
  }

  /** Polling em lote: 1 request para todo o batch (evita crash quando muitas empresas) */
  private iniciarPollingBatch(batchId: string) {
    if (this.batchPollingInterval) {
      clearInterval(this.batchPollingInterval);
    }
    const intervalo = setInterval(async () => {
      try {
        const res = await firstValueFrom(this.execucaoService.obterStatusBatch(batchId));
        const statuses = res.execucoes || [];
        if (statuses.length === 0) {
          const temPendentes = this.executionRows.some(
            (r) => r.status === 'FILA' || r.status === 'EM_EXECUCAO'
          );
          if (!temPendentes) {
            clearInterval(intervalo);
            this.batchPollingInterval = null;
            return;
          }
        }
        this.aplicarStatusBatch(statuses);
      } catch {
        /* ignora erro de rede */
      }
    }, 2500);
    this.batchPollingInterval = intervalo;
  }

  private aplicarStatusBatch(statuses: ExecucaoStatusResponse[]) {
    if (statuses.length === 0) return;
    const execUpdates: Array<{ idx: number; upd: Partial<ExecucaoEmpresa> }> = [];
    const rowUpdates: Array<{ idx: number; status: ExecutionRowStatus; mensagem: string; qtdE: number; qtdR: number; qtdC: number }> = [];
    for (const s of statuses) {
      const empresaId = String(s.empresa_id ?? '');
      const cnpj = String(s.cnpj ?? '');
      const execIdx = this.execucoes.findIndex(
        (e) => String(e.empresa_id) === empresaId || e.cnpj === cnpj
      );
      const rowIdx = this.executionRows.findIndex(
        (r) => String(r.empresa_id) === empresaId || r.cnpj === cnpj
      );
      if (execIdx >= 0 && rowIdx >= 0) {
        const statusMap = this.mapearStatusBackendParaFrontend(String(s.status ?? ''));
        const statusRow: ExecutionRowStatus = statusMap === 'executando' ? 'EM_EXECUCAO' : statusMap === 'fila' ? 'FILA' : statusMap === 'finalizado' ? 'OK' : statusMap === 'falhou' ? 'ERRO' : 'FILA';
        const qtdE = s.qtd_notas_emitidas ?? 0;
        const qtdR = s.qtd_notas_recebidas ?? 0;
        const qtdC = s.qtd_notas_canceladas ?? 0;
        execUpdates.push({ idx: execIdx, upd: {
          status: statusMap,
          progresso: s.progresso ?? 0,
          mensagem: s.mensagem ?? '',
          logs: s.logs ?? [],
          etapa_atual: s.etapa_atual ?? '',
          erro: s.erro,
          qtdNotasEmitidas: qtdE,
          qtdNotasRecebidas: qtdR,
          qtdNotasCanceladas: qtdC,
          resultadoFinal: (s.resultado_final as ResultadoFinal) ?? undefined,
        }});
        rowUpdates.push({ idx: rowIdx, status: statusRow, mensagem: statusRow === 'ERRO' ? (s.mensagem || s.erro || '') : '', qtdE, qtdR, qtdC });
      }
    }
    if (execUpdates.length === 0) return;
    let execucoes = [...this.execucoes];
    let executionRows = [...this.executionRows];
    for (const { idx, upd } of execUpdates) {
      execucoes = [...execucoes.slice(0, idx), { ...execucoes[idx], ...upd }, ...execucoes.slice(idx + 1)];
    }
    for (const { idx, status, mensagem, qtdE, qtdR, qtdC } of rowUpdates) {
      executionRows = [...executionRows.slice(0, idx), { ...executionRows[idx], status, mensagem, qtd_emitidas: qtdE, qtd_recebidas: qtdR, qtd_canceladas: qtdC }, ...executionRows.slice(idx + 1)];
    }
    this.execucoes = execucoes;
    this.executionRows = executionRows;
    this.atualizarExecucoesFinalizadasFiltradas();
    this.cdr.markForCheck();
  }

  private iniciarPollingStatus(execucao: ExecucaoEmpresa, empresaId: string) {
    if (this.intervalosStatus.has(execucao.id)) {
      clearInterval(this.intervalosStatus.get(execucao.id));
    }

    let tentativasErro404 = 0;
    const maxTentativas404 = 3;

    const intervalo = setInterval(async () => {
      try {
        const status = await firstValueFrom(
          this.execucaoService.obterStatusExecucao(empresaId)
        );

        tentativasErro404 = 0;
        tentativasErro404 = 0;

        // Atualiza execução (sem remover do array)
        this.atualizarStatusExecucao(execucao.id, {
          status: this.mapearStatusBackendParaFrontend(status.status),
          progresso: status.progresso,
          mensagem: status.mensagem,
          logs: status.logs || [],
          etapa_atual: status.etapa_atual,
          urlAtual: status.url_atual,
          titulo: status.titulo,
          erro: status.erro,
          qtdNotasEmitidas: status.qtd_notas_emitidas || 0,
          qtdNotasRecebidas: status.qtd_notas_recebidas || 0,
          qtdNotasCanceladas: status.qtd_notas_canceladas || 0,
          resultadoFinal: status.resultado_final as ResultadoFinal | undefined,
          dataInicio: status.data_inicio ? new Date(status.data_inicio) : execucao.dataInicio,
          dataFim: status.data_fim ? new Date(status.data_fim) : execucao.dataFim
        });
        
        // Atualiza lista filtrada se a execução foi finalizada
        if (status.status === 'concluido') {
          this.atualizarExecucoesFinalizadasFiltradas();
        }

        const statusMapeado = this.mapearStatusBackendParaFrontend(status.status);
        if (statusMapeado === 'finalizado' || statusMapeado === 'falhou') {
          clearInterval(intervalo);
          this.intervalosStatus.delete(execucao.id);
        }
      } catch (error: any) {
        // 404 = execução foi removida do backend (normal quando termina com OK ou ERRO)
        // NÃO sobrescrever se já temos status final (SSE pode ter atualizado antes)
        if (error.status === 404 || error.statusCode === 404) {
          const rowAtual = this.executionRows.find(
            (r) => String(r.empresa_id) === String(empresaId) || r.cnpj === execucao.cnpj
          );
          if (rowAtual && (rowAtual.status === 'OK' || rowAtual.status === 'ERRO')) {
            // Execução já finalizada via SSE - 404 é esperado, só para o polling
            clearInterval(intervalo);
            this.intervalosStatus.delete(execucao.id);
            return;
          }

          tentativasErro404++;
          if (tentativasErro404 >= maxTentativas404) {
            clearInterval(intervalo);
            this.intervalosStatus.delete(execucao.id);
            this.atualizarStatusExecucao(execucao.id, {
              status: 'falhou',
              mensagem: 'Execução não encontrada no servidor. Verifique se foi iniciada corretamente.',
              erro: error.error?.detail || 'Execução não encontrada',
              dataFim: new Date()
            });
          }
        }
      }
    }, 2000);

    this.intervalosStatus.set(execucao.id, intervalo);
  }

  // Atualiza uma execução no array sem removê-la e sincroniza executionRows
  private atualizarStatusExecucao(id: string, atualizacoes: Partial<ExecucaoEmpresa>) {
    const idx = this.execucoes.findIndex(e => e.id === id);
    if (idx >= 0) {
      const atualizada: ExecucaoEmpresa = {
        ...this.execucoes[idx],
        ...atualizacoes
      };
      this.execucoes = [
        ...this.execucoes.slice(0, idx),
        atualizada,
        ...this.execucoes.slice(idx + 1),
      ];

      const statusRow: ExecutionRowStatus = atualizada.status === 'executando' ? 'EM_EXECUCAO' : atualizada.status === 'fila' ? 'FILA' : atualizada.status === 'finalizado' ? 'OK' : atualizada.status === 'falhou' ? 'ERRO' : 'FILA';
      const rowIdx = this.executionRows.findIndex((r) => String(r.empresa_id) === String(atualizada.empresa_id) || r.cnpj === atualizada.cnpj);
      if (rowIdx >= 0) {
        this.executionRows = [
          ...this.executionRows.slice(0, rowIdx),
          {
            ...this.executionRows[rowIdx],
            status: statusRow,
            mensagem: statusRow === 'OK' || statusRow === 'ERRO' ? (statusRow === 'ERRO' ? (atualizada.erro || atualizada.mensagem || '') : '') : (atualizada.mensagem || this.executionRows[rowIdx].mensagem),
            qtd_emitidas: atualizada.qtdNotasEmitidas ?? this.executionRows[rowIdx].qtd_emitidas,
            qtd_recebidas: atualizada.qtdNotasRecebidas ?? this.executionRows[rowIdx].qtd_recebidas,
            qtd_canceladas: atualizada.qtdNotasCanceladas ?? this.executionRows[rowIdx].qtd_canceladas ?? 0,
          },
          ...this.executionRows.slice(rowIdx + 1),
        ];
      }
      
      if (atualizada.status === 'finalizado') {
        this.atualizarExecucoesFinalizadasFiltradas();
      }
      this.cdr.markForCheck();
    }
  }

  private handleStreamEvent(ev: ExecutionStreamEvent): void {
    const empresaId = ev.empresa_id;
    const idx = this.executionRows.findIndex((r) => String(r.empresa_id) === String(empresaId));
    if (idx < 0) return;

    const row = this.executionRows[idx];
    let next: Partial<ExecutionRow> = {};

    if (ev.type === 'execution:started') {
      next = { status: 'EM_EXECUCAO', mensagem: 'Abrindo navegador…', razao_social: ev.razao_social || row.razao_social, metodo: ev.metodo };
    } else if (ev.type === 'execution:stage') {
      next = { status: 'EM_EXECUCAO', mensagem: ev.message };
    } else if (ev.type === 'execution:counts') {
      next = {
        qtd_emitidas: ev.qtd_emitidas,
        qtd_recebidas: ev.qtd_recebidas,
        qtd_canceladas: ev.qtd_canceladas ?? row.qtd_canceladas ?? 0,
      };
    } else if (ev.type === 'execution:finished') {
      next = {
        status: ev.status as ExecutionRowStatus,
        mensagem: ev.status === 'OK' ? '' : (ev.message || ''),
        qtd_emitidas: ev.qtd_emitidas ?? row.qtd_emitidas,
        qtd_recebidas: ev.qtd_recebidas ?? row.qtd_recebidas,
        qtd_canceladas: ev.qtd_canceladas ?? row.qtd_canceladas ?? 0,
      };
      const execIdx = this.execucoes.findIndex((e) => String(e.empresa_id) === String(empresaId) || e.cnpj === row.cnpj);
      if (execIdx >= 0) {
        const statusExec = ev.status === 'OK' ? 'finalizado' : 'falhou';
        const qtdE = ev.qtd_emitidas ?? row.qtd_emitidas ?? 0;
        const qtdR = ev.qtd_recebidas ?? row.qtd_recebidas ?? 0;
        let resultadoFinal: ResultadoFinal = 'SEM_MOVIMENTO';
        if (qtdE > 0 && qtdR > 0) resultadoFinal = 'NFS_ENCONTRADAS';
        else if (qtdE > 0) resultadoFinal = 'NOTAS_EMITIDAS';
        else if (qtdR > 0) resultadoFinal = 'NOTAS_RECEBIDAS';
        this.execucoes = [
          ...this.execucoes.slice(0, execIdx),
          {
            ...this.execucoes[execIdx],
            status: statusExec as StatusExecucao,
            mensagem: ev.message || '',
            erro: ev.status === 'ERRO' ? ev.message : undefined,
            qtdNotasEmitidas: qtdE,
            qtdNotasRecebidas: qtdR,
            resultadoFinal: statusExec === 'finalizado' ? resultadoFinal : undefined,
            dataFim: new Date(),
          },
          ...this.execucoes.slice(execIdx + 1),
        ];
        this.atualizarExecucoesFinalizadasFiltradas();
      }
    }

    this.executionRows = [
      ...this.executionRows.slice(0, idx),
      { ...row, ...next },
      ...this.executionRows.slice(idx + 1),
    ];
    this.cdr.markForCheck();
  }

  // Mapeia status do backend para frontend
  private mapearStatusBackendParaFrontend(statusBackend: string): StatusExecucao {
    const mapeamento: Record<string, StatusExecucao> = {
      'pendente': 'fila',
      'em_execucao': 'executando',
      'concluido': 'finalizado',
      'falhou': 'falhou'
    };
    return mapeamento[statusBackend] || 'fila';
  }

  async executarCertificado(certificado: Certificado) {
    // Valida datas
    if (!this.dataInicio || !this.dataFim) {
      alert('Por favor, informe a data de início e data de fim.');
      return;
    }
    
    // Valida formato das datas (DD/MM/YYYY)
    const dataInicioRegex = /^\d{2}\/\d{2}\/\d{4}$/;
    const dataFimRegex = /^\d{2}\/\d{2}\/\d{4}$/;
    
    if (!dataInicioRegex.test(this.dataInicio) || !dataFimRegex.test(this.dataFim)) {
      alert('Por favor, informe as datas no formato DD/MM/YYYY (ex: 01/12/2025).');
      return;
    }

    try {
      const empresaId = certificado.cnpj.replace(/[^\d]/g, '');
      
      // Chama o backend para adicionar à fila
      const response = await firstValueFrom(
        this.execucaoService.executarEmpresa(
          empresaId,
          this.dataInicio,
          this.dataFim,
          this.tipoNotas,
          this.headlessMode
        )
      );

      // Adiciona à lista de execuções se não existir
      let execucaoExistente = this.execucoes.find(e => e.cnpj === certificado.cnpj);
      if (!execucaoExistente) {
        execucaoExistente = {
          id: `${Date.now()}-${certificado.cnpj}`,
          empresa_id: response.empresa_id,
          cnpj: certificado.cnpj.replace(/[^\d]/g, ''),
          nomeEmpresa: certificado.nomeArquivo,
          status: this.mapearStatusBackendParaFrontend(response.status),
          progresso: response.progresso,
          logs: response.logs || [],
          mensagem: response.mensagem,
          dataInicio: response.data_inicio ? new Date(response.data_inicio) : new Date(),
          mostrarLogs: false
        };
        this.execucoes.push(execucaoExistente);
      } else {
        // Atualiza execução existente
        this.atualizarStatusExecucao(execucaoExistente.id, {
          empresa_id: response.empresa_id,
          status: this.mapearStatusBackendParaFrontend(response.status),
          progresso: response.progresso,
          mensagem: response.mensagem,
          logs: response.logs || []
        });
      }

      // Inicia polling
      const idParaPolling = response.empresa_id || empresaId;
      this.iniciarPollingStatus(execucaoExistente, idParaPolling);

    } catch (error: any) {
      console.error('Erro ao executar certificado:', error);
      alert(`Erro ao executar: ${error.error?.detail || error.message || 'Erro desconhecido'}`);
    }
  }

  limparExecucoes() {
    if (confirm('Tem certeza que deseja limpar todas as execuções?')) {
      this.streamSubscription?.unsubscribe();
      this.streamSubscription = null;
      this.executionStarted = false;
      this.execucoes = [];
      this.executionRows = [];
      this.execucoesFinalizadasFiltradas = [];
      this.searchValue = '';
      this.sortState = { column: null, direction: null };
      this.batchId = null;
      this.logSalvo = false;
    }
  }

  async salvarLog() {
    if (!this.podeSalvarLog || !this.batchId) return;

    this.isSavingLog = true;
    try {
      const competencia = this.obterCompetencia();
      const totais = this.obterTotaisParaLog();
      const itens = this.obterItensParaLog();

      const payload: ExecutionBatchLogPayload = {
        batch_id: this.batchId,
        contabilidade_id: String(this.contabilidadeSelecionada ?? ''),
        competencia,
        dataInicio: this.converterDataParaYYYYMMDD(this.dataInicio),
        dataFim: this.converterDataParaYYYYMMDD(this.dataFim),
        tipo: this.tipoNotas,
        headless: this.headlessMode,
        totais: {
          total_empresas: totais.total_empresas,
          total_sucesso: totais.total_sucesso,
          total_falha: totais.total_falha,
          total_emitidas: totais.total_emitidas,
          total_recebidas: totais.total_recebidas,
          totais_por_resultado: totais.totais_por_resultado,
        },
        itens,
      };

      await firstValueFrom(this.execucaoLogsService.saveExecutionLog(payload));
      this.logSalvo = true;
      this.toastService.success('Log salvo com sucesso');
      this.cdr.markForCheck();
    } catch (error: unknown) {
      const err = error as { status?: number; error?: { detail?: string } };
      if (err.status === 409) {
        this.toastService.error('Log já existe');
        this.logSalvo = true;
      } else {
        this.toastService.error('Erro ao salvar log. Tente novamente.');
      }
      this.cdr.markForCheck();
    } finally {
      this.isSavingLog = false;
    }
  }

  private obterCompetencia(): string {
    if (this.dataInicio && this.dataInicio.length === 10) {
      const [dia, mes, ano] = this.dataInicio.split('/');
      return `${ano}-${mes}`;
    }
    const now = new Date();
    const mes = String(now.getMonth() + 1).padStart(2, '0');
    return `${now.getFullYear()}-${mes}`;
  }

  private converterDataParaYYYYMMDD(ddmmyyyy: string): string | null {
    if (!ddmmyyyy || ddmmyyyy.length !== 10) return null;
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(ddmmyyyy);
    if (!match) return null;
    return `${match[3]}-${match[2]}-${match[1]}`;
  }

  private obterTotaisParaLog(): {
    total_empresas: number;
    total_sucesso: number;
    total_falha: number;
    total_emitidas: number;
    total_recebidas: number;
    totais_por_resultado: Record<string, number>;
  } {
    const total_empresas = this.execucoes.length;
    const total_sucesso = this.execucoes.filter(e => e.status === 'finalizado').length;
    const total_falha = this.execucoes.filter(e => e.status === 'falhou').length;
    const total_emitidas = this.execucoes.reduce((s, e) => s + (e.qtdNotasEmitidas ?? 0), 0);
    const total_recebidas = this.execucoes.reduce((s, e) => s + (e.qtdNotasRecebidas ?? 0), 0);

    const totais_por_resultado: Record<string, number> = {};
    for (const e of this.execucoes) {
      if (e.status === 'finalizado' && e.resultadoFinal) {
        totais_por_resultado[e.resultadoFinal] = (totais_por_resultado[e.resultadoFinal] ?? 0) + 1;
      }
    }
    return { total_empresas, total_sucesso, total_falha, total_emitidas, total_recebidas, totais_por_resultado };
  }

  private obterItensParaLog(): ExecutionBatchLogItem[] {
    return this.execucoes
      .filter(e => e.status === 'finalizado' || e.status === 'falhou')
      .map(e => ({
        empresa_id: e.empresa_id ?? e.cnpj ?? '',
        cnpj: e.cnpj ?? '',
        nome_empresa: e.nomeEmpresa ?? '',
        tipo_autenticacao: (e.tipoAutenticacao ?? 'certificado') as 'certificado' | 'credenciais',
        status_final: e.status as 'finalizado' | 'falhou',
        qtd_emitidas: e.qtdNotasEmitidas ?? 0,
        qtd_recebidas: e.qtdNotasRecebidas ?? 0,
        resultado_final: e.resultadoFinal,
        started_at: e.dataInicio?.toISOString(),
        finished_at: e.dataFim?.toISOString(),
        erro_msg: e.erro,
      }));
  }

  formatarCNPJ(cnpj: string): string {
    return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  }

  obterCorStatus(status: StatusExecucao): string {
    switch (status) {
      case 'fila':
        return 'border-[#7EBFB3]/30 bg-[#A9D9D4]/10';
      case 'finalizado':
        return 'border-[#8BCB70]/50 bg-[#8BCB70]/10';
      case 'falhou':
        return 'border-red-500/50 bg-red-500/10';
      case 'executando':
        return 'border-[#8BCB70]/50 bg-[#8BCB70]/20';
      default:
        return 'border-[#7EBFB3]/30 bg-[#A9D9D4]/10';
    }
  }

  obterCorTextoStatus(status: StatusExecucao): string {
    switch (status) {
      case 'fila':
        return 'text-[#1E2615]';
      case 'finalizado':
        return 'text-[#8BCB70]';
      case 'falhou':
        return 'text-red-600';
      case 'executando':
        return 'text-[#8BCB70]';
      default:
        return 'text-[#1E2615]';
    }
  }

  obterTextoStatus(status: StatusExecucao): string {
    switch (status) {
      case 'finalizado':
        return 'Finalizado';
      case 'falhou':
        return 'Falhou';
      case 'executando':
        return 'Executando';
      case 'fila':
        return 'Fila';
      default:
        return 'Pendente';
    }
  }

  // Relatório Excel (colunas conforme print: CNPJ, Razão Social, Método, NF Emitidas, NF Recebidas, NF Canceladas)
  async gerarResumo() {
    const linhasParaExportar = this.executionRows.filter((r) => r.status === 'OK' || r.status === 'ERRO');

    if (linhasParaExportar.length === 0) {
      alert('Não há execuções finalizadas para gerar o resumo.');
      return;
    }

    try {
      this.carregandoResumo = true;
      this.gerarExcelResumo(linhasParaExportar);
    } catch (error) {
      console.error('Erro ao gerar Excel:', error);
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido ao gerar Excel';
      alert(`Erro ao gerar resumo: ${errorMessage}`);
    } finally {
      this.carregandoResumo = false;
    }
  }

  gerarExcelResumo(linhas: ExecutionRow[]) {
    const dadosPlanilha = linhas.map((row) => ({
      'CNPJ': this.formatarCNPJ(row.cnpj),
      'Razão Social': row.razao_social || '-',
      'Método': row.metodo === 'CERTIFICADO' ? 'Certificado' : 'Credencial',
      'NF Emitidas': row.qtd_emitidas ?? 0,
      'NF Recebidas': row.qtd_recebidas ?? 0,
      'NF Canceladas': row.qtd_canceladas ?? 0,
    }));

    const ws = XLSX.utils.json_to_sheet(dadosPlanilha);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Execuções');

    const colWidths = [
      { wch: 18 }, // CNPJ
      { wch: 35 }, // Razão Social
      { wch: 14 }, // Método
      { wch: 12 }, // NF Emitidas
      { wch: 14 }, // NF Recebidas
      { wch: 14 }, // NF Canceladas
    ];
    ws['!cols'] = colWidths;

    const dataFormatada = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const nomeArquivo = this.dataInicio && this.dataFim
      ? `resumo_execucoes_${this.dataInicio.replace(/\//g, '-')}_${this.dataFim.replace(/\//g, '-')}_${dataFormatada}.xlsx`
      : `resumo_execucoes_${dataFormatada}.xlsx`;

    XLSX.writeFile(wb, nomeArquivo);
  }

  obterTextoResultadoFinal(resultado?: ResultadoFinal): string {
    if (!resultado) {
      return 'Sem informação';
    }
    
    switch (resultado) {
      case 'SEM_MOVIMENTO':
        return 'Sem movimento';
      case 'NOTAS_EMITIDAS':
        return 'Notas Emitidas';
      case 'NOTAS_RECEBIDAS':
        return 'Notas Recebidas';
      case 'NFS_ENCONTRADAS':
        return 'Com notas (ambas)';
      default:
        return 'Sem informação';
    }
  }

  async baixarResumoCSV() {
    try {
      const blob = await firstValueFrom(
        this.execucaoService.baixarResumoCSV(undefined)
      );
      
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const nomeArquivo = this.dataInicio && this.dataFim 
        ? `resumo_execucoes_${this.dataInicio.replace(/\//g, '-')}_${this.dataFim.replace(/\//g, '-')}_${new Date().getTime()}.csv`
        : `resumo_execucoes_todas_${new Date().getTime()}.csv`;
      link.download = nomeArquivo;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Erro ao baixar CSV:', error);
      alert('Erro ao baixar CSV do resumo');
    }
  }

  fecharResumo() {
    this.mostrandoResumo = false;
    this.resumo = null;
  }
}
