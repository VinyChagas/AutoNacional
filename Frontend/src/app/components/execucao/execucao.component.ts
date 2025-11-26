import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CertificadoService, Certificado } from '../../services/certificado.service';
import { ExecucaoService, ExecucaoStatus } from '../../services/execucao.service';
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
  execucoes: ExecucaoStatus[] = [];
  
  carregandoCertificados = false;
  executando = false;
  headlessMode = false;
  
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
    this.destroy$.next();
    this.destroy$.complete();
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

    this.executando = true;

    // Cria execuções pendentes para cada certificado
    this.execucoes = this.certificadosCarregados.map(cert => ({
      id: `${Date.now()}-${cert.cnpj}`,
      cnpj: cert.cnpj,
      status: 'pendente' as const,
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
    execucao.status = 'em_execucao';
    execucao.mensagem = 'Iniciando execução...';
    execucao.progresso = 5;

    try {
      // Chama o backend
      const response = await firstValueFrom(
        this.execucaoService.executarNFSe(execucao.cnpj, this.headlessMode)
      );

      // Processa logs em tempo real
      if (response && response.logs && response.logs.length > 0) {
        await this.processarLogsEmTempoReal(execucao, response.logs);
      }

      // Atualiza status final
      execucao.status = response?.sucesso ? 'concluido' : 'falhou';
      execucao.progresso = 100;
      execucao.sucesso = response?.sucesso;
      execucao.mensagem = response?.mensagem || 'Execução concluída';
      execucao.urlAtual = response?.url_atual;
      execucao.titulo = response?.titulo;
      execucao.dataFim = new Date();

    } catch (error: any) {
      execucao.status = 'falhou';
      execucao.progresso = 100;
      execucao.mensagem = 'Erro na execução';
      execucao.erro = error.error?.detail || error.message || 'Erro desconhecido';
      execucao.dataFim = new Date();
    }

    // Aguarda um pouco antes de executar o próximo
    setTimeout(() => {
      this.executarSequencialmente(index + 1);
    }, 1000);
  }

  private processarLogsEmTempoReal(execucao: ExecucaoStatus, logs: string[]): Promise<void> {
    return new Promise((resolve) => {
      let logIndex = 0;
      
      const processarLog = () => {
        if (logIndex < logs.length) {
          const log = logs[logIndex];
          execucao.logs.push(log);
          execucao.mensagem = log;
          
          // Calcula progresso baseado nos logs processados
          execucao.progresso = Math.min(95, Math.round(((logIndex + 1) / logs.length) * 90) + 5);
          
          logIndex++;
          setTimeout(processarLog, 300); // Atualiza a cada 300ms
        } else {
          resolve();
        }
      };

      processarLog();
    });
  }

  executarCertificado(certificado: Certificado) {
    if (this.executando) {
      alert('Já existe uma execução em andamento.');
      return;
    }

    this.executando = true;

    // Adiciona à lista de execuções se não existir
    let execucaoExistente = this.execucoes.find(e => e.cnpj === certificado.cnpj);
    if (!execucaoExistente) {
      execucaoExistente = {
        id: `${Date.now()}-${certificado.cnpj}`,
        cnpj: certificado.cnpj,
        status: 'pendente',
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

  removerExecucao(id: string) {
    this.execucoes = this.execucoes.filter(e => e.id !== id);
  }

  formatarCNPJ(cnpj: string): string {
    return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  }

  obterCorStatus(status: string): string {
    switch (status) {
      case 'pendente':
        return 'border-[#7EBFB3]/30 bg-[#A9D9D4]/10';
      case 'concluido':
        return 'border-[#8BCB70]/50 bg-[#8BCB70]/10';
      case 'falhou':
        return 'border-[#1E2615]/50 bg-[#1E2615]/10';
      case 'em_execucao':
        return 'border-[#8BCB70]/50 bg-[#8BCB70]/20';
      default:
        return 'border-[#7EBFB3]/30 bg-[#A9D9D4]/10';
    }
  }

  obterCorTextoStatus(status: string): string {
    switch (status) {
      case 'pendente':
        return 'text-[#1E2615]';
      case 'concluido':
        return 'text-[#8BCB70]';
      case 'falhou':
        return 'text-[#1E2615]';
      case 'em_execucao':
        return 'text-[#8BCB70]';
      default:
        return 'text-[#1E2615]';
    }
  }

  obterIconeStatus(status: string): string {
    switch (status) {
      case 'concluido':
        return 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z';
      case 'falhou':
        return 'M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z';
      case 'em_execucao':
        return 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15';
      default:
        return 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z';
    }
  }

  obterTextoStatus(status: string): string {
    switch (status) {
      case 'concluido':
        return 'Concluído';
      case 'falhou':
        return 'Falhou';
      case 'em_execucao':
        return 'Em Execução';
      default:
        return 'Pendente';
    }
  }
}
