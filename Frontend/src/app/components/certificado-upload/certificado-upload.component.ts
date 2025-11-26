import { Component, OnInit, OnDestroy } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators, FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { CertificadoService, Certificado } from '../../services/certificado.service';
import { Subject, takeUntil } from 'rxjs';

interface CertificadoPendente {
  file: File;
  cnpj: string;
  id: string;
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
  
  // Filtros e ordenação
  filtroVencidos = false;
  ordenacao: 'proximidade' | 'maior_validade' | 'alfabetica' = 'proximidade';
  
  // Modal
  modalAberto = false;
  certificadoAtual: CertificadoPendente | null = null;
  senhaForm: FormGroup;
  validandoSenha = false;
  senhaValida: boolean | null = null;
  mensagemSenha = '';
  
  // Upload em lote
  carregando = false;
  mensagem = '';
  
  private destroy$ = new Subject<void>();

  constructor(
    private fb: FormBuilder,
    private certificadoService: CertificadoService
  ) {
    this.senhaForm = this.fb.group({
      senha: ['', [Validators.required]],
      dataValidade: ['']
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

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onFilesSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const files = Array.from(input.files);
      
      files.forEach(file => {
        // Extrai CNPJ do nome do arquivo (assumindo formato: CNPJ.pfx ou similar)
        const nomeSemExtensao = file.name.replace(/\.(pfx|p12)$/i, '');
        const cnpjLimpo = nomeSemExtensao.replace(/[^\d]/g, '');
        
        if (cnpjLimpo.length === 14) {
          this.certificadosPendentes.push({
            file,
            cnpj: cnpjLimpo,
            id: `${Date.now()}-${Math.random()}`
          });
        } else {
          // Se não conseguir extrair CNPJ do nome, adiciona para inserção manual
          this.certificadosPendentes.push({
            file,
            cnpj: '',
            id: `${Date.now()}-${Math.random()}`
          });
        }
      });
      
      // Abre modal para o primeiro certificado pendente
      if (this.certificadosPendentes.length > 0) {
        this.abrirModalSenha(this.certificadosPendentes[0]);
      }
    }
  }

  abrirModalSenha(certificado: CertificadoPendente) {
    this.certificadoAtual = certificado;
    this.senhaForm.patchValue({ senha: '', dataValidade: '' });
    this.senhaValida = null;
    this.mensagemSenha = '';
    this.modalAberto = true;
    
    // Se CNPJ não foi extraído, permite edição
    if (!certificado.cnpj) {
      this.senhaForm.addControl('cnpj', this.fb.control('', [Validators.required, Validators.pattern(/^\d{14}$/)]));
    } else {
      if (this.senhaForm.get('cnpj')) {
        this.senhaForm.removeControl('cnpj');
      }
    }
  }

  fecharModal() {
    this.modalAberto = false;
    this.certificadoAtual = null;
    this.senhaValida = null;
    this.mensagemSenha = '';
    this.validandoSenha = false;
  }

  async validarSenha() {
    if (!this.certificadoAtual || !this.senhaForm.valid) return;

    this.validandoSenha = true;
    this.senhaValida = null;
    this.mensagemSenha = '';

    if (!this.certificadoAtual) {
      this.senhaValida = false;
      this.mensagemSenha = 'Erro: certificado não encontrado';
      this.validandoSenha = false;
      return;
    }

    const senha = this.senhaForm.get('senha')?.value;
    const cnpj = this.certificadoAtual.cnpj || this.senhaForm.get('cnpj')?.value;
    const dataValidadeStr = this.senhaForm.get('dataValidade')?.value;

    try {
      // Valida a senha fazendo upload
      await new Promise((resolve, reject) => {
        this.certificadoService.uploadCertificado(
          cnpj,
          senha,
          this.certificadoAtual!.file
        ).subscribe({
          next: resolve,
          error: reject
        });
      });

      // Se chegou aqui, senha é válida
      this.senhaValida = true;
      this.mensagemSenha = 'Senha válida!';

      // Cria objeto de certificado
      const dataValidade = dataValidadeStr ? new Date(dataValidadeStr) : null;
      const diasAteExpiracao = this.certificadoService.calcularDiasAteExpiracao(dataValidade);
      const status = this.certificadoService.obterStatusCertificado(diasAteExpiracao);

      const novoCertificado: Certificado = {
        id: this.certificadoAtual.id,
        cnpj,
        nomeArquivo: this.certificadoAtual.file.name,
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
      }, 1000);

    } catch (error: any) {
      this.senhaValida = false;
      if (error.error?.detail) {
        this.mensagemSenha = error.error.detail;
      } else if (error.message) {
        this.mensagemSenha = error.message;
      } else {
        this.mensagemSenha = 'Senha inválida ou erro ao validar certificado';
      }
    } finally {
      this.validandoSenha = false;
    }
  }

  aplicarFiltrosEOrdenacao() {
    let resultado = [...this.certificados];

    // Filtro de vencidos
    if (this.filtroVencidos) {
      resultado = resultado.filter(c => c.status === 'vencido');
    }

    // Ordenação
    switch (this.ordenacao) {
      case 'proximidade':
        resultado.sort((a, b) => {
          const diasA = a.diasAteExpiracao ?? Infinity;
          const diasB = b.diasAteExpiracao ?? Infinity;
          return diasA - diasB;
        });
        break;
      case 'maior_validade':
        resultado.sort((a, b) => {
          const diasA = a.diasAteExpiracao ?? -Infinity;
          const diasB = b.diasAteExpiracao ?? -Infinity;
          return diasB - diasA;
        });
        break;
      case 'alfabetica':
        resultado.sort((a, b) => a.cnpj.localeCompare(b.cnpj));
        break;
    }

    this.certificadosFiltrados = resultado;
  }

  onFiltroVencidosChange() {
    this.aplicarFiltrosEOrdenacao();
  }

  onOrdenacaoChange() {
    this.aplicarFiltrosEOrdenacao();
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
}
