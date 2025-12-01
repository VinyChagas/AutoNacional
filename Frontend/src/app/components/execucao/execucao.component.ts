import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CertificadoService, Certificado } from '../../services/certificado.service';
import { ExecucaoService, ExecucaoEmpresa, StatusExecucao, ResultadoFinal, ResumoExecucoesResponse } from '../../services/execucao.service';
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
  executando = false;
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

  carregarEmpresasValidadas() {
    this.carregandoCertificados = true;
    
    // Simula um pequeno delay para feedback visual
    setTimeout(() => {
      this.certificadosCarregados = [...this.certificadosValidos];
      this.carregandoCertificados = false;
    }, 500);
  }

  executarTodos() {
    if (this.certificadosCarregados.length === 0) {
      alert('Por favor, carregue as empresas validadas primeiro.');
      return;
    }

    if (this.executando) {
      alert('Já existe uma execução em andamento.');
      return;
    }

    // Valida competência
    if (!this.competencia || this.competencia.length !== 6 || !/^\d{6}$/.test(this.competencia)) {
      alert('Por favor, informe uma competência válida no formato MMAAAA (ex: 112025 para nov/2025).');
      return;
    }

    this.executando = true;

    // Cria execuções na fila para cada certificado
    this.execucoes = this.certificadosCarregados.map(cert => ({
      id: `${Date.now()}-${cert.cnpj}`,
      cnpj: cert.cnpj,
      nomeEmpresa: cert.nomeArquivo,
      status: 'fila' as StatusExecucao,
      progresso: 0,
      logs: [],
      mensagem: 'Aguardando execução...',
      dataInicio: new Date(),
      mostrarLogs: false
    }));

    // Executa cada certificado sequencialmente
    this.executarSequencialmente(0);
  }

  private async executarSequencialmente(index: number) {
    if (index >= this.execucoes.length) {
      this.executando = false;
      return;
    }

    const execucao = this.execucoes[index];
    this.atualizarStatusExecucao(execucao.id, {
      status: 'executando',
      mensagem: 'Iniciando execução...',
      progresso: 5
    });

    try {
      // Valida competência
      if (!this.competencia || this.competencia.length !== 6) {
        throw new Error('Competência inválida. Use o formato MMAAAA (ex: 112025)');
      }

      // Usa CNPJ como empresa_id (a rota aceita CNPJ também)
      const empresaId = execucao.cnpj.replace(/[^\d]/g, '');

      // Chama o backend com a nova rota
      const response = await firstValueFrom(
        this.execucaoService.executarEmpresa(
          empresaId,
          this.competencia,
          this.tipoNotas,
          this.headlessMode
        )
      );

      // Atualiza execução com dados iniciais
      this.atualizarStatusExecucao(execucao.id, {
        empresa_id: response.empresa_id,
        status: this.mapearStatusBackendParaFrontend(response.status),
        progresso: response.progresso,
        mensagem: response.mensagem,
        logs: response.logs || [],
        etapa_atual: response.etapa_atual,
        dataInicio: response.data_inicio ? new Date(response.data_inicio) : new Date(),
        qtdNotasEmitidas: response.qtd_notas_emitidas || 0,
        qtdNotasRecebidas: response.qtd_notas_recebidas || 0,
        resultadoFinal: response.resultado_final as ResultadoFinal | undefined
      });

      // Inicia polling de status usando o empresa_id retornado (ou CNPJ como fallback)
      const idParaPolling = response.empresa_id || empresaId;
      this.iniciarPollingStatus(execucao, idParaPolling);

    } catch (error: any) {
      this.atualizarStatusExecucao(execucao.id, {
        status: 'falhou',
        progresso: 100,
        mensagem: 'Erro na execução',
        erro: error.error?.detail || error.message || 'Erro desconhecido',
        dataFim: new Date()
      });
      
      // Continua para próxima execução após um delay
      setTimeout(() => {
        this.executarSequencialmente(index + 1);
      }, 1000);
    }
  }

  private iniciarPollingStatus(execucao: ExecucaoEmpresa, empresaId: string) {
    // Limpa intervalo anterior se existir
    if (this.intervalosStatus.has(execucao.id)) {
      clearInterval(this.intervalosStatus.get(execucao.id));
    }

    let tentativasErro404 = 0;
    const maxTentativas404 = 3;

    // Polling a cada 2 segundos
    const intervalo = setInterval(async () => {
      try {
        const status = await firstValueFrom(
          this.execucaoService.obterStatusExecucao(empresaId)
        );

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

        // Se concluído ou falhou, para o polling e continua para próxima
        const statusMapeado = this.mapearStatusBackendParaFrontend(status.status);
        if (statusMapeado === 'finalizado' || statusMapeado === 'falhou') {
          clearInterval(intervalo);
          this.intervalosStatus.delete(execucao.id);
          
          // Continua para próxima execução
          const index = this.execucoes.findIndex(e => e.id === execucao.id);
          if (index >= 0 && index < this.execucoes.length - 1) {
            setTimeout(() => {
              this.executarSequencialmente(index + 1);
            }, 1000);
          } else {
            this.executando = false;
          }
        }
      } catch (error: any) {
        console.error('Erro ao obter status:', error);
        
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
            
            // Continua para próxima execução
            const index = this.execucoes.findIndex(e => e.id === execucao.id);
            if (index >= 0 && index < this.execucoes.length - 1) {
              setTimeout(() => {
                this.executarSequencialmente(index + 1);
              }, 1000);
            } else {
              this.executando = false;
            }
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

  executarCertificado(certificado: Certificado) {
    if (this.executando) {
      alert('Já existe uma execução em andamento.');
      return;
    }

    // Valida competência
    if (!this.competencia || this.competencia.length !== 6 || !/^\d{6}$/.test(this.competencia)) {
      alert('Por favor, informe uma competência válida no formato MMAAAA (ex: 112025 para nov/2025).');
      return;
    }

    this.executando = true;

    // Adiciona à lista de execuções se não existir
    let execucaoExistente = this.execucoes.find(e => e.cnpj === certificado.cnpj);
    if (!execucaoExistente) {
      execucaoExistente = {
        id: `${Date.now()}-${certificado.cnpj}`,
        cnpj: certificado.cnpj,
        nomeEmpresa: certificado.nomeArquivo,
        status: 'fila',
        progresso: 0,
        logs: [],
        mensagem: 'Aguardando execução...',
        dataInicio: new Date(),
        mostrarLogs: false
      };
      this.execucoes.push(execucaoExistente);
    }

    const index = this.execucoes.findIndex(e => e.id === execucaoExistente!.id);
    this.executarSequencialmente(index);
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
