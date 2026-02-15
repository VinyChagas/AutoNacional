import { Component, OnInit, OnDestroy } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators, FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { CertificadoService, Certificado, CertificadoValidacaoLoteResponse, CertificadoImportacaoLoteResponse } from '../../services/certificado.service';
import { ContabilidadeService } from '../../services/contabilidade.service';
import { Contabilidade } from '../../models/contabilidade.model';
import { Subject, takeUntil, firstValueFrom } from 'rxjs';
import jsPDF from 'jspdf';
// @ts-ignore - jspdf-autotable não tem tipos TypeScript completos
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

interface CertificadoPendente {
  file: File;
  cnpj: string;
  id: string;
  senha?: string; // Senha temporária para retomar
  dadosExtraidos?: any; // Dados extraídos do certificado
  contabilidadeId?: number; // Contabilidade selecionada (se houver)
}

interface CertificadoPendentePersistente {
  fileName: string;
  cnpj: string;
  id: string;
  senha?: string;
  dadosExtraidos?: any;
  contabilidadeId?: number;
  dataCriacao: string;
}

type SortDirection = 'asc' | 'desc' | null;
type SortableColumn = 'cnpj' | 'nomeArquivo' | 'dataUpload' | 'dataValidade' | 'diasAteExpiracao' | 'status' | null;
type SearchColumn = 'cnpj' | 'nomeArquivo' | 'dataUpload' | 'dataValidade' | 'diasAteExpiracao' | 'status';

interface SortState {
  column: SortableColumn;
  direction: SortDirection;
}

@Component({
  selector: 'app-certificado-upload',
  standalone: true,
  imports: [ReactiveFormsModule, FormsModule, CommonModule, RouterModule],
  templateUrl: './certificado-upload.component.html',
  styleUrls: ['./certificado-upload.component.scss'],
})
export class CertificadoUploadComponent implements OnInit, OnDestroy {
  certificados: Certificado[] = [];
  certificadosFiltrados: Certificado[] = [];
  certificadosPendentes: CertificadoPendente[] = [];
  
  // Seleção global de contabilidade
  contabilidadeGlobalSelecionada: number | null = null;
  contabilidades: Contabilidade[] = [];
  carregandoContabilidades = false;
  
  // Nova lógica de filtragem e ordenação
  sortState: SortState = { column: null, direction: null };
  searchColumn: SearchColumn = 'cnpj';
  searchValue: string = '';
  filtroVencidos = false;
  
  // Modal
  modalAberto = false;
  certificadoAtual: CertificadoPendente | null = null;
  senhaForm: FormGroup;
  contabilidadeForm: FormGroup;
  validandoSenha = false;
  senhaValida: boolean | null = null;
  mensagemSenha = '';
  importando = false;
  
  // Fluxo de dois passos
  passoAtual: 1 | 2 = 1;
  dadosExtraidos: any = null;
  
  // Certificados pendentes persistentes
  private readonly STORAGE_KEY_PENDENTES = 'certificados_pendentes_configuracao';
  
  // Upload em lote
  carregando = false;
  mensagem = '';
  
  // Validação em lote
  modalValidacaoLoteAberto = false;
  arquivosLote: File[] = [];
  senhaLote = '';
  validandoLote = false;
  resultadosValidacao: CertificadoValidacaoLoteResponse | null = null;
  
  // Importação em lote
  modalImportacaoLoteAberto = false;
  arquivosImportacaoLote: File[] = [];
  senhaImportacaoLote = '';
  importandoLote = false;
  resultadosImportacao: CertificadoImportacaoLoteResponse | null = null;
  
  // Opções de busca
  searchColumns: { value: SearchColumn; label: string }[] = [
    { value: 'cnpj', label: 'CNPJ' },
    { value: 'nomeArquivo', label: 'Empresa' },
    { value: 'dataUpload', label: 'Data de Upload' },
    { value: 'dataValidade', label: 'Data de Validade' },
    { value: 'diasAteExpiracao', label: 'Dias até Expiração' },
    { value: 'status', label: 'Status' }
  ];
  
  // Seleção múltipla para exclusão
  certificadosSelecionados: Set<string> = new Set();
  excluindoMultiplos = false;
  
  private destroy$ = new Subject<void>();

  constructor(
    private fb: FormBuilder,
    private certificadoService: CertificadoService,
    private contabilidadeService: ContabilidadeService,
    private http: HttpClient
  ) {
    this.senhaForm = this.fb.group({
      senha: ['', [Validators.required]]
    });
    this.contabilidadeForm = this.fb.group({
      contabilidade_id: ['', [Validators.required]]
    });
  }

  ngOnInit() {
    // Carrega contabilidades ao inicializar
    this.carregarContabilidades();
    
    // Carrega certificados pendentes persistentes
    this.carregarCertificadosPendentes();
    
    // Observa mudanças nos certificados
    this.certificadoService.certificados$
      .pipe(takeUntil(this.destroy$))
      .subscribe(certificados => {
        this.certificados = certificados;
        this.aplicarFiltrosEOrdenacao();
      });
  }

  // Funções utilitárias de ordenação
  toggleSort(column: SortableColumn) {
    if (this.sortState.column === column) {
      // Cicla: asc -> desc -> null
      if (this.sortState.direction === 'asc') {
        this.sortState = { column, direction: 'desc' };
      } else if (this.sortState.direction === 'desc') {
        this.sortState = { column: null, direction: null };
      } else {
        this.sortState = { column, direction: 'asc' };
      }
    } else {
      // Nova coluna: começa com asc
      this.sortState = { column, direction: 'asc' };
    }
    this.aplicarFiltrosEOrdenacao();
  }

  getSortIcon(column: SortableColumn): string {
    if (this.sortState.column !== column || this.sortState.direction === null) {
      return '↕';
    }
    return this.sortState.direction === 'asc' ? '▲' : '▼';
  }

  isColumnSorted(column: SortableColumn): boolean {
    return this.sortState.column === column && this.sortState.direction !== null;
  }

  // Funções de filtragem
  onSearchChange() {
    this.aplicarFiltrosEOrdenacao();
  }

  onSearchColumnChange() {
    this.searchValue = ''; // Limpa busca ao trocar coluna
    this.aplicarFiltrosEOrdenacao();
  }

  onFiltroVencidosChange() {
    this.aplicarFiltrosEOrdenacao();
  }

  // Função utilitária para obter valor da célula para busca
  private getCellValue(certificado: Certificado, column: SearchColumn): string {
    switch (column) {
      case 'cnpj':
        return this.formatarCNPJ(certificado.cnpj);
      case 'nomeArquivo':
        return certificado.nomeArquivo || '';
      case 'dataUpload':
        return certificado.dataUpload ? this.formatarData(certificado.dataUpload) : '';
      case 'dataValidade':
        return certificado.dataValidade ? this.formatarData(certificado.dataValidade) : 'Não informada';
      case 'diasAteExpiracao':
        return certificado.diasAteExpiracao !== null ? certificado.diasAteExpiracao.toString() : '-';
      case 'status':
        return this.obterTextoStatus(certificado.status);
      default:
        return '';
    }
  }

  private formatarData(date: Date): string {
    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onFilesSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const files = Array.from(input.files);
      
      // Filtra apenas arquivos .pfx e .p12
      const arquivosValidos = files.filter(f => 
        f.name.toLowerCase().endsWith('.pfx') || f.name.toLowerCase().endsWith('.p12')
      );
      
      if (arquivosValidos.length === 0) {
        alert('Nenhum arquivo .pfx ou .p12 encontrado na seleção.');
        return;
      }
      
      // Se houver múltiplos arquivos, oferece opção de importação em lote
      if (arquivosValidos.length > 1) {
        const escolha = confirm(
          `${arquivosValidos.length} arquivo(s) selecionado(s).\n\n` +
          `Deseja importar em lote com a mesma senha para todos?\n\n` +
          `• SIM: Abre modal de importação em lote\n` +
          `• NÃO: Importa um por um (fluxo individual)`
        );
        
        if (escolha) {
          // Importação em lote
          this.arquivosImportacaoLote = arquivosValidos;
          this.senhaImportacaoLote = '';
          this.resultadosImportacao = null;
          this.modalImportacaoLoteAberto = true;
          
          // Reseta o input de arquivo
          input.value = '';
          return;
        }
      }
      
      // Fluxo individual (um por um)
      arquivosValidos.forEach(file => {
        // Verifica se há dados pendentes para restaurar
        const dadosRestaurados = this.restaurarDadosPendenteSeExistir(file.name);
        
        const pendente: CertificadoPendente = {
          file,
          cnpj: '', // CNPJ será extraído automaticamente pelo backend
          id: `${Date.now()}-${Math.random()}`,
          senha: dadosRestaurados?.senha,
          dadosExtraidos: dadosRestaurados?.dadosExtraidos,
          contabilidadeId: dadosRestaurados?.contabilidadeId || this.contabilidadeGlobalSelecionada || undefined
        };
        
        this.certificadosPendentes.push(pendente);
      });
      
      // Abre modal para o primeiro certificado pendente
      if (this.certificadosPendentes.length > 0) {
        this.abrirModalSenha(this.certificadosPendentes[0]);
      }
    }
  }

  abrirModalSenha(certificado: CertificadoPendente) {
    this.certificadoAtual = certificado;
    
    // Se o certificado pendente já tem senha e dados extraídos, vai direto para o passo 2
    if (certificado.senha && certificado.dadosExtraidos) {
      this.senhaForm.patchValue({ senha: certificado.senha });
      this.dadosExtraidos = certificado.dadosExtraidos;
      this.passoAtual = 2;
      this.senhaValida = true;
      
      // Se houver contabilidade global ou pré-selecionada, usa ela
      const contabilidadeId = this.contabilidadeGlobalSelecionada || certificado.contabilidadeId;
      if (contabilidadeId) {
        this.contabilidadeForm.patchValue({ contabilidade_id: contabilidadeId.toString() });
      } else {
        this.contabilidadeForm.patchValue({ contabilidade_id: '' });
      }
    } else {
      this.senhaForm.patchValue({ senha: certificado.senha || '' });
      this.passoAtual = 1;
      this.dadosExtraidos = null;
      
      // Se houver contabilidade global, pré-preenche
      if (this.contabilidadeGlobalSelecionada) {
        this.contabilidadeForm.patchValue({ contabilidade_id: this.contabilidadeGlobalSelecionada.toString() });
      } else {
        this.contabilidadeForm.patchValue({ contabilidade_id: certificado.contabilidadeId?.toString() || '' });
      }
    }
    
    this.senhaValida = null;
    this.mensagemSenha = '';
    this.importando = false;
    this.modalAberto = true;
    
    // Carrega contabilidades se ainda não foram carregadas
    if (this.contabilidades.length === 0) {
      this.carregarContabilidades();
    }
  }

  fecharModal() {
    // Se o modal foi fechado e há dados parciais, salva como pendente
    if (this.certificadoAtual && (this.senhaForm.get('senha')?.value || this.dadosExtraidos)) {
      this.salvarCertificadoPendente();
    }
    
    this.modalAberto = false;
    this.certificadoAtual = null;
    this.senhaValida = null;
    this.mensagemSenha = '';
    this.validandoSenha = false;
    this.importando = false;
    this.passoAtual = 1;
    this.dadosExtraidos = null;
    this.senhaForm.reset();
    this.contabilidadeForm.reset();
  }

  carregarContabilidades() {
    this.carregandoContabilidades = true;
    this.contabilidadeService.listar().subscribe({
      next: (response) => {
        this.contabilidades = response.contabilidades || [];
        this.carregandoContabilidades = false;
      },
      error: (error) => {
        console.error('Erro ao carregar contabilidades:', error);
        this.carregandoContabilidades = false;
      }
    });
  }

  onContabilidadeGlobalChange(contabilidadeId: string | number | null) {
    if (contabilidadeId === '' || contabilidadeId === null || contabilidadeId === 'null') {
      this.contabilidadeGlobalSelecionada = null;
    } else {
      const id = typeof contabilidadeId === 'string' ? parseInt(contabilidadeId) : contabilidadeId;
      this.contabilidadeGlobalSelecionada = isNaN(id) ? null : id;
    }
    this.aplicarFiltrosEOrdenacao();
  }

  async validarSenha() {
    if (!this.certificadoAtual || !this.senhaForm.valid) return;

    this.importando = true;
    this.senhaValida = null;
    this.mensagemSenha = '';

    if (!this.certificadoAtual) {
      this.senhaValida = false;
      this.mensagemSenha = 'Erro: certificado não encontrado';
      this.importando = false;
      return;
    }

    const senha = this.senhaForm.get('senha')?.value;

    try {
      // Passo 1: Extrai informações do certificado (sem salvar)
      const resultado = await new Promise<any>((resolve, reject) => {
        this.certificadoService.extrairInformacoesCertificado(
          this.certificadoAtual!.file,
          senha
        ).subscribe({
          next: resolve,
          error: reject
        });
      });

      // Verifica se a extração foi bem-sucedida
      if (resultado.success && resultado.cnpj && resultado.empresa) {
        // Salva os dados extraídos e avança para o passo 2
        this.dadosExtraidos = {
          ...resultado,
          senha: senha // Guarda a senha temporariamente para o passo 2
        };
        
        // Atualiza o certificado pendente com senha e dados extraídos
        if (this.certificadoAtual) {
          this.certificadoAtual.senha = senha;
          this.certificadoAtual.dadosExtraidos = this.dadosExtraidos;
        }
        
        this.passoAtual = 2;
        this.senhaValida = true;
        this.mensagemSenha = 'Certificado validado! Selecione a contabilidade.';
        
        // Se houver contabilidade global selecionada, pré-preenche o formulário
        if (this.contabilidadeGlobalSelecionada) {
          this.contabilidadeForm.patchValue({ contabilidade_id: this.contabilidadeGlobalSelecionada.toString() });
        }
      } else {
        // Erro na validação
        this.senhaValida = false;
        this.mensagemSenha = resultado.message || 'Erro ao validar certificado';
      }

    } catch (error: any) {
      console.error('❌ Erro ao validar certificado:', error);
      this.senhaValida = false;
      
      // Tratamento detalhado de erros
      if (error.message) {
        this.mensagemSenha = error.message;
      } else if (error.error) {
        if (typeof error.error === 'object') {
          this.mensagemSenha = error.error.message || error.error.detail || 'Erro ao processar certificado';
        } else {
          this.mensagemSenha = error.error.toString();
        }
      } else {
        this.mensagemSenha = 'Erro desconhecido ao processar certificado. Verifique se o servidor está rodando.';
      }
    } finally {
      this.importando = false;
    }
  }

  async confirmarVinculacao() {
    // Determina a contabilidade a usar (global ou do formulário)
    let contabilidadeId: number;
    
    if (this.contabilidadeGlobalSelecionada !== null) {
      // Usa a contabilidade global se estiver selecionada
      contabilidadeId = this.contabilidadeGlobalSelecionada;
      // Atualiza o formulário para refletir isso
      this.contabilidadeForm.patchValue({ contabilidade_id: contabilidadeId.toString() });
    } else {
      // Usa a contabilidade do formulário
      if (!this.contabilidadeForm.valid || !this.contabilidadeForm.get('contabilidade_id')?.value) {
        this.senhaValida = false;
        this.mensagemSenha = 'Por favor, selecione uma contabilidade';
        return;
      }
      contabilidadeId = parseInt(this.contabilidadeForm.get('contabilidade_id')?.value);
    }

    if (!this.dadosExtraidos) {
      this.senhaValida = false;
      this.mensagemSenha = 'Erro: dados do certificado não encontrados';
      return;
    }

    this.importando = true;
    this.mensagemSenha = '';

    const contabilidadeSelecionada = this.contabilidades.find(c => c.id === contabilidadeId);

    try {
      // Passo 2: Importa o certificado com contabilidade_id
      const resultado = await new Promise<any>((resolve, reject) => {
        this.certificadoService.importarCertificadoComContabilidade(
          this.certificadoAtual!.file,
          this.dadosExtraidos.senha,
          contabilidadeId
        ).subscribe({
          next: resolve,
          error: reject
        });
      });

      if (resultado.success) {
        // Extrai CNPJ limpo
        const cnpjLimpo = this.dadosExtraidos.cnpj.replace(/[^\d]/g, '');
        
        // Faz upload do certificado
        await new Promise((resolve, reject) => {
          this.certificadoService.uploadCertificado(
            cnpjLimpo,
            this.dadosExtraidos.senha,
            this.certificadoAtual!.file
          ).subscribe({
            next: resolve,
            error: reject
          });
        });

        // Cria objeto de certificado com dados extraídos
        const dataValidade = this.dadosExtraidos.dataVencimento ? new Date(this.dadosExtraidos.dataVencimento) : null;
        const diasAteExpiracao = this.certificadoService.calcularDiasAteExpiracao(dataValidade);
        const status = this.certificadoService.obterStatusCertificado(diasAteExpiracao);
        const nomeEmpresa = this.dadosExtraidos.empresa || this.certificadoAtual!.file.name;

        const novoCertificado: Certificado = {
          // Usa CNPJ limpo como ID estável no frontend para evitar duplicados
          id: cnpjLimpo,
          cnpj: cnpjLimpo,
          nomeArquivo: nomeEmpresa,
          dataUpload: new Date(),
          dataValidade,
          diasAteExpiracao,
          status,
          contabilidade_id: contabilidadeId,
          contabilidade_nome: contabilidadeSelecionada?.nome_contabilidade
        };

        this.certificadoService.adicionarCertificadoLocal(novoCertificado);

        // Remove da lista de pendentes (tanto em memória quanto persistente)
        this.certificadosPendentes = this.certificadosPendentes.filter(
          c => c.id !== this.certificadoAtual!.id
        );
        this.removerCertificadoPendente(this.certificadoAtual!.id);

        // Fecha modal e abre próximo se houver
        setTimeout(() => {
          this.fecharModal();
          
          // Tenta abrir próximo pendente (em memória ou persistente)
          if (this.certificadosPendentes.length > 0) {
            setTimeout(() => {
              this.abrirModalSenha(this.certificadosPendentes[0]);
            }, 500);
          } else {
            // Verifica se há pendentes persistentes para retomar
            const proximoPendente = this.obterProximoCertificadoPendente();
            if (proximoPendente) {
              setTimeout(() => {
                this.retomarCertificadoPendente(proximoPendente);
              }, 500);
            }
          }
        }, 1500);

      } else {
        this.senhaValida = false;
        this.mensagemSenha = resultado.message || 'Erro ao vincular certificado à contabilidade';
      }

    } catch (error: any) {
      console.error('❌ Erro ao vincular certificado:', error);
      this.senhaValida = false;
      this.mensagemSenha = error.error?.message || error.message || 'Erro ao vincular certificado à contabilidade';
    } finally {
      this.importando = false;
    }
  }

  voltarParaPasso1() {
    this.passoAtual = 1;
    this.dadosExtraidos = null;
    this.contabilidadeForm.reset();
    this.mensagemSenha = '';
  }

  aplicarFiltrosEOrdenacao() {
    let resultado = [...this.certificados];

    // 1. Filtro por contabilidade global (primeiro filtro aplicado)
    if (this.contabilidadeGlobalSelecionada !== null) {
      resultado = resultado.filter(certificado => 
        certificado.contabilidade_id === this.contabilidadeGlobalSelecionada
      );
    }

    // 2. Filtro de busca por texto
    if (this.searchValue.trim()) {
      const searchLower = this.searchValue.trim().toLowerCase();
      resultado = resultado.filter(certificado => {
        const cellValue = this.getCellValue(certificado, this.searchColumn).toLowerCase();
        return cellValue.includes(searchLower);
      });
    }

    // 3. Filtro de vencidos
    if (this.filtroVencidos) {
      resultado = resultado.filter(c => 
        c.status === 'vencido' || (c.diasAteExpiracao !== null && c.diasAteExpiracao <= 0)
      );
    }

    // 3. Ordenação
    if (this.sortState.column && this.sortState.direction) {
      resultado.sort((a, b) => {
        let comparison = 0;
        
        switch (this.sortState.column) {
          case 'cnpj':
            comparison = a.cnpj.localeCompare(b.cnpj);
            break;
          case 'nomeArquivo':
            comparison = (a.nomeArquivo || '').localeCompare(b.nomeArquivo || '');
            break;
          case 'dataUpload':
            comparison = a.dataUpload.getTime() - b.dataUpload.getTime();
            break;
          case 'dataValidade':
            const dataA = a.dataValidade?.getTime() ?? 0;
            const dataB = b.dataValidade?.getTime() ?? 0;
            comparison = dataA - dataB;
            break;
          case 'diasAteExpiracao':
            const diasA = a.diasAteExpiracao ?? Infinity;
            const diasB = b.diasAteExpiracao ?? Infinity;
            comparison = diasA - diasB;
            break;
          case 'status':
            comparison = a.status.localeCompare(b.status);
            break;
        }
        
        return this.sortState.direction === 'asc' ? comparison : -comparison;
      });
    }

    this.certificadosFiltrados = resultado;
  }

  removerCertificado(certificado: Certificado) {
    if (confirm('Tem certeza que deseja remover este certificado?')) {
      this.certificadoService.removerCertificado(certificado);
    }
  }

  // Seleção múltipla
  toggleSelecionarCertificado(certificadoId: string) {
    if (this.certificadosSelecionados.has(certificadoId)) {
      this.certificadosSelecionados.delete(certificadoId);
    } else {
      this.certificadosSelecionados.add(certificadoId);
    }
  }

  estaSelecionado(certificadoId: string): boolean {
    return this.certificadosSelecionados.has(certificadoId);
  }

  toggleSelecionarTodos() {
    if (this.todosSelecionados) {
      this.certificadosSelecionados.clear();
    } else {
      this.certificadosFiltrados.forEach(cert => {
        this.certificadosSelecionados.add(cert.id);
      });
    }
  }

  get todosSelecionados(): boolean {
    return this.certificadosFiltrados.length > 0 && 
           this.certificadosFiltrados.every(cert => this.certificadosSelecionados.has(cert.id));
  }

  get nenhumSelecionado(): boolean {
    return this.certificadosSelecionados.size === 0;
  }

  get quantidadeSelecionados(): number {
    return this.certificadosSelecionados.size;
  }

  async excluirCertificadosSelecionados() {
    const quantidade = this.certificadosSelecionados.size;
    if (quantidade === 0) {
      alert('Nenhum certificado selecionado.');
      return;
    }

    const confirmacao = confirm(
      `Tem certeza que deseja excluir ${quantidade} certificado(s) selecionado(s)?\n\nEsta ação não pode ser desfeita.`
    );

    if (!confirmacao) {
      return;
    }

    this.excluindoMultiplos = true;
    const certificadosParaExcluir = [...this.certificadosFiltrados.filter(cert => 
      this.certificadosSelecionados.has(cert.id)
    )];

    let sucesso = 0;
    let falhas = 0;
    const erros: string[] = [];

    // Exclui cada certificado sequencialmente
    for (const certificado of certificadosParaExcluir) {
      try {
        const cnpjLimpo = certificado.cnpj.replace(/[^\d]/g, '');
        
        try {
          await firstValueFrom(
            this.http.delete<void>(`${environment.apiUrl}/certificados/cnpj/${cnpjLimpo}`)
          );
          
          // Remove da lista local usando o serviço para manter consistência
          this.certificadoService['certificadosSubject'].next(
            this.certificadoService['certificadosSubject'].value.filter(c => c.id !== certificado.id)
          );
          sucesso++;
        } catch (error: any) {
          // Se o backend retornar 404 (já não existe no banco), seguimos com a remoção local
          if (error.status === 404) {
            this.certificadoService['certificadosSubject'].next(
              this.certificadoService['certificadosSubject'].value.filter(c => c.id !== certificado.id)
            );
            sucesso++;
          } else {
            falhas++;
            erros.push(`${certificado.nomeArquivo} (${this.formatarCNPJ(certificado.cnpj)}): ${error.error?.detail || error.message || 'Erro desconhecido'}`);
          }
        }
        
        // Pequeno delay entre exclusões para não sobrecarregar o servidor
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error: any) {
        falhas++;
        erros.push(`${certificado.nomeArquivo} (${this.formatarCNPJ(certificado.cnpj)}): ${error.message || 'Erro desconhecido'}`);
      }
    }

    // Limpa seleção após exclusão
    this.certificadosSelecionados.clear();

    // Mostra resultado
    if (falhas === 0) {
      alert(`${sucesso} certificado(s) excluído(s) com sucesso!`);
    } else {
      const mensagemErro = erros.length > 0 ? `\n\nErros:\n${erros.slice(0, 5).join('\n')}${erros.length > 5 ? `\n... e mais ${erros.length - 5} erro(s)` : ''}` : '';
      alert(`${sucesso} certificado(s) excluído(s) com sucesso.\n${falhas} certificado(s) falharam ao excluir.${mensagemErro}`);
    }

    this.excluindoMultiplos = false;
  }

  formatarCNPJ(cnpj: string): string {
    return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  }

  obterCorStatus(status: string): string {
    switch (status) {
      case 'vencido':
        return 'text-[#0C0D0A] bg-[#1E2615]/30 border-[#1E2615]/50';
      case 'proximo_vencimento':
        return 'text-[#0C0D0A] bg-[#7EBFB3]/30 border-[#7EBFB3]/50';
      default:
        return 'text-[#0C0D0A] bg-[#8BCB70]/30 border-[#8BCB70]/50';
    }
  }

  obterTextoStatus(status: string): string {
    switch (status) {
      case 'vencido':
        return 'Vencido';
      case 'proximo_vencimento':
        return 'Próximo do Vencimento';
      default:
        return 'Válido';
    }
  }

  // Função para obter dados filtrados (exatamente o que está sendo exibido)
  getFilteredData(): Certificado[] {
    return [...this.certificadosFiltrados];
  }

  // Função para exportar PDF
  exportToPDF(): void {
    const data = this.getFilteredData();
    
    if (data.length === 0) {
      alert('Não há dados para exportar. Aplique filtros diferentes ou adicione certificados.');
      return;
    }

    const doc = new jsPDF();
    
    // Título
    doc.setFontSize(18);
    doc.setTextColor(12, 13, 10); // #0C0D0A
    doc.text('Relatório de Certificados Digitais', 14, 20);
    
    // Subtítulo com data/hora
    doc.setFontSize(10);
    doc.setTextColor(30, 38, 21); // #1E2615
    const dataHora = new Date().toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    doc.text(`Exportado em: ${dataHora}`, 14, 28);
    
    // Preparar dados da tabela (sem Data de Upload)
    const tableData = data.map(cert => [
      this.formatarCNPJ(cert.cnpj),
      cert.nomeArquivo || '-',
      cert.dataValidade ? this.formatarData(cert.dataValidade) : 'Não informada',
      cert.diasAteExpiracao !== null ? `${cert.diasAteExpiracao} dias` : '-',
      this.obterTextoStatus(cert.status)
    ]);

    // Criar tabela
    autoTable(doc, {
      head: [['CNPJ', 'Empresa', 'Data de Validade', 'Dias até Expiração', 'Status']],
      body: tableData,
      startY: 35,
      styles: {
        fontSize: 8,
        textColor: [12, 13, 10], // #0C0D0A
        cellPadding: { top: 4, bottom: 4, left: 3, right: 3 },
        overflow: 'linebreak',
        cellWidth: 'wrap',
        lineWidth: 0.1,
      },
      headStyles: {
        fillColor: [139, 203, 112], // #8BCB70
        textColor: [12, 13, 10], // #0C0D0A
        fontStyle: 'bold',
        halign: 'left',
        cellPadding: { top: 5, bottom: 5, left: 3, right: 3 },
      },
      bodyStyles: {
        halign: 'left',
        valign: 'middle',
      },
      alternateRowStyles: {
        fillColor: [240, 248, 247], // Cor clara alternativa (#A9D9D4 em RGB claro)
      },
      columnStyles: {
        0: { cellWidth: 38 }, // CNPJ
        1: { cellWidth: 65 }, // Empresa
        2: { cellWidth: 32 }, // Data Validade
        3: { cellWidth: 28 }, // Dias
        4: { cellWidth: 32 }, // Status
      },
      margin: { top: 35, left: 14, right: 14, bottom: 25 },
      pageBreak: 'auto',
      rowPageBreak: 'avoid',
      tableWidth: 'wrap',
      showHead: 'everyPage',
      showFoot: 'never',
      didDrawPage: (data: any) => {
        // Garantir margem inferior adequada
        const pageHeight = doc.internal.pageSize.height;
        const pageWidth = doc.internal.pageSize.width;
        
        // Adicionar linha de rodapé se necessário
        if (data.pageNumber > 1) {
          doc.setFontSize(8);
          doc.setTextColor(150, 150, 150);
          doc.text(
            `Página ${data.pageNumber}`,
            pageWidth / 2,
            pageHeight - 10,
            { align: 'center' }
          );
        }
      },
    });

    // Nome do arquivo
    const dataFormatada = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const nomeArquivo = `certificados_${dataFormatada}.pdf`;
    
    // Salvar PDF
    doc.save(nomeArquivo);
  }

  // Função para exportar Excel
  exportToExcel(): void {
    const data = this.getFilteredData();
    
    if (data.length === 0) {
      alert('Não há dados para exportar. Aplique filtros diferentes ou adicione certificados.');
      return;
    }

    // Preparar dados da planilha
    const dadosPlanilha = data.map(cert => ({
      'CNPJ': this.formatarCNPJ(cert.cnpj),
      'Empresa': cert.nomeArquivo || '-',
      'Data de Upload': this.formatarData(cert.dataUpload),
      'Data de Validade': cert.dataValidade ? this.formatarData(cert.dataValidade) : 'Não informada',
      'Dias até Expiração': cert.diasAteExpiracao !== null ? cert.diasAteExpiracao : '-',
      'Status': this.obterTextoStatus(cert.status)
    }));

    // Criar workbook e worksheet
    const ws = XLSX.utils.json_to_sheet(dadosPlanilha);
    const wb = XLSX.utils.book_new();
    
    // Adicionar worksheet ao workbook
    XLSX.utils.book_append_sheet(wb, ws, 'Certificados');

    // Ajustar largura das colunas
    const colWidths = [
      { wch: 18 }, // CNPJ
      { wch: 30 }, // Empresa
      { wch: 15 }, // Data Upload
      { wch: 15 }, // Data Validade
      { wch: 18 }, // Dias até Expiração
      { wch: 20 }  // Status
    ];
    ws['!cols'] = colWidths;

    // Nome do arquivo
    const dataFormatada = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const nomeArquivo = `certificados_${dataFormatada}.xlsx`;
    
    // Salvar Excel
    XLSX.writeFile(wb, nomeArquivo);
  }

  // Validação em lote
  onFilesSelectedLote(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const files = Array.from(input.files);
      // Filtra apenas arquivos .pfx e .p12
      this.arquivosLote = files.filter(f => 
        f.name.toLowerCase().endsWith('.pfx') || f.name.toLowerCase().endsWith('.p12')
      );
      
      if (this.arquivosLote.length === 0) {
        alert('Nenhum arquivo .pfx ou .p12 encontrado na seleção.');
        return;
      }
      
      if (this.arquivosLote.length !== files.length) {
        alert(`${files.length - this.arquivosLote.length} arquivo(s) ignorado(s) (não são .pfx ou .p12)`);
      }
      
      this.modalValidacaoLoteAberto = true;
      this.senhaLote = '';
      this.resultadosValidacao = null;
    }
  }

  fecharModalValidacaoLote() {
    this.modalValidacaoLoteAberto = false;
    this.arquivosLote = [];
    this.senhaLote = '';
    this.resultadosValidacao = null;
    this.validandoLote = false;
  }

  async validarLote() {
    if (!this.senhaLote || !this.senhaLote.trim()) {
      alert('Por favor, informe a senha para validação.');
      return;
    }

    if (this.arquivosLote.length === 0) {
      alert('Nenhum arquivo selecionado.');
      return;
    }

    this.validandoLote = true;
    this.resultadosValidacao = null;

    try {
      const resultado = await new Promise<CertificadoValidacaoLoteResponse>((resolve, reject) => {
        this.certificadoService.validarCertificadosLote(this.arquivosLote, this.senhaLote).subscribe({
          next: resolve,
          error: reject
        });
      });

      this.resultadosValidacao = resultado;
    } catch (error: any) {
      console.error('Erro ao validar certificados em lote:', error);
      alert('Erro ao validar certificados. Verifique o console para mais detalhes.');
    } finally {
      this.validandoLote = false;
    }
  }

  // Importação em lote
  fecharModalImportacaoLote() {
    this.modalImportacaoLoteAberto = false;
    this.arquivosImportacaoLote = [];
    this.senhaImportacaoLote = '';
    this.resultadosImportacao = null;
    this.importandoLote = false;
    
    // Reseta o input de arquivo para permitir nova seleção
    const fileInput = document.querySelector('input[type="file"][accept=".pfx,.p12"]') as HTMLInputElement;
    if (fileInput) {
      fileInput.value = '';
    }
  }

  async aplicarSenhaParaTodos() {
    if (!this.senhaForm.valid || this.certificadosPendentes.length === 0) return;

    const senha = this.senhaForm.get('senha')?.value;
    if (!senha || !senha.trim()) {
      alert('Por favor, informe a senha.');
      return;
    }

    // Confirmação antes de aplicar para todos
    const confirmar = confirm(
      `Deseja aplicar esta senha para todos os ${this.certificadosPendentes.length} certificado(s) pendentes?`
    );
    
    if (!confirmar) {
      return;
    }

    this.importando = true;
    this.senhaValida = null;
    this.mensagemSenha = '';

    try {
      // Prepara lista de arquivos para importação em lote
      const arquivosParaImportar = this.certificadosPendentes.map(cp => cp.file);

      // Chama o endpoint de importação em lote com contabilidade_id se houver contabilidade global selecionada
      const resultado = await new Promise<CertificadoImportacaoLoteResponse>((resolve, reject) => {
        this.certificadoService.importarCertificadosLote(
          arquivosParaImportar, 
          senha,
          this.contabilidadeGlobalSelecionada
        ).subscribe({
          next: resolve,
          error: reject
        });
      });

      // Processa resultados
      let sucessoCount = 0;
      let falhaCount = 0;

      if (resultado.resultados) {
        resultado.resultados.forEach((item, index) => {
          if (item.sucesso && item.cnpj) {
            // Adiciona certificado importado à lista local
            const cnpjLimpo = item.cnpj.replace(/[^\d]/g, '');
            const dataValidade = item.data_vencimento ? new Date(item.data_vencimento) : null;
            const diasAteExpiracao = this.certificadoService.calcularDiasAteExpiracao(dataValidade);
            const status = this.certificadoService.obterStatusCertificado(diasAteExpiracao);
            
            const novoCertificado: Certificado = {
              id: cnpjLimpo,
              cnpj: cnpjLimpo,
              nomeArquivo: item.empresa || item.nome_arquivo,
              dataUpload: new Date(),
              dataValidade,
              diasAteExpiracao,
              status
            };
            
            this.certificadoService.adicionarCertificadoLocal(novoCertificado);
            sucessoCount++;
          } else {
            falhaCount++;
          }
        });
      }

      // Remove todos os certificados pendentes (tanto os que foram importados quanto os que falharam)
      this.certificadosPendentes = [];

      // Mostra mensagem de sucesso
      this.senhaValida = true;
      this.mensagemSenha = `Importação concluída: ${sucessoCount} importado(s) com sucesso, ${falhaCount} falha(s).`;

      // Fecha o modal após um tempo
      setTimeout(() => {
        this.fecharModal();
      }, 2000);

    } catch (error: any) {
      console.error('Erro ao importar certificados em lote:', error);
      this.senhaValida = false;
      if (error.error?.detail) {
        this.mensagemSenha = `Erro: ${error.error.detail}`;
      } else if (error.message) {
        this.mensagemSenha = `Erro: ${error.message}`;
      } else {
        this.mensagemSenha = 'Erro ao importar certificados em lote. Verifique o console para mais detalhes.';
      }
    } finally {
      this.importando = false;
    }
  }

  async importarLote() {
    if (!this.senhaImportacaoLote || !this.senhaImportacaoLote.trim()) {
      alert('Por favor, informe a senha para importação.');
      return;
    }

    if (this.arquivosImportacaoLote.length === 0) {
      alert('Nenhum arquivo selecionado.');
      return;
    }

    // Verifica se há contabilidade global selecionada
    if (this.contabilidadeGlobalSelecionada === null) {
      const confirmar = confirm(
        'Nenhuma contabilidade foi selecionada globalmente.\n\n' +
        'Os certificados serão importados sem vínculo à contabilidade.\n\n' +
        'Deseja continuar mesmo assim?'
      );
      if (!confirmar) {
        return;
      }
    }

    this.importandoLote = true;
    this.resultadosImportacao = null;

    try {
      // Importa os certificados em lote com contabilidade_id se houver contabilidade global selecionada
      const resultado = await new Promise<CertificadoImportacaoLoteResponse>((resolve, reject) => {
        this.certificadoService.importarCertificadosLote(
          this.arquivosImportacaoLote, 
          this.senhaImportacaoLote,
          this.contabilidadeGlobalSelecionada
        ).subscribe({
          next: resolve,
          error: reject
        });
      });

      this.resultadosImportacao = resultado;
      
      // Nota: Se contabilidade foi passada no importarCertificadosLote, os certificados já foram vinculados.
      // O código abaixo é mantido para compatibilidade com certificados já importados sem vínculo.
      if (this.contabilidadeGlobalSelecionada !== null && resultado.resultados) {
        const certificadosParaVincular = resultado.resultados
          .filter(item => item.sucesso && item.cnpj)
          .map(item => {
            // Encontra o arquivo original correspondente
            const arquivoOriginal = this.arquivosImportacaoLote.find(f => 
              f.name === item.nome_arquivo
            );
            return { item, arquivo: arquivoOriginal };
          })
          .filter(({ arquivo }) => arquivo !== undefined);

        // Vincula cada certificado à contabilidade
        for (const { item, arquivo } of certificadosParaVincular) {
          try {
            await new Promise<void>((resolve, reject) => {
              this.certificadoService.importarCertificadoComContabilidade(
                arquivo!,
                this.senhaImportacaoLote,
                this.contabilidadeGlobalSelecionada!
              ).subscribe({
                next: () => resolve(),
                error: (err) => {
                  console.warn(`Erro ao vincular certificado ${item.nome_arquivo} à contabilidade:`, err);
                  resolve(); // Continua mesmo se houver erro na vinculação
                }
              });
            });
          } catch (err) {
            console.warn(`Erro ao vincular certificado ${item.nome_arquivo}:`, err);
          }
        }
      }
      
      // Adiciona os certificados importados com sucesso à lista local
      if (resultado.resultados) {
        resultado.resultados.forEach(item => {
          if (item.sucesso && item.cnpj) {
            const cnpjLimpo = item.cnpj.replace(/[^\d]/g, '');
            const dataValidade = item.data_vencimento ? new Date(item.data_vencimento) : null;
            const diasAteExpiracao = this.certificadoService.calcularDiasAteExpiracao(dataValidade);
            const status = this.certificadoService.obterStatusCertificado(diasAteExpiracao);
            
            const contabilidadeSelecionada = this.contabilidades.find(c => 
              c.id === this.contabilidadeGlobalSelecionada
            );
            
            const novoCertificado: Certificado = {
              id: cnpjLimpo,
              cnpj: cnpjLimpo,
              nomeArquivo: item.empresa || item.nome_arquivo,
              dataUpload: new Date(),
              dataValidade,
              diasAteExpiracao,
              status,
              contabilidade_id: this.contabilidadeGlobalSelecionada || undefined,
              contabilidade_nome: contabilidadeSelecionada?.nome_contabilidade
            };
            
            this.certificadoService.adicionarCertificadoLocal(novoCertificado);
          }
        });
      }
      
    } catch (error: any) {
      console.error('Erro ao importar certificados em lote:', error);
      alert('Erro ao importar certificados. Verifique o console para mais detalhes.');
    } finally {
      this.importandoLote = false;
    }
  }

  // ============================================================================
  // Métodos para gerenciar certificados pendentes persistentes
  // ============================================================================

  private carregarCertificadosPendentes() {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY_PENDENTES);
      if (stored) {
        const pendentes: CertificadoPendentePersistente[] = JSON.parse(stored);
        // Não converte para CertificadoPendente aqui, apenas mantém em memória para contagem
        // A conversão será feita quando o usuário clicar para retomar
      }
    } catch (e) {
      console.error('Erro ao carregar certificados pendentes:', e);
    }
  }

  private salvarCertificadoPendente() {
    if (!this.certificadoAtual) return;

    try {
      const stored = localStorage.getItem(this.STORAGE_KEY_PENDENTES);
      const pendentes: CertificadoPendentePersistente[] = stored ? JSON.parse(stored) : [];

      // Remove se já existir
      const index = pendentes.findIndex(p => p.id === this.certificadoAtual!.id);
      if (index !== -1) {
        pendentes.splice(index, 1);
      }

      // Adiciona/atualiza o pendente
      const pendente: CertificadoPendentePersistente = {
        fileName: this.certificadoAtual.file.name,
        cnpj: this.certificadoAtual.cnpj,
        id: this.certificadoAtual.id,
        senha: this.certificadoAtual.senha,
        dadosExtraidos: this.certificadoAtual.dadosExtraidos,
        contabilidadeId: this.contabilidadeGlobalSelecionada || this.certificadoAtual.contabilidadeId || undefined,
        dataCriacao: new Date().toISOString()
      };

      pendentes.push(pendente);
      localStorage.setItem(this.STORAGE_KEY_PENDENTES, JSON.stringify(pendentes));
    } catch (e) {
      console.error('Erro ao salvar certificado pendente:', e);
    }
  }

  private removerCertificadoPendente(id: string) {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY_PENDENTES);
      if (stored) {
        const pendentes: CertificadoPendentePersistente[] = JSON.parse(stored);
        const filtrados = pendentes.filter(p => p.id !== id);
        localStorage.setItem(this.STORAGE_KEY_PENDENTES, JSON.stringify(filtrados));
      }
    } catch (e) {
      console.error('Erro ao remover certificado pendente:', e);
    }
  }

  obterCertificadosPendentesCount(): number {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY_PENDENTES);
      if (stored) {
        const pendentes: CertificadoPendentePersistente[] = JSON.parse(stored);
        
        // Se houver contabilidade global selecionada, filtra por ela
        if (this.contabilidadeGlobalSelecionada !== null) {
          return pendentes.filter(p => 
            p.contabilidadeId === this.contabilidadeGlobalSelecionada || !p.contabilidadeId
          ).length;
        }
        
        return pendentes.length;
      }
      return 0;
    } catch (e) {
      console.error('Erro ao contar certificados pendentes:', e);
      return 0;
    }
  }

  private obterProximoCertificadoPendente(): CertificadoPendentePersistente | null {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY_PENDENTES);
      if (stored) {
        const pendentes: CertificadoPendentePersistente[] = JSON.parse(stored);
        
        // Filtra por contabilidade se houver seleção global
        let filtrados = pendentes;
        if (this.contabilidadeGlobalSelecionada !== null) {
          filtrados = pendentes.filter(p => 
            p.contabilidadeId === this.contabilidadeGlobalSelecionada || !p.contabilidadeId
          );
        }
        
        // Ordena por data de criação (mais antigo primeiro)
        filtrados.sort((a, b) => 
          new Date(a.dataCriacao).getTime() - new Date(b.dataCriacao).getTime()
        );
        
        return filtrados.length > 0 ? filtrados[0] : null;
      }
      return null;
    } catch (e) {
      console.error('Erro ao obter próximo certificado pendente:', e);
      return null;
    }
  }

  async retomarCertificadoPendente(pendente: CertificadoPendentePersistente) {
    // Como não podemos recriar o objeto File do localStorage, vamos:
    // 1. Informar ao usuário que precisa selecionar o arquivo novamente
    // 2. Armazenar temporariamente os dados do pendente para restaurar quando o arquivo for selecionado
    // 3. Remover o pendente da lista persistente
    
    const mensagem = pendente.dadosExtraidos && pendente.senha
      ? `Para continuar a configuração do certificado "${pendente.fileName}", por favor selecione o arquivo novamente. Os dados já preenchidos serão restaurados automaticamente.`
      : `Para continuar a configuração do certificado "${pendente.fileName}", por favor selecione o arquivo novamente.`;
    
    // Armazena temporariamente os dados para restaurar quando o arquivo for selecionado
    if (pendente.dadosExtraidos && pendente.senha) {
      sessionStorage.setItem('certificado_pendente_restaurar', JSON.stringify({
        fileName: pendente.fileName,
        senha: pendente.senha,
        dadosExtraidos: pendente.dadosExtraidos,
        contabilidadeId: pendente.contabilidadeId
      }));
    }
    
    alert(mensagem);
    
    // Remove o pendente da lista persistente
    this.removerCertificadoPendente(pendente.id);
    
    // Foca no input de arquivo para facilitar a seleção
    const fileInput = document.querySelector('input[type="file"][accept=".pfx,.p12"]') as HTMLInputElement;
    if (fileInput) {
      fileInput.click();
    }
  }

  async retomarProximoCertificadoPendente() {
    const proximo = this.obterProximoCertificadoPendente();
    if (proximo) {
      await this.retomarCertificadoPendente(proximo);
    } else {
      alert('Não há certificados pendentes para retomar.');
    }
  }

  private restaurarDadosPendenteSeExistir(fileName: string): CertificadoPendente | null {
    try {
      const stored = sessionStorage.getItem('certificado_pendente_restaurar');
      if (stored) {
        const dados: any = JSON.parse(stored);
        if (dados.fileName === fileName) {
          // Remove da sessionStorage após usar
          sessionStorage.removeItem('certificado_pendente_restaurar');
          return dados;
        }
      }
    } catch (e) {
      console.error('Erro ao restaurar dados pendentes:', e);
    }
    return null;
  }

  get contabilidadeSelecionadaNome(): string {
    if (!this.contabilidadeGlobalSelecionada) {
      return '';
    }
    const contabilidade = this.contabilidades.find(c => c.id == this.contabilidadeGlobalSelecionada);
    return contabilidade?.nome_contabilidade || '';
  }
}
