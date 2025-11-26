import { Component, OnInit, OnDestroy } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators, FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { CertificadoService, Certificado } from '../../services/certificado.service';
import { Subject, takeUntil } from 'rxjs';
import jsPDF from 'jspdf';
// @ts-ignore - jspdf-autotable não tem tipos TypeScript completos
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

interface CertificadoPendente {
  file: File;
  cnpj: string;
  id: string;
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
  imports: [ReactiveFormsModule, FormsModule, CommonModule],
  templateUrl: './certificado-upload.component.html',
  styleUrls: ['./certificado-upload.component.scss'],
})
export class CertificadoUploadComponent implements OnInit, OnDestroy {
  certificados: Certificado[] = [];
  certificadosFiltrados: Certificado[] = [];
  certificadosPendentes: CertificadoPendente[] = [];
  
  // Nova lógica de filtragem e ordenação
  sortState: SortState = { column: null, direction: null };
  searchColumn: SearchColumn = 'cnpj';
  searchValue: string = '';
  filtroVencidos = false;
  
  // Modal
  modalAberto = false;
  certificadoAtual: CertificadoPendente | null = null;
  senhaForm: FormGroup;
  validandoSenha = false;
  senhaValida: boolean | null = null;
  mensagemSenha = '';
  importando = false;
  
  // Upload em lote
  carregando = false;
  mensagem = '';
  
  // Opções de busca
  searchColumns: { value: SearchColumn; label: string }[] = [
    { value: 'cnpj', label: 'CNPJ' },
    { value: 'nomeArquivo', label: 'Empresa' },
    { value: 'dataUpload', label: 'Data de Upload' },
    { value: 'dataValidade', label: 'Data de Validade' },
    { value: 'diasAteExpiracao', label: 'Dias até Expiração' },
    { value: 'status', label: 'Status' }
  ];
  
  private destroy$ = new Subject<void>();

  constructor(
    private fb: FormBuilder,
    private certificadoService: CertificadoService
  ) {
    this.senhaForm = this.fb.group({
      senha: ['', [Validators.required]]
    });
  }

  ngOnInit() {
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
      
      files.forEach(file => {
        this.certificadosPendentes.push({
          file,
          cnpj: '', // CNPJ será extraído automaticamente pelo backend
          id: `${Date.now()}-${Math.random()}`
        });
      });
      
      // Abre modal para o primeiro certificado pendente
      if (this.certificadosPendentes.length > 0) {
        this.abrirModalSenha(this.certificadosPendentes[0]);
      }
    }
  }

  abrirModalSenha(certificado: CertificadoPendente) {
    this.certificadoAtual = certificado;
    this.senhaForm.patchValue({ senha: '' });
    this.senhaValida = null;
    this.mensagemSenha = '';
    this.importando = false;
    this.modalAberto = true;
  }

  fecharModal() {
    this.modalAberto = false;
    this.certificadoAtual = null;
    this.senhaValida = null;
    this.mensagemSenha = '';
    this.validandoSenha = false;
    this.importando = false;
    this.senhaForm.reset();
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
      // Importa o certificado e extrai informações
      const resultado = await new Promise<any>((resolve, reject) => {
        this.certificadoService.importarCertificado(
          this.certificadoAtual!.file,
          senha
        ).subscribe({
          next: resolve,
          error: reject
        });
      });

      // Verifica se a importação foi bem-sucedida
      if (resultado.success && resultado.cnpj && resultado.empresa) {
        this.senhaValida = true;
        this.mensagemSenha = 'Certificado importado com sucesso!';

        // Extrai CNPJ limpo (sem formatação)
        const cnpjLimpo = resultado.cnpj.replace(/[^\d]/g, '');
        
        // Faz upload do certificado com o CNPJ extraído
        await new Promise((resolve, reject) => {
          this.certificadoService.uploadCertificado(
            cnpjLimpo,
            senha,
            this.certificadoAtual!.file
          ).subscribe({
            next: resolve,
            error: reject
          });
        });

        // Cria objeto de certificado com dados extraídos
        const dataValidade = resultado.dataVencimento ? new Date(resultado.dataVencimento) : null;
        const diasAteExpiracao = this.certificadoService.calcularDiasAteExpiracao(dataValidade);
        const status = this.certificadoService.obterStatusCertificado(diasAteExpiracao);

        // Usa o nome da empresa retornado pela API (já vem sem o CNPJ após ":")
        // Se não vier, usa o nome do arquivo como fallback
        const nomeEmpresa = resultado.empresa || this.certificadoAtual.file.name;

        const novoCertificado: Certificado = {
          id: this.certificadoAtual.id,
          cnpj: cnpjLimpo,
          nomeArquivo: nomeEmpresa,
          dataUpload: new Date(),
          dataValidade,
          diasAteExpiracao,
          status
        };

        this.certificadoService.adicionarCertificadoLocal(novoCertificado);

        // Remove da lista de pendentes
        this.certificadosPendentes = this.certificadosPendentes.filter(
          c => c.id !== this.certificadoAtual!.id
        );

        // Aguarda um pouco para mostrar mensagem de sucesso
        setTimeout(() => {
          this.fecharModal();
          
          // Abre próximo certificado pendente se houver
          if (this.certificadosPendentes.length > 0) {
            setTimeout(() => {
              this.abrirModalSenha(this.certificadosPendentes[0]);
            }, 500);
          }
        }, 1500);

      } else {
        // Erro na importação
        this.senhaValida = false;
        this.mensagemSenha = resultado.message || 'Erro ao importar certificado';
      }

    } catch (error: any) {
      this.senhaValida = false;
      if (error.message) {
        this.mensagemSenha = error.message;
      } else if (error.error?.message) {
        this.mensagemSenha = error.error.message;
      } else if (error.error?.detail) {
        this.mensagemSenha = error.error.detail;
      } else {
        this.mensagemSenha = 'Senha incorreta ou erro ao processar certificado';
      }
    } finally {
      this.importando = false;
    }
  }

  aplicarFiltrosEOrdenacao() {
    let resultado = [...this.certificados];

    // 1. Filtro de busca por texto
    if (this.searchValue.trim()) {
      const searchLower = this.searchValue.trim().toLowerCase();
      resultado = resultado.filter(certificado => {
        const cellValue = this.getCellValue(certificado, this.searchColumn).toLowerCase();
        return cellValue.includes(searchLower);
      });
    }

    // 2. Filtro de vencidos
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

  removerCertificado(id: string) {
    if (confirm('Tem certeza que deseja remover este certificado?')) {
      this.certificadoService.removerCertificado(id);
    }
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
}
