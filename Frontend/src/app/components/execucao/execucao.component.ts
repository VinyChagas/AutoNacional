import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CertificadoService, Certificado, CertificadoResponse } from '../../services/certificado.service';
import { ExecucaoService, ExecucaoEmpresa, StatusExecucao, ResultadoFinal, ResumoExecucoesResponse, MultiplasExecucoesRequest } from '../../services/execucao.service';
import { ContabilidadeService } from '../../services/contabilidade.service';
import { EmpresasService } from '../../services/empresas.service';
import { Empresa } from '../../models/empresas.model';
import { Contabilidade } from '../../models/contabilidade.model';
import { Subject, takeUntil, firstValueFrom } from 'rxjs';
import jsPDF from 'jspdf';
// @ts-ignore - jspdf-autotable não tem tipos TypeScript completos
import autoTable from 'jspdf-autotable';

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
  
  // Contabilidade
  contabilidades: Contabilidade[] = [];
  contabilidadeSelecionada: number | null = null;
  carregandoContabilidades = false;
  
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
  private destroy$ = new Subject<void>();

  constructor(
    private certificadoService: CertificadoService,
    private execucaoService: ExecucaoService,
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

  ngOnDestroy() {
    // Limpa todos os intervalos de polling
    this.intervalosStatus.forEach(intervalo => clearInterval(intervalo));
    this.intervalosStatus.clear();
    
    this.destroy$.next();
    this.destroy$.complete();
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
    return this.execucoes.some(e => e.status === 'executando' || (e.status === 'fila' && e.mensagem !== 'Aguardando início...'));
  }

  // Getter para verificar se pode habilitar botão "Carregar Empresas Validadas"
  get podeCarregarEmpresas(): boolean {
    return this.contabilidadeSelecionada !== null && !this.carregandoCertificados;
  }

  // Getter para verificar se pode habilitar botão "Iniciar"
  get podeIniciar(): boolean {
    return this.execucoes.length > 0 && 
           this.execucoes.some(e => e.status === 'fila' && e.mensagem === 'Aguardando início...') &&
           !this.carregandoCertificados &&
           !this.temExecucoesEmAndamento;
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
    return this.execucoes.length;
  }

  get empresasFinalizadas(): number {
    return this.execucoes.filter(e => e.status === 'finalizado').length;
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
    // Não limpa seleções ao abrir o modal - mantém seleções anteriores se houver
    // this.empresasSelecionadas.clear();
    this.buscaEmpresa = ''; // Limpa apenas a busca

    try {
      // Busca certificados e empresas em paralelo
      // Certificados: empresas que usam autenticação por certificado
      // Empresas com has_cred: empresas que usam credenciais (login/senha)
      const [certificadosResponse, empresas] = await Promise.all([
        firstValueFrom(
          this.certificadoService.listarCertificadosPorContabilidade(this.contabilidadeSelecionada!)
        ),
        firstValueFrom(
          this.empresasService.listarPorContabilidade(this.contabilidadeSelecionada!, 0, 1000, true)
        )
      ]);
      
      // Filtra certificados: inclui todos; só exclui os que têm data_vencimento E estão vencidos
      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);
      
      this.certificadosDisponiveis = certificadosResponse.certificados.filter(cert => {
        if (!cert.data_vencimento) return true; // Sem data = considera válido
        const dataVencimento = new Date(cert.data_vencimento);
        if (isNaN(dataVencimento.getTime())) return true; // Data inválida = considera válido
        dataVencimento.setHours(0, 0, 0, 0);
        return dataVencimento >= hoje;
      });
      
      this.empresasDisponiveis = empresas;
      
      // Combina certificados e empresas em uma lista unificada
      this.empresasUnificadas = [
        ...this.certificadosDisponiveis.map(cert => {
          const id = `cert-${cert.id}`;
          // Armazena tipo de autenticação para certificados
          this.tiposAutenticacao.set(id, 'certificado');
          return {
            id: id,
            cnpj: cert.cnpj,
            nomeEmpresa: cert.empresa,
            tipo: 'certificado' as const,
            dataVencimento: cert.data_vencimento
          };
        }),
        ...this.empresasDisponiveis.map(emp => {
          const id = `emp-${emp.id}`;
          // Armazena tipo de autenticação para empresas (credenciais)
          this.tiposAutenticacao.set(id, 'credenciais');
          return {
            id: id,
            cnpj: emp.cnpj,
            nomeEmpresa: emp.razao_social,
            tipo: 'empresa' as const
          };
        })
      ];
      
      // Inicializa lista filtrada com todas as empresas unificadas
      this.filtrarCertificados();
      
      // Atualiza estado de "todos selecionados" após carregar
      this.atualizarEstadoTodosSelecionados();
    } catch (error: any) {
      console.error('Erro ao carregar empresas validadas:', error);
      alert('Erro ao carregar empresas validadas. Verifique se o backend está rodando.');
      this.modalSelecaoAberto = false;
    } finally {
      this.carregandoCertificadosDisponiveis = false;
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

    // Cria execuções pendentes (sem iniciar ainda)
    this.execucoes = empresasSelecionadas.map(emp => {
      const cnpjLimpo = emp.cnpj.replace(/[^\d]/g, '');
      const tipoAuth = this.tiposAutenticacao.get(emp.id) || (emp.tipo === 'certificado' ? 'certificado' : 'credenciais');
      return {
        id: `pendente-${emp.id}-${cnpjLimpo}`,
        empresa_id: cnpjLimpo, // Usa CNPJ como ID temporário
        cnpj: cnpjLimpo,
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

    // Limpa seleções
    this.empresasSelecionadas.clear();
    this.todosSelecionados = false;
  }

  async iniciar() {
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
        headless: this.headlessMode
      };

      console.log('[Iniciar] Enviando requisição ao backend:', JSON.stringify(request, null, 2));

      // Chama backend para adicionar todas à fila
      const response = await firstValueFrom(
        this.execucaoService.adicionarMultiplasExecucoes(request)
      );

      console.log('[Iniciar] Resposta recebida do backend:', response);

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
          tipoAutenticacao: execExistente?.tipoAutenticacao || 'certificado' // Preserva tipo de autenticação
        };
      });
      
      // Atualiza lista filtrada após carregar execuções
      this.atualizarExecucoesFinalizadasFiltradas();

      // Inicia polling para todas as execuções simultaneamente
      console.log('[Iniciar] Iniciando polling para', this.execucoes.length, 'execuções');
      this.execucoes.forEach((execucao) => {
        const empresaId = execucao.empresa_id || execucao.cnpj;
        console.log('[Iniciar] Iniciando polling para empresa:', empresaId, 'execução ID:', execucao.id);
        this.iniciarPollingStatus(execucao, empresaId);
      });

      // Mostra mensagem de sucesso/erro
      if (response.erros > 0) {
        console.warn(`${response.erros} empresas falharam ao serem adicionadas à fila:`, response.detalhes_erros);
        alert(`${response.sucesso} empresas adicionadas à fila. ${response.erros} empresas falharam.`);
      } else {
        console.log(`${response.sucesso} empresas adicionadas à fila com sucesso`);
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

  // Método removido - não é mais necessário executar sequencialmente
  // As execuções são adicionadas à fila e processadas simultaneamente pelo backend

  private iniciarPollingStatus(execucao: ExecucaoEmpresa, empresaId: string) {
    console.log(`[Polling] Iniciando polling para empresa ${empresaId}, execução ${execucao.id}`);
    
    // Limpa intervalo anterior se existir
    if (this.intervalosStatus.has(execucao.id)) {
      console.log(`[Polling] Limpando intervalo anterior para ${execucao.id}`);
      clearInterval(this.intervalosStatus.get(execucao.id));
    }

    let tentativasErro404 = 0;
    const maxTentativas404 = 3;
    let contadorPolling = 0;

    // Polling a cada 2 segundos
    const intervalo = setInterval(async () => {
      contadorPolling++;
      console.log(`[Polling] Verificando status da empresa ${empresaId} (tentativa ${contadorPolling})`);
      
      try {
        const status = await firstValueFrom(
          this.execucaoService.obterStatusExecucao(empresaId)
        );

        console.log(`[Polling] Status recebido para ${empresaId}:`, status);
        console.log(`[Polling] Detalhes completos do status:`, {
          empresa_id: status.empresa_id,
          cnpj: status.cnpj,
          status: status.status,
          etapa_atual: status.etapa_atual,
          progresso: status.progresso,
          mensagem: status.mensagem,
          erro: status.erro,
          logs: status.logs,
          url_atual: status.url_atual,
          titulo: status.titulo
        });

        // Reset contador de 404 se conseguir obter status
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
          resultadoFinal: status.resultado_final as ResultadoFinal | undefined,
          dataInicio: status.data_inicio ? new Date(status.data_inicio) : execucao.dataInicio,
          dataFim: status.data_fim ? new Date(status.data_fim) : execucao.dataFim
        });
        
        // Atualiza lista filtrada se a execução foi finalizada
        if (status.status === 'concluido') {
          this.atualizarExecucoesFinalizadasFiltradas();
        }

        // Se concluído ou falhou, para o polling
        const statusMapeado = this.mapearStatusBackendParaFrontend(status.status);
        console.log(`[Polling] Status mapeado para ${empresaId}: ${statusMapeado} (anterior: ${execucao.status})`);
        
        // Se falhou, mostra o erro detalhadamente
        if (statusMapeado === 'falhou') {
          console.error(`[Polling] ⚠️ EXECUÇÃO FALHOU para ${empresaId}:`);
          console.error(`[Polling] - Mensagem: ${status.mensagem || 'Sem mensagem'}`);
          console.error(`[Polling] - Erro: ${status.erro || 'Sem detalhes de erro'}`);
          console.error(`[Polling] - Etapa atual: ${status.etapa_atual || 'N/A'}`);
          console.error(`[Polling] - Logs completos:`, JSON.stringify(status.logs || [], null, 2));
          if (status.logs && status.logs.length > 0) {
            console.error(`[Polling] - Últimos logs:`, status.logs.slice(-5));
          }
        }
        
        if (statusMapeado === 'finalizado' || statusMapeado === 'falhou') {
          console.log(`[Polling] Execução ${statusMapeado} para ${empresaId}, parando polling`);
          clearInterval(intervalo);
          this.intervalosStatus.delete(execucao.id);
        } else {
          console.log(`[Polling] Execução ainda em andamento para ${empresaId}: ${statusMapeado}, continuando polling...`);
        }
      } catch (error: any) {
        console.error(`Erro ao obter status para empresa ${empresaId}:`, error);
        
        // Se for erro 404 (execução não encontrada), incrementa contador
        if (error.status === 404 || error.statusCode === 404) {
          tentativasErro404++;
          
          if (tentativasErro404 >= maxTentativas404) {
            // Para o polling após várias tentativas de 404
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

  // Atualiza uma execução no array sem removê-la
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
      
      // Atualiza lista filtrada se necessário
      if (atualizada.status === 'finalizado') {
        this.atualizarExecucoesFinalizadasFiltradas();
      }
    }
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
      this.execucoes = [];
      this.execucoesFinalizadasFiltradas = [];
      this.searchValue = '';
      this.sortState = { column: null, direction: null };
    }
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

  // Relatório
  async gerarResumo() {
    // Usa as execuções finalizadas filtradas (ou todas se não houver filtro aplicado)
    const execucoesParaPDF = this.execucoesFinalizadasFiltradas.length > 0 
      ? this.execucoesFinalizadasFiltradas 
      : this.colunaFinalizado;
    
    if (execucoesParaPDF.length === 0) {
      alert('Não há execuções finalizadas para gerar o resumo.');
      return;
    }

    try {
      this.carregandoResumo = true;
      this.gerarPDFResumo(execucoesParaPDF);
    } catch (error) {
      console.error('Erro ao gerar PDF:', error);
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido ao gerar PDF';
      alert(`Erro ao gerar PDF do resumo: ${errorMessage}`);
    } finally {
      this.carregandoResumo = false;
    }
  }

  gerarPDFResumo(execucoes: ExecucaoEmpresa[]) {
    const doc = new jsPDF();
    
    try {
      
      // Título
      doc.setFontSize(18);
      doc.setTextColor(12, 13, 10); // #0C0D0A
      doc.setFont('helvetica', 'bold');
      doc.text('Resumo de Execuções - Automação NFSe', 14, 20);
      
      // Subtítulo com data/hora e período
      doc.setFontSize(10);
      doc.setTextColor(30, 38, 21); // #1E2615
      doc.setFont('helvetica', 'normal');
      const dataHora = new Date().toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
      doc.text(`Gerado em: ${dataHora}`, 14, 28);
      
      // Adiciona período se disponível
      if (this.dataInicio && this.dataFim) {
        doc.text(`Período: ${this.dataInicio} até ${this.dataFim}`, 14, 34);
      }
      
      // Estatísticas gerais
      const totalEmpresas = execucoes.length;
      const comMovimento = execucoes.filter(e => 
        e.resultadoFinal && e.resultadoFinal !== 'SEM_MOVIMENTO'
      ).length;
      const semMovimento = execucoes.filter(e => 
        e.resultadoFinal === 'SEM_MOVIMENTO'
      ).length;
      
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text(`Total de empresas: ${totalEmpresas}`, 14, 42);
      doc.text(`Com movimento: ${comMovimento}`, 14, 48);
      doc.text(`Sem movimento: ${semMovimento}`, 14, 54);
      
      // Separar execuções por grupos de status
      const grupos = {
        ambas: execucoes.filter(e => e.resultadoFinal === 'NFS_ENCONTRADAS'),
        emitidas: execucoes.filter(e => e.resultadoFinal === 'NOTAS_EMITIDAS'),
        recebidas: execucoes.filter(e => e.resultadoFinal === 'NOTAS_RECEBIDAS'),
        semMovimento: execucoes.filter(e => e.resultadoFinal === 'SEM_MOVIMENTO')
      };
      
      // Função auxiliar para preparar dados da tabela (mesma estrutura da tela)
      const prepararDadosTabela = (execucoesGrupo: ExecucaoEmpresa[]) => {
        return execucoesGrupo.map(exec => {
          const nomeEmpresa = exec.nomeEmpresa || exec.cnpj || '-';
          const cnpjFormatado = exec.cnpj ? this.formatarCNPJ(exec.cnpj) : '-';
          const status = this.obterTextoResultadoFinal(exec.resultadoFinal);
          const emitidas = exec.qtdNotasEmitidas !== undefined && exec.qtdNotasEmitidas > 0 
            ? exec.qtdNotasEmitidas.toString() 
            : '-';
          const recebidas = exec.qtdNotasRecebidas !== undefined && exec.qtdNotasRecebidas > 0 
            ? exec.qtdNotasRecebidas.toString() 
            : '-';
          
          return {
            cnpj: cnpjFormatado,
            nome: nomeEmpresa,
            status: status,
            resultadoFinal: exec.resultadoFinal,
            emitidas: emitidas,
            recebidas: recebidas
          };
        });
      };
      
      // Função auxiliar para criar tabela com tratamento de paginação
      const criarTabela = (tableData: any[], tituloGrupo: string, startY: number, isUltimaPagina: boolean = false) => {
        if (tableData.length === 0) return startY;
        
        // Se for a última página, força nova página antes
        if (isUltimaPagina) {
          doc.addPage();
          startY = 20; // Reset para o topo da nova página
        }
        
        // Verifica se há espaço suficiente na página atual
        const pageHeight = doc.internal.pageSize.height;
        const espacoNecessario = 30 + (tableData.length * 8); // Título + linhas
        const espacoDisponivel = pageHeight - startY - 25; // Margem inferior
        
        // Se não houver espaço suficiente e não for a primeira tabela, cria nova página
        if (espacoDisponivel < espacoNecessario && startY > 60) {
          doc.addPage();
          startY = 20;
        }
        
        // Adiciona título do grupo
        doc.setFontSize(14);
        doc.setTextColor(12, 13, 10);
        doc.setFont('helvetica', 'bold');
        doc.text(tituloGrupo, 14, startY);
        
        const yPosAposTitulo = startY + 8;
        
        // Converte dados para formato de array para autoTable
        const bodyData = tableData.map(row => [
          row.cnpj,
          row.nome,
          row.status,
          row.emitidas,
          row.recebidas
        ]);
        
        // Criar tabela com mesma estrutura da tela
        autoTable(doc, {
          startY: yPosAposTitulo,
          head: [['CNPJ', 'Nome da Empresa', 'Status', 'Emitidas', 'Recebidas']],
          body: bodyData,
          theme: 'striped',
          headStyles: {
            fillColor: [139, 203, 112], // #8BCB70
            textColor: [12, 13, 10], // #0C0D0A
            fontStyle: 'bold',
            fontSize: 10,
            halign: 'left',
            cellPadding: { top: 5, bottom: 5, left: 4, right: 4 }
          },
          bodyStyles: {
            textColor: [30, 38, 21], // #1E2615
            fontSize: 9,
            halign: 'left',
            valign: 'middle',
            cellPadding: { top: 4, bottom: 4, left: 4, right: 4 }
          },
          alternateRowStyles: {
            fillColor: [240, 248, 247] // Cor clara alternativa (#A9D9D4 em RGB claro)
          },
          columnStyles: {
            0: { cellWidth: 45, overflow: 'linebreak' }, // CNPJ
            1: { cellWidth: 70, overflow: 'linebreak' }, // Nome da Empresa
            2: { cellWidth: 35, overflow: 'linebreak' }, // Status
            3: { cellWidth: 25, halign: 'center' }, // Emitidas
            4: { cellWidth: 25, halign: 'center' }  // Recebidas
          },
          margin: { top: yPosAposTitulo, left: 14, right: 14, bottom: 25 },
          styles: {
            overflow: 'linebreak',
            cellWidth: 'wrap',
            cellPadding: { top: 4, bottom: 4, left: 4, right: 4 },
            lineWidth: 0.1
          },
          pageBreak: 'auto',
          rowPageBreak: 'avoid',
          showHead: 'everyPage',
          didDrawPage: (data: any) => {
            // Adiciona número da página no rodapé
            const pageHeight = doc.internal.pageSize.height;
            const pageWidth = doc.internal.pageSize.width;
            
            doc.setFontSize(8);
            doc.setTextColor(150, 150, 150);
            doc.setFont('helvetica', 'normal');
            doc.text(
              `Página ${data.pageNumber}`,
              pageWidth / 2,
              pageHeight - 10,
              { align: 'center' }
            );
          },
          // Aplica cores diferentes para células de status baseado no resultadoFinal
          didParseCell: (data: any) => {
            try {
              // Aplica estilo na coluna de Status (índice 2)
              if (data.column && data.column.index === 2 && data.row && data.row.index >= 0) {
                const rowIndex = data.row.index;
                if (rowIndex < tableData.length) {
                  const resultadoFinal = tableData[rowIndex]?.resultadoFinal;
                  
                  if (resultadoFinal === 'NFS_ENCONTRADAS') {
                    // Verde claro para "Com notas (ambas)"
                    data.cell.styles.fillColor = [139, 203, 112]; // #8BCB70
                    data.cell.styles.textColor = [12, 13, 10]; // #0C0D0A
                  } else if (resultadoFinal === 'NOTAS_EMITIDAS') {
                    // Azul para "Notas Emitidas"
                    data.cell.styles.fillColor = [191, 219, 254]; // Azul claro
                    data.cell.styles.textColor = [30, 64, 175]; // Azul escuro
                  } else if (resultadoFinal === 'NOTAS_RECEBIDAS') {
                    // Roxo para "Notas Recebidas"
                    data.cell.styles.fillColor = [221, 214, 254]; // Roxo claro
                    data.cell.styles.textColor = [107, 33, 168]; // Roxo escuro
                  } else if (resultadoFinal === 'SEM_MOVIMENTO') {
                    // Cinza para "Sem movimento"
                    data.cell.styles.fillColor = [229, 231, 235]; // Cinza claro
                    data.cell.styles.textColor = [55, 65, 81]; // Cinza escuro
                  }
                }
              }
            } catch (e) {
              // Ignora erros no didParseCell para não quebrar a geração do PDF
              console.warn('Erro ao aplicar estilo na célula:', e);
            }
          }
        });
        
        // Obtém a posição Y final após a tabela de forma segura
        let finalY = yPosAposTitulo;
        try {
          const lastTable = (doc as any).lastAutoTable;
          if (lastTable && lastTable.finalY !== undefined) {
            finalY = lastTable.finalY;
          } else {
            // Fallback: usa a altura da página menos margem
            finalY = pageHeight - 25;
          }
        } catch (e) {
          // Se houver erro, usa altura da página menos margem
          finalY = pageHeight - 25;
        }
        
        // Garante que não ultrapasse o limite da página
        if (finalY > pageHeight - 25) {
          finalY = pageHeight - 25;
        }
        
        return finalY + 10; // Adiciona espaçamento após a tabela
      };
      
      // Função auxiliar para obter Y atual de forma segura
      const obterYAtual = () => {
        try {
          const lastTable = (doc as any).lastAutoTable;
          if (lastTable && lastTable.finalY !== undefined) {
            const pageHeight = doc.internal.pageSize.height;
            // Se o finalY está muito próximo do fim da página, retorna início da próxima página
            if (lastTable.finalY > pageHeight - 30) {
              return 20; // Próxima página
            }
            return lastTable.finalY + 10;
          }
        } catch (e) {
          // Ignora erro
        }
        return 60; // Fallback para primeira página
      };
      
      let currentY = 60;
      
      // 1. Grupo: Com notas (ambas)
      if (grupos.ambas.length > 0) {
        const dadosAmbas = prepararDadosTabela(grupos.ambas);
        currentY = criarTabela(dadosAmbas, `Com Notas (Ambas) - ${grupos.ambas.length} empresa(s)`, currentY);
        currentY = obterYAtual();
      }
      
      // 2. Grupo: Notas Emitidas
      if (grupos.emitidas.length > 0) {
        const dadosEmitidas = prepararDadosTabela(grupos.emitidas);
        currentY = criarTabela(dadosEmitidas, `Notas Emitidas - ${grupos.emitidas.length} empresa(s)`, currentY);
        currentY = obterYAtual();
      }
      
      // 3. Grupo: Notas Recebidas
      if (grupos.recebidas.length > 0) {
        const dadosRecebidas = prepararDadosTabela(grupos.recebidas);
        currentY = criarTabela(dadosRecebidas, `Notas Recebidas - ${grupos.recebidas.length} empresa(s)`, currentY);
        currentY = obterYAtual();
      }
      
      // 4. Grupo: Sem Movimento (SEMPRE NA ÚLTIMA PÁGINA)
      if (grupos.semMovimento.length > 0) {
        const dadosSemMovimento = prepararDadosTabela(grupos.semMovimento);
        criarTabela(dadosSemMovimento, `Sem Movimento - ${grupos.semMovimento.length} empresa(s)`, currentY, true);
      }

      // Nome do arquivo
      const nomeArquivo = this.dataInicio && this.dataFim
        ? `resumo_execucoes_${this.dataInicio.replace(/\//g, '-')}_${this.dataFim.replace(/\//g, '-')}_${new Date().getTime()}.pdf`
        : `resumo_execucoes_${new Date().getTime()}.pdf`;

      // Salva o PDF
      doc.save(nomeArquivo);
    } catch (error) {
      console.error('Erro detalhado ao gerar PDF:', error);
      console.error('Stack trace:', error instanceof Error ? error.stack : 'N/A');
      throw error;
    }
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
