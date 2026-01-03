import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators, FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { CredenciaisService } from '../../services/credenciais.service';
import { EmpresasService } from '../../services/empresas.service';
import { ContabilidadeService } from '../../services/contabilidade.service';
import { CredencialCreate, CredencialUpdate, CredencialResponse } from '../../models/credenciais.model';
import { Empresa, EmpresaCreate } from '../../models/empresas.model';
import { Contabilidade } from '../../models/contabilidade.model';
import { firstValueFrom } from 'rxjs';
import jsPDF from 'jspdf';
// @ts-ignore - jspdf-autotable não tem tipos TypeScript completos
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

interface EmpresaComCredenciais extends Empresa {
  credenciais?: CredencialResponse[];
  senhaVisivel?: { [key: number]: boolean }; // Controla visibilidade de senhas por credencial_id
}

type SortDirection = 'asc' | 'desc' | null;
type SortableColumn = 'cnpj' | 'razao_social' | 'usuario' | 'tipo' | 'regime' | null;
type SearchColumn = 'cnpj' | 'razao_social' | 'usuario' | 'tipo' | 'regime';

@Component({
  selector: 'app-credenciais',
  standalone: true,
  imports: [ReactiveFormsModule, FormsModule, CommonModule, RouterModule],
  templateUrl: './credenciais.component.html',
  styleUrls: ['./credenciais.component.scss']
})
export class CredenciaisComponent implements OnInit {
  credenciaisForm: FormGroup;
  edicaoForm: FormGroup;
  contabilidadeForm: FormGroup;
  
  empresas: EmpresaComCredenciais[] = [];
  empresasFiltradas: EmpresaComCredenciais[] = [];
  contabilidades: Contabilidade[] = [];
  contabilidadeSelecionadaId: number | null = null;
  
  // Fluxo de dois passos no modal
  passoAtualModal: 1 | 2 = 1;
  dadosCadastro: any = null;
  
  // Filtros e ordenação (similar ao certificado-upload)
  sortState: { column: SortableColumn; direction: SortDirection } = { column: null, direction: null };
  searchColumn: SearchColumn = 'cnpj';
  searchValue: string = '';
  
  searchColumns: { value: SearchColumn; label: string }[] = [
    { value: 'cnpj', label: 'CNPJ' },
    { value: 'razao_social', label: 'Razão Social' },
    { value: 'usuario', label: 'Usuário' },
    { value: 'tipo', label: 'Tipo' },
    { value: 'regime', label: 'Regime' }
  ];
  
  // Armazenamento de senhas obtidas do backend
  senhasObtidas: Map<number, string> = new Map(); // credencial_id -> senha
  
  carregandoEmpresas = false;
  carregandoContabilidades = false;
  salvandoCredenciais = false;
  validandoCredenciais = false;
  validandoTodas = false;
  excluindoCredencial = false;
  excluindoEmpresa = false;
  carregandoSenha = false;
  
  modalCredenciaisAberto = false;
  modalValidacaoAberto = false;
  modalEdicaoAberto = false;
  modalSenhaAdminAberto = false;
  
  credencialEditando: CredencialResponse | null = null;
  empresaEditando: EmpresaComCredenciais | null = null;
  credencialIdPendente: number | null = null; // ID da credencial que está aguardando senha admin
  senhaAdmin = '';
  senhasDesbloqueadas: Set<number> = new Set(); // IDs de credenciais com senhas visíveis
  
  mensagemSucesso: string | null = null;
  mensagemErro: string | null = null;
  mensagemValidacao: string | null = null;
  validacaoSucesso: boolean | null = null;
  
  // Estados para seleção de cards
  tipoLoginSelecionado: 'cpf' | 'cnpj' = 'cnpj';
  regimeSelecionado: string = '';

  constructor(
    private fb: FormBuilder,
    private credenciaisService: CredenciaisService,
    private empresasService: EmpresasService,
    private contabilidadeService: ContabilidadeService
  ) {
    this.credenciaisForm = this.fb.group({
      empresa_id: [''],
      nome_empresa: ['', [Validators.required, Validators.minLength(3)]],
      tipo_login: ['cnpj', [Validators.required]],
      usuario: ['', [Validators.required]],
      senha: ['', [Validators.required]],
      regime: ['', [Validators.required]],
      portal: ['nfse_nacional']
    });
    
    this.edicaoForm = this.fb.group({
      senha: ['', [Validators.required]]
    });
    
    this.contabilidadeForm = this.fb.group({
      contabilidade_id: ['', [Validators.required]]
    });
  }

  ngOnInit(): void {
    this.carregarEmpresas();
    this.carregarContabilidades();
  }

  carregarEmpresas(): void {
    this.carregandoEmpresas = true;
    this.empresasService.listar().subscribe({
      next: async (empresas) => {
        this.empresas = []; // Limpa empresas existentes
        
        // Carrega credenciais para cada empresa e só adiciona se tiver credenciais
        for (const empresa of empresas) {
          try {
            const response = await firstValueFrom(this.credenciaisService.obterPorEmpresa(empresa.id));
            if (response?.credenciais && response.credenciais.length > 0) {
              // Adiciona tipo_login calculado a cada credencial
              const credenciaisComTipoLogin = response.credenciais.map(credencial => ({
                ...credencial,
                tipo_login: this.obterTipoLoginDeTipo(credencial.tipo)
              }));
              
              // Só adiciona empresas que têm credenciais
              this.empresas.push({
                ...empresa,
                credenciais: credenciaisComTipoLogin,
                senhaVisivel: {}
              });
            }
          } catch (error) {
            console.error(`Erro ao carregar credenciais da empresa ${empresa.id}:`, error);
            // Não adiciona empresas sem credenciais
          }
        }
        
        console.log('📊 Empresas carregadas:', this.empresas.length);
        console.log('🔍 Contabilidade selecionada:', this.contabilidadeSelecionadaId);
        this.empresas.forEach(e => {
          console.log(`  - ${e.razao_social} (CNPJ: ${e.cnpj}) - Contabilidade ID: ${e.contabilidade_id}`);
        });
        
        this.aplicarFiltrosEOrdenacao();
        this.carregandoEmpresas = false;
      },
      error: (error) => {
        console.error('Erro ao carregar empresas:', error);
        this.mensagemErro = 'Erro ao carregar empresas';
        this.carregandoEmpresas = false;
      }
    });
  }

  filtrarEmpresasPorContabilidade(): void {
    this.aplicarFiltrosEOrdenacao();
  }

  aplicarFiltrosEOrdenacao(): void {
    let resultado = [...this.empresas];

    // 1. Filtro por contabilidade (primeiro filtro aplicado)
    if (this.contabilidadeSelecionadaId !== null) {
      resultado = resultado.filter(empresa => {
        // Compara convertendo ambos para número para evitar problemas de tipo
        const empresaContabilidadeId = empresa.contabilidade_id !== null && empresa.contabilidade_id !== undefined 
          ? Number(empresa.contabilidade_id) 
          : null;
        const selecionadaId = Number(this.contabilidadeSelecionadaId);
        const match = empresaContabilidadeId === selecionadaId;
        if (!match) {
          console.log(`❌ Empresa ${empresa.razao_social} não corresponde ao filtro: empresa.contabilidade_id=${empresaContabilidadeId}, filtro=${selecionadaId}`);
        }
        return match;
      });
      console.log(`✅ Filtro aplicado: ${resultado.length} empresas de ${this.empresas.length} total`);
    }

    // 1.5. Filtrar apenas empresas COM credenciais cadastradas
    resultado = resultado.filter(empresa => 
      empresa.credenciais && empresa.credenciais.length > 0
    );

    // 2. Filtro de busca por texto
    if (this.searchValue.trim()) {
      const searchLower = this.searchValue.trim().toLowerCase();
      resultado = resultado.filter(empresa => {
        // Busca nas empresas e suas credenciais
        const credencial = empresa.credenciais?.[0];
        let cellValue = '';
        
            switch (this.searchColumn) {
              case 'cnpj':
                const credencial = empresa.credenciais?.[0];
                cellValue = this.formatarCPFouCNPJ(empresa.cnpj, credencial?.tipo_login).toLowerCase();
            break;
          case 'razao_social':
            cellValue = (empresa.razao_social || '').toLowerCase();
            break;
          case 'usuario':
            cellValue = (credencial?.usuario || '').toLowerCase();
            break;
          case 'tipo':
            cellValue = (credencial?.tipo || '').toLowerCase();
            break;
          case 'regime':
            cellValue = (empresa.regime || '').toLowerCase();
            break;
        }
        
        return cellValue.includes(searchLower);
      });
    }

    // 3. Ordenação
    if (this.sortState.column && this.sortState.direction) {
      resultado.sort((a, b) => {
        const credencialA = a.credenciais?.[0];
        const credencialB = b.credenciais?.[0];
        let comparison = 0;
        
        switch (this.sortState.column) {
          case 'cnpj':
            comparison = a.cnpj.localeCompare(b.cnpj);
            break;
          case 'razao_social':
            comparison = (a.razao_social || '').localeCompare(b.razao_social || '');
            break;
          case 'usuario':
            comparison = (credencialA?.usuario || '').localeCompare(credencialB?.usuario || '');
            break;
          case 'tipo':
            comparison = (credencialA?.tipo || '').localeCompare(credencialB?.tipo || '');
            break;
          case 'regime':
            comparison = (a.regime || '').localeCompare(b.regime || '');
            break;
        }
        
        return this.sortState.direction === 'asc' ? comparison : -comparison;
      });
    }

    this.empresasFiltradas = resultado;
  }

  toggleSort(column: SortableColumn): void {
    if (this.sortState.column === column) {
      if (this.sortState.direction === 'asc') {
        this.sortState = { column, direction: 'desc' };
      } else if (this.sortState.direction === 'desc') {
        this.sortState = { column: null, direction: null };
      } else {
        this.sortState = { column, direction: 'asc' };
      }
    } else {
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

  onSearchChange(): void {
    this.aplicarFiltrosEOrdenacao();
  }

  onSearchColumnChange(): void {
    this.searchValue = '';
    this.aplicarFiltrosEOrdenacao();
  }

  onContabilidadeChange(contabilidadeId: string | number | null): void {
    if (contabilidadeId === '' || contabilidadeId === null || contabilidadeId === 'null') {
      this.contabilidadeSelecionadaId = null;
    } else {
      const id = typeof contabilidadeId === 'string' ? parseInt(contabilidadeId) : contabilidadeId;
      this.contabilidadeSelecionadaId = isNaN(id) ? null : id;
    }
    this.filtrarEmpresasPorContabilidade();
  }

  carregarContabilidades(): void {
    this.carregandoContabilidades = true;
    this.contabilidadeService.listar().subscribe({
      next: (response) => {
        this.contabilidades = response.contabilidades || [];
        this.carregandoContabilidades = false;
      },
      error: (error) => {
        console.error('Erro ao carregar contabilidades:', error);
        this.mensagemErro = 'Erro ao carregar contabilidades';
        this.carregandoContabilidades = false;
      }
    });
  }

  abrirModalCredenciais(): void {
    this.modalCredenciaisAberto = true;
    this.passoAtualModal = 1;
    this.tipoLoginSelecionado = 'cnpj';
    this.regimeSelecionado = '';
    this.dadosCadastro = null;
    this.credenciaisForm.reset({
      tipo_login: 'cnpj',
      portal: 'nfse_nacional'
    });
    this.contabilidadeForm.reset();
    this.mensagemErro = null;
    
    // Garante que as contabilidades estão carregadas
    if (this.contabilidades.length === 0) {
      this.carregarContabilidades();
    }
  }

  fecharModalCredenciais(): void {
    this.modalCredenciaisAberto = false;
    this.passoAtualModal = 1;
    this.tipoLoginSelecionado = 'cnpj';
    this.regimeSelecionado = '';
    this.dadosCadastro = null;
    this.credenciaisForm.reset({
      tipo_login: 'cnpj',
      portal: 'nfse_nacional'
    });
    this.contabilidadeForm.reset();
    this.mensagemErro = null;
    this.salvandoCredenciais = false;
  }

  selecionarTipoLogin(tipo: 'cpf' | 'cnpj'): void {
    this.tipoLoginSelecionado = tipo;
    this.credenciaisForm.patchValue({ tipo_login: tipo });
    this.credenciaisForm.patchValue({ usuario: '' });
  }

  selecionarRegime(regime: string): void {
    this.regimeSelecionado = regime;
    this.credenciaisForm.patchValue({ regime: regime });
  }

  salvarCredenciais(): void {
    if (this.credenciaisForm.invalid) {
      this.marcarCamposComErro(this.credenciaisForm);
      return;
    }

    this.mensagemErro = null;
    this.mensagemSucesso = null;

    const formValue = this.credenciaisForm.getRawValue();
    const nomeEmpresa = formValue.nome_empresa;
    const regime = formValue.regime;
    const usuario = formValue.usuario.replace(/[^\d]/g, '');
    
    if (formValue.tipo_login === 'cnpj' && usuario.length !== 14) {
      this.mensagemErro = 'CNPJ deve conter 14 dígitos';
      return;
    }
    if (formValue.tipo_login === 'cpf' && usuario.length !== 11) {
      this.mensagemErro = 'CPF deve conter 11 dígitos';
      return;
    }
    
    // Salva os dados do cadastro e avança para o passo 2 (seleção de contabilidade)
    this.dadosCadastro = {
      nome_empresa: nomeEmpresa,
      regime: regime,
      usuario: usuario,
      tipo_login: formValue.tipo_login,
      senha: formValue.senha,
      portal: formValue.portal,
      cnpj: formValue.tipo_login === 'cnpj' ? usuario : usuario.padStart(14, '0')
    };
    
    // Avança para o passo 2
    this.passoAtualModal = 2;
    
    // Se houver contabilidade global selecionada, pré-preenche
    if (this.contabilidadeSelecionadaId) {
      this.contabilidadeForm.patchValue({ contabilidade_id: this.contabilidadeSelecionadaId.toString() });
    } else {
      this.contabilidadeForm.patchValue({ contabilidade_id: '' });
    }
    
    // Garante que as contabilidades estão carregadas
    if (this.contabilidades.length === 0) {
      this.carregarContabilidades();
    }
  }

  confirmarVinculacao(): void {
    if (!this.dadosCadastro) {
      this.mensagemErro = 'Erro: dados do cadastro não encontrados';
      return;
    }

    // Determina a contabilidade a usar (global ou do formulário)
    let contabilidadeId: number | null = null;
    
    if (this.contabilidadeSelecionadaId !== null) {
      // Usa a contabilidade global se estiver selecionada
      contabilidadeId = this.contabilidadeSelecionadaId;
      console.log('🔍 Usando contabilidade global:', contabilidadeId);
    } else {
      // Se não há contabilidade global, valida o formulário
      if (this.contabilidadeForm.invalid) {
        this.marcarCamposComErro(this.contabilidadeForm);
        return;
      }
      // Usa a contabilidade do formulário
      const formValue = this.contabilidadeForm.get('contabilidade_id')?.value;
      if (formValue) {
        contabilidadeId = parseInt(formValue);
        console.log('🔍 Usando contabilidade do formulário:', contabilidadeId);
      }
    }

    if (contabilidadeId === null || isNaN(contabilidadeId)) {
      this.mensagemErro = 'Selecione uma contabilidade';
      return;
    }

    this.salvandoCredenciais = true;
    this.mensagemErro = null;
    this.mensagemSucesso = null;
    
    const empresaData: EmpresaCreate = {
      cnpj: this.dadosCadastro.cnpj,
      razao_social: this.dadosCadastro.nome_empresa,
      regime: this.dadosCadastro.regime,
      contabilidade_id: contabilidadeId
    };
    
    console.log('🔍 Criando empresa com dados:', empresaData);
    
    this.empresasService.criar(empresaData).subscribe({
      next: (empresa) => {
        const credencialData: CredencialCreate = {
          empresa_id: empresa.id,
          usuario: this.dadosCadastro.usuario,
          senha: this.dadosCadastro.senha,
          tipo_login: this.dadosCadastro.tipo_login,
          portal: this.dadosCadastro.portal
        };
        
        this.credenciaisService.criarOuAtualizar(credencialData).subscribe({
          next: () => {
            console.log('✅ Credenciais criadas, empresa retornada:', empresa);
            console.log('🔍 Contabilidade ID da empresa:', empresa.contabilidade_id);
            this.mensagemSucesso = 'Credenciais salvas com sucesso!';
            this.carregarEmpresas();
            this.fecharModalCredenciais();
            setTimeout(() => this.mensagemSucesso = null, 3000);
          },
          error: (error) => {
            this.mensagemErro = error.error?.detail || error.message || 'Erro ao salvar credenciais';
            this.salvandoCredenciais = false;
          }
        });
      },
      error: (error) => {
        this.mensagemErro = error.error?.detail || error.message || 'Erro ao criar empresa';
        this.salvandoCredenciais = false;
      }
    });
  }

  voltarParaPasso1(): void {
    this.passoAtualModal = 1;
    this.dadosCadastro = null;
    this.mensagemErro = null;
    this.contabilidadeForm.reset();
  }

  abrirModalEdicao(empresa: EmpresaComCredenciais, credencial: CredencialResponse): void {
    this.empresaEditando = empresa;
    this.credencialEditando = credencial;
    this.edicaoForm.reset({
      senha: ''
    });
    this.modalEdicaoAberto = true;
    this.mensagemErro = null;
  }

  fecharModalEdicao(): void {
    this.modalEdicaoAberto = false;
    this.empresaEditando = null;
    this.credencialEditando = null;
    this.edicaoForm.reset();
    this.mensagemErro = null;
  }

  salvarEdicao(): void {
    if (!this.credencialEditando || this.edicaoForm.invalid) {
      this.marcarCamposComErro(this.edicaoForm);
      return;
    }

    const updateData: CredencialUpdate = {
      senha: this.edicaoForm.get('senha')?.value
    };

    this.credenciaisService.atualizar(this.credencialEditando.id, updateData).subscribe({
      next: () => {
        this.mensagemSucesso = 'Credencial atualizada com sucesso!';
        this.carregarEmpresas();
        this.fecharModalEdicao();
        setTimeout(() => this.mensagemSucesso = null, 3000);
      },
      error: (error) => {
        this.mensagemErro = error.error?.detail || error.message || 'Erro ao atualizar credencial';
      }
    });
  }

  excluirCredencial(credencialId: number): void {
    if (!confirm('Tem certeza que deseja excluir esta credencial?')) {
      return;
    }

    this.excluindoCredencial = true;
    this.credenciaisService.excluir(credencialId).subscribe({
      next: () => {
        this.mensagemSucesso = 'Credencial excluída com sucesso!';
        this.carregarEmpresas();
        setTimeout(() => this.mensagemSucesso = null, 3000);
        this.excluindoCredencial = false;
      },
      error: (error) => {
        this.mensagemErro = error.error?.detail || error.message || 'Erro ao excluir credencial';
        this.excluindoCredencial = false;
      }
    });
  }

  excluirEmpresa(empresaId: string): void {
    if (!confirm('Tem certeza que deseja excluir esta empresa? Esta ação não pode ser desfeita.')) {
      return;
    }

    this.excluindoEmpresa = true;
    this.empresasService.excluir(empresaId).subscribe({
      next: () => {
        this.mensagemSucesso = 'Empresa excluída com sucesso!';
        this.carregarEmpresas();
        setTimeout(() => this.mensagemSucesso = null, 3000);
        this.excluindoEmpresa = false;
      },
      error: (error) => {
        this.mensagemErro = error.error?.detail || error.message || 'Erro ao excluir empresa';
        this.excluindoEmpresa = false;
      }
    });
  }

  abrirModalValidacao(empresa?: EmpresaComCredenciais): void {
    if (empresa) {
      this.empresaEditando = empresa;
    }
    this.modalValidacaoAberto = true;
    this.mensagemValidacao = null;
    this.validacaoSucesso = null;
  }

  fecharModalValidacao(): void {
    this.modalValidacaoAberto = false;
    this.empresaEditando = null;
    this.mensagemValidacao = null;
    this.validacaoSucesso = null;
  }

  validarCredenciais(): void {
    if (!this.empresaEditando) {
      this.mensagemValidacao = 'Empresa não selecionada';
      this.validacaoSucesso = false;
      return;
    }

    this.validandoCredenciais = true;
    this.mensagemValidacao = null;
    this.validacaoSucesso = null;

    this.credenciaisService.validarCredenciais(this.empresaEditando.id, this.empresaEditando.cnpj).subscribe({
      next: (resultado) => {
        this.validacaoSucesso = true;
        this.mensagemValidacao = 'Credenciais validadas com sucesso!';
        this.carregarEmpresas();
      },
      error: (error) => {
        this.validacaoSucesso = false;
        this.mensagemValidacao = error.error?.detail || error.message || 'Erro ao validar credenciais. Verifique usuário e senha.';
      },
      complete: () => {
        this.validandoCredenciais = false;
      }
    });
  }

  validarTodasCredenciais(): void {
    const empresasComCredenciais = this.empresasFiltradas.filter(e => 
      e.credenciais && e.credenciais.length > 0
    );

    if (empresasComCredenciais.length === 0) {
      alert('Nenhuma empresa com credenciais encontrada para validar.');
      return;
    }

    if (!confirm(`Deseja validar credenciais de ${empresasComCredenciais.length} empresa(s)?`)) {
      return;
    }

    this.validandoTodas = true;
    const empresaIds = empresasComCredenciais.map(e => e.id);

    // Valida uma por uma (não em paralelo para não sobrecarregar)
    let validadas = 0;
    let falhas = 0;

    const validarProxima = (index: number) => {
      if (index >= empresaIds.length) {
        this.validandoTodas = false;
        alert(`Validação concluída: ${validadas} sucesso(s), ${falhas} falha(s).`);
        this.carregarEmpresas();
        return;
      }

      const empresaId = empresaIds[index];
      const empresa = empresasComCredenciais.find(e => e.id === empresaId);

      if (empresa && empresa.cnpj) {
        this.credenciaisService.validarCredenciais(empresaId, empresa.cnpj).subscribe({
          next: () => {
            validadas++;
            validarProxima(index + 1);
          },
          error: () => {
            falhas++;
            validarProxima(index + 1);
          }
        });
      } else {
        falhas++;
        validarProxima(index + 1);
      }
    };

    validarProxima(0);
  }

  abrirModalSenhaAdmin(): void {
    this.modalSenhaAdminAberto = true;
    this.senhaAdmin = '';
  }

  fecharModalSenhaAdmin(): void {
    this.modalSenhaAdminAberto = false;
    this.senhaAdmin = '';
  }

  verificarSenhaAdmin(): void {
    if (this.senhaAdmin === 'Admin123@') {
      // Se há uma credencial pendente, busca a senha do backend
      if (this.credencialIdPendente) {
        this.carregandoSenha = true;
        this.credenciaisService.obterSenha(this.credencialIdPendente, this.senhaAdmin).subscribe({
          next: (response) => {
            this.senhasObtidas.set(this.credencialIdPendente!, response.senha);
            this.senhasDesbloqueadas.add(this.credencialIdPendente!);
            this.credencialIdPendente = null;
            this.carregandoSenha = false;
            this.fecharModalSenhaAdmin();
          },
          error: (error) => {
            alert('Erro ao obter senha: ' + (error.error?.detail || error.message));
            this.carregandoSenha = false;
            this.senhaAdmin = '';
          }
        });
      } else {
        // Se não há pendente, desbloqueia todas (mas não busca senhas ainda)
        this.empresasFiltradas.forEach(empresa => {
          empresa.credenciais?.forEach(credencial => {
            this.senhasDesbloqueadas.add(credencial.id);
          });
        });
        this.fecharModalSenhaAdmin();
      }
    } else {
      alert('Senha de administrador incorreta.');
      this.senhaAdmin = '';
    }
  }

  toggleSenhaVisivel(credencialId: number): void {
    if (this.senhasDesbloqueadas.has(credencialId)) {
      // Se já está visível, oculta
      this.senhasDesbloqueadas.delete(credencialId);
      this.senhasObtidas.delete(credencialId);
    } else {
      // Se não está desbloqueado, pede senha admin
      this.credencialIdPendente = credencialId;
      this.abrirModalSenhaAdmin();
    }
  }

  isSenhaVisivel(credencialId: number): boolean {
    return this.senhasDesbloqueadas.has(credencialId);
  }

  obterSenhaExibicao(credencialId: number): string {
    if (this.isSenhaVisivel(credencialId) && this.senhasObtidas.has(credencialId)) {
      return this.senhasObtidas.get(credencialId) || '*****';
    }
    return '*****';
  }

  exportToPDF(): void {
    const data = this.getFilteredData();
    
    if (data.length === 0) {
      alert('Não há dados para exportar.');
      return;
    }

    const doc = new jsPDF();
    
    doc.setFontSize(18);
    doc.setTextColor(12, 13, 10);
    doc.text('Relatório de Empresas com Credenciais', 14, 20);
    
    doc.setFontSize(10);
    doc.setTextColor(30, 38, 21);
    const dataHora = new Date().toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    doc.text(`Exportado em: ${dataHora}`, 14, 28);
    
    const tableData = data.map(empresa => {
      const credencial = empresa.credenciais?.[0];
      return [
        this.formatarCPFouCNPJ(empresa.cnpj, credencial?.tipo_login),
        empresa.razao_social || '-',
        credencial?.usuario || '-',
        credencial?.tipo || '-',
        empresa.regime || '-'
      ];
    });

    // Determina o cabeçalho baseado no primeiro item (assumindo que todos têm o mesmo tipo)
    const primeiroItem = this.getFilteredData()[0];
    const tipoDocumento = primeiroItem?.credenciais?.[0]?.tipo_login === 'cpf' ? 'CPF' : 'CNPJ';
    
    autoTable(doc, {
      head: [[tipoDocumento, 'Razão Social', 'Usuário', 'Tipo', 'Regime']],
      body: tableData,
      startY: 35,
      styles: {
        fontSize: 8,
        textColor: [12, 13, 10],
        cellPadding: { top: 4, bottom: 4, left: 3, right: 3 },
        overflow: 'linebreak',
        cellWidth: 'wrap',
        lineWidth: 0.1,
      },
      headStyles: {
        fillColor: [139, 203, 112],
        textColor: [12, 13, 10],
        fontStyle: 'bold',
        halign: 'left',
        cellPadding: { top: 5, bottom: 5, left: 3, right: 3 },
      },
      bodyStyles: {
        halign: 'left',
        valign: 'middle',
      },
      alternateRowStyles: {
        fillColor: [240, 248, 247],
      },
      columnStyles: {
        0: { cellWidth: 38 },
        1: { cellWidth: 65 },
        2: { cellWidth: 32 },
        3: { cellWidth: 28 },
        4: { cellWidth: 32 },
      },
      margin: { top: 35, left: 14, right: 14, bottom: 25 },
      pageBreak: 'auto',
      rowPageBreak: 'avoid',
      tableWidth: 'wrap',
      showHead: 'everyPage',
      showFoot: 'never',
    });

    const dataFormatada = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const nomeArquivo = `credenciais_${dataFormatada}.pdf`;
    doc.save(nomeArquivo);
  }

  exportToExcel(): void {
    const data = this.getFilteredData();
    
    if (data.length === 0) {
      alert('Não há dados para exportar.');
      return;
    }

    const dadosPlanilha = data.map(empresa => {
      const credencial = empresa.credenciais?.[0];
      const tipoDocumento = credencial?.tipo_login === 'cpf' ? 'CPF' : 'CNPJ';
      return {
        [tipoDocumento]: this.formatarCPFouCNPJ(empresa.cnpj, credencial?.tipo_login),
        'Razão Social': empresa.razao_social || '-',
        'Usuário': credencial?.usuario || '-',
        'Tipo': credencial?.tipo || '-',
        'Regime': empresa.regime || '-',
        'Status': credencial?.status || '-'
      };
    });

    const ws = XLSX.utils.json_to_sheet(dadosPlanilha);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Credenciais');

    const colWidths = [
      { wch: 18 },
      { wch: 40 },
      { wch: 18 },
      { wch: 15 },
      { wch: 20 },
      { wch: 15 }
    ];
    ws['!cols'] = colWidths;

    const dataFormatada = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const nomeArquivo = `credenciais_${dataFormatada}.xlsx`;
    XLSX.writeFile(wb, nomeArquivo);
  }

  getFilteredData(): EmpresaComCredenciais[] {
    return [...this.empresasFiltradas];
  }

  getRegimes(): string[] {
    return ['Simples Nacional', 'Presumido', 'Real', 'MEI'];
  }

  getTipoLoginCardClasses(tipo: 'cpf' | 'cnpj'): string {
    return this.tipoLoginSelecionado === tipo ? 'card-selected' : 'card-unselected';
  }

  getTipoLoginCircleClasses(tipo: 'cpf' | 'cnpj'): string {
    return this.tipoLoginSelecionado === tipo ? 'circle-selected' : 'circle-unselected';
  }

  getRegimeCardClasses(regime: string): string {
    return this.regimeSelecionado === regime ? 'card-selected' : 'card-unselected';
  }

  getRegimeCircleClasses(regime: string): string {
    return this.regimeSelecionado === regime ? 'circle-selected' : 'circle-unselected';
  }

  getValidacaoClasses(): { [key: string]: boolean } {
    return {
      'validacao-sucesso': this.validacaoSucesso === true,
      'validacao-erro': this.validacaoSucesso === false
    };
  }

  formatarCNPJ(cnpj: string): string {
    const limpo = cnpj.replace(/[^\d]/g, '');
    if (limpo.length === 11) {
      // Formata como CPF: 000.000.000-00
      return limpo.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
    } else if (limpo.length === 14) {
      // Formata como CNPJ: 00.000.000/0000-00
      return limpo.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
    }
    return cnpj; // Retorna como está se não for nem CPF nem CNPJ
  }

  formatarCPFouCNPJ(valor: string, tipoLogin?: 'cpf' | 'cnpj'): string {
    const limpo = valor.replace(/[^\d]/g, '');
    
    // Se o tipo de login foi informado, usa ele
    if (tipoLogin === 'cpf' && limpo.length === 11) {
      return limpo.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
    } else if (tipoLogin === 'cnpj' && limpo.length === 14) {
      return limpo.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
    }
    
    // Caso contrário, detecta automaticamente pelo tamanho
    return this.formatarCNPJ(valor);
  }

  obterTipoLoginDeTipo(tipo: string): 'cpf' | 'cnpj' {
    // Converte "CPF_SENHA" ou "CNPJ_SENHA" para "cpf" ou "cnpj"
    if (tipo && tipo.toUpperCase().includes('CPF')) {
      return 'cpf';
    } else if (tipo && tipo.toUpperCase().includes('CNPJ')) {
      return 'cnpj';
    }
    // Fallback: detecta pelo tamanho do usuário (se disponível)
    return 'cnpj'; // Default
  }

  limparCNPJ(cnpj: string): string {
    return cnpj.replace(/[^\d]/g, '');
  }

  marcarCamposComErro(form: FormGroup): void {
    Object.keys(form.controls).forEach(key => {
      const control = form.get(key);
      if (control?.invalid) {
        control.markAsTouched();
      }
    });
  }
}
