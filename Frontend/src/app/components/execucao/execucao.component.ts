import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CertificadoService, Certificado } from '../../services/certificado.service';
import { ExecucaoService, ExecucaoEmpresa, StatusExecucao, ResultadoFinal, ResumoExecucoesResponse, MultiplasExecucoesRequest } from '../../services/execucao.service';
import { Subject, takeUntil, firstValueFrom } from 'rxjs';

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
  
  carregandoCertificados = false;
  headlessMode = false;
  competencia: string = ''; // Formato MMAAAA (ex: 112025)
  tipoNotas: 'emitidas' | 'recebidas' | 'ambas' = 'ambas';
  
  // Relatório
  resumo: ResumoExecucoesResponse | null = null;
  mostrandoResumo = false;
  carregandoResumo = false;
  
  private intervalosStatus: Map<string, any> = new Map();
  private destroy$ = new Subject<void>();

  constructor(
    private certificadoService: CertificadoService,
    private execucaoService: ExecucaoService
  ) {}

  ngOnInit() {
    // Observa mudanças nos certificados
    this.certificadoService.certificados$
      .pipe(takeUntil(this.destroy$))
      .subscribe(certificados => {
        // Filtra apenas certificados válidos (não vencidos)
        this.certificadosValidos = certificados.filter(
          c => c.status !== 'vencido'
        );
      });
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

  // Getter para verificar se há execuções em andamento
  get temExecucoesEmAndamento(): boolean {
    return this.execucoes.some(e => e.status === 'executando' || e.status === 'fila');
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
    console.log('[CarregarEmpresas] Iniciando carregamento de empresas validadas...');
    console.log('[CarregarEmpresas] Certificados válidos disponíveis:', this.certificadosValidos.length);
    
    if (this.certificadosValidos.length === 0) {
      console.error('[CarregarEmpresas] Nenhum certificado válido encontrado');
      alert('Nenhum certificado válido encontrado.');
      return;
    }

    // Valida competência antes de carregar
    if (!this.competencia || this.competencia.length !== 6 || !/^\d{6}$/.test(this.competencia)) {
      console.error('[CarregarEmpresas] Competência inválida:', this.competencia);
      alert('Por favor, informe uma competência válida no formato MMAAAA (ex: 112025 para nov/2025).');
      return;
    }

    console.log('[CarregarEmpresas] Competência válida:', this.competencia);
    this.carregandoCertificados = true;
    
    try {
      // Prepara lista de empresas para adicionar à fila
      const empresas = this.certificadosValidos
        .filter(cert => cert.cnpj) // Filtra certificados sem CNPJ
        .map(cert => {
          const cnpjLimpo = cert.cnpj.replace(/[^\d]/g, '');
          if (cnpjLimpo.length !== 14) {
            console.warn(`CNPJ inválido para certificado: ${cert.cnpj} (limpo: ${cnpjLimpo})`);
            return null;
          }
          return {
            empresa_id: cnpjLimpo, // Usa CNPJ como ID temporário
            cnpj: cnpjLimpo // CNPJ limpo
          };
        })
        .filter(emp => emp !== null) as Array<{ empresa_id: string; cnpj: string }>; // Remove nulls

      if (empresas.length === 0) {
        alert('Nenhuma empresa válida encontrada. Verifique se os certificados têm CNPJ válido.');
        this.carregandoCertificados = false;
        return;
      }

      const request: MultiplasExecucoesRequest = {
        empresas: empresas,
        competencia: this.competencia,
        tipo: this.tipoNotas,
        headless: this.headlessMode
      };

      // Log para debug
      console.log('[CarregarEmpresas] Enviando requisição ao backend:', JSON.stringify(request, null, 2));
      console.log('[CarregarEmpresas] URL do serviço:', 'http://localhost:8000/api/execucao/multiplas');
      console.log('[CarregarEmpresas] Número de empresas na requisição:', empresas.length);

      // Chama backend para adicionar todas à fila
      console.log('[CarregarEmpresas] Fazendo chamada HTTP...');
      const response = await firstValueFrom(
        this.execucaoService.adicionarMultiplasExecucoes(request)
      );
      console.log('[CarregarEmpresas] Resposta recebida do backend:', response);
      console.log('[CarregarEmpresas] Detalhes da resposta:', {
        sucesso: response.sucesso,
        erros: response.erros,
        numExecucoes: response.execucoes?.length || 0,
        execucoes: response.execucoes?.map(e => ({
          empresa_id: e.empresa_id,
          cnpj: e.cnpj,
          status: e.status
        }))
      });

      // Atualiza certificados carregados
      this.certificadosCarregados = [...this.certificadosValidos];

      // Cria um mapa de CNPJ para certificado para facilitar busca
      const certMap = new Map<string, Certificado>();
      this.certificadosValidos.forEach(cert => {
        const cnpjLimpo = cert.cnpj.replace(/[^\d]/g, '');
        certMap.set(cnpjLimpo, cert);
      });

      // Cria execuções na fila com os dados retornados do backend
      // Usa CNPJ como chave para garantir correspondência correta
      this.execucoes = response.execucoes.map((exec) => {
        const cnpjLimpo = exec.cnpj || '';
        const cert = certMap.get(cnpjLimpo);
        
        return {
          id: `${Date.now()}-${exec.empresa_id}-${cnpjLimpo}`,
          empresa_id: exec.empresa_id,
          cnpj: cnpjLimpo,
          nomeEmpresa: cert?.nomeArquivo || cnpjLimpo,
          status: this.mapearStatusBackendParaFrontend(exec.status),
          progresso: exec.progresso || 0,
          logs: exec.logs || [],
          mensagem: exec.mensagem || 'Aguardando execução...',
          dataInicio: exec.data_inicio ? new Date(exec.data_inicio) : new Date(),
          mostrarLogs: false
        };
      });

      // Inicia polling para todas as execuções simultaneamente
      console.log('[CarregarEmpresas] Iniciando polling para', this.execucoes.length, 'execuções');
      this.execucoes.forEach((execucao) => {
        const empresaId = execucao.empresa_id || execucao.cnpj;
        console.log('[CarregarEmpresas] Iniciando polling para empresa:', empresaId, 'execução ID:', execucao.id);
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
      console.error('[CarregarEmpresas] Erro ao carregar empresas:', error);
      console.error('[CarregarEmpresas] Detalhes do erro:', {
        status: error.status,
        statusText: error.statusText,
        error: error.error,
        message: error.message,
        stack: error.stack
      });
      
      let mensagemErro = 'Erro desconhecido ao carregar empresas.';
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
      
      alert(`Erro ao carregar empresas: ${mensagemErro}`);
    } finally {
      this.carregandoCertificados = false;
      console.log('[CarregarEmpresas] Carregamento finalizado');
    }
  }

  executarTodos() {
    console.log('[ExecutarTodos] Iniciando execução de todos os certificados...');
    console.log('[ExecutarTodos] Certificados válidos:', this.certificadosValidos.length);
    console.log('[ExecutarTodos] Certificados carregados:', this.certificadosCarregados.length);
    console.log('[ExecutarTodos] Execuções atuais:', this.execucoes.length);
    console.log('[ExecutarTodos] Competência:', this.competencia);

    // Verifica se há empresas carregadas
    if (this.certificadosCarregados.length === 0) {
      console.warn('[ExecutarTodos] Nenhum certificado carregado. Redirecionando para carregar empresas...');
      if (this.certificadosValidos.length === 0) {
        alert('Nenhum certificado válido encontrado. Por favor, carregue os certificados primeiro.');
        return;
      }
      // Se há certificados válidos mas não carregados, carrega automaticamente
      this.carregarEmpresasValidadas();
      return;
    }

    // Verifica se já há execuções em andamento
    const executandoOuFila = this.execucoes.filter(
      e => e.status === 'executando' || e.status === 'fila'
    );
    
    if (executandoOuFila.length > 0) {
      console.warn('[ExecutarTodos] Já existem execuções em andamento:', executandoOuFila.length);
      alert('Já existem execuções em andamento ou na fila. Aguarde a conclusão ou limpe as execuções.');
      return;
    }

    // Se não há execuções, carrega as empresas (que já adiciona à fila)
    if (this.execucoes.length === 0) {
      console.log('[ExecutarTodos] Nenhuma execução anterior. Carregando empresas validadas...');
      this.carregarEmpresasValidadas();
      return;
    }

    // Se já há execuções na fila, apenas informa que estão sendo processadas
    console.log('[ExecutarTodos] Execuções já na fila:', this.execucoes.length);
    alert('As empresas já estão na fila e serão executadas automaticamente conforme o limite de concorrência.');
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
    // Valida competência
    if (!this.competencia || this.competencia.length !== 6 || !/^\d{6}$/.test(this.competencia)) {
      alert('Por favor, informe uma competência válida no formato MMAAAA (ex: 112025 para nov/2025).');
      return;
    }

    try {
      const empresaId = certificado.cnpj.replace(/[^\d]/g, '');
      
      // Chama o backend para adicionar à fila
      const response = await firstValueFrom(
        this.execucaoService.executarEmpresa(
          empresaId,
          this.competencia,
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
    this.carregandoResumo = true;
    this.mostrandoResumo = true;
    
    try {
      this.resumo = await firstValueFrom(
        this.execucaoService.obterResumoExecucoes(this.competencia || undefined)
      );
    } catch (error) {
      console.error('Erro ao gerar resumo:', error);
      alert('Erro ao gerar resumo das execuções');
    } finally {
      this.carregandoResumo = false;
    }
  }

  async baixarResumoCSV() {
    try {
      const blob = await firstValueFrom(
        this.execucaoService.baixarResumoCSV(this.competencia || undefined)
      );
      
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `resumo_execucoes_${this.competencia || 'todas'}_${new Date().getTime()}.csv`;
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
