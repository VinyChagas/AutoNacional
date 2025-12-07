import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ContabilidadeService } from '../../services/contabilidade.service';
import { Contabilidade, ContabilidadeCreate, ContabilidadeUpdate } from '../../models/contabilidade.model';

@Component({
  selector: 'app-contabilidades',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  templateUrl: './contabilidades.component.html',
  styleUrls: ['./contabilidades.component.scss']
})
export class ContabilidadesComponent implements OnInit {
  contabilidades: Contabilidade[] = [];
  formulario: FormGroup;
  editandoId: number | null = null;
  exibindoFormulario = false;
  carregando = false;
  erro: string | null = null;
  sucesso: string | null = null;

  constructor(
    private contabilidadeService: ContabilidadeService,
    private fb: FormBuilder
  ) {
    this.formulario = this.fb.group({
      nome_contabilidade: ['', [Validators.required, Validators.minLength(3)]],
      cnpj: ['', [Validators.required, this.validarCNPJ]],
      email: ['', [Validators.email]],
      telefone: [''],
      responsavel: ['']
    });
  }

  ngOnInit(): void {
    this.carregarContabilidades();
  }

  carregarContabilidades(): void {
    this.carregando = true;
    this.erro = null;
    
    this.contabilidadeService.listar().subscribe({
      next: (response) => {
        this.contabilidades = response.contabilidades || [];
        this.carregando = false;
      },
      error: (error) => {
        this.erro = error.message || 'Erro ao carregar contabilidades';
        this.carregando = false;
        console.error('Erro ao carregar contabilidades:', error);
      }
    });
  }

  abrirFormulario(contabilidade?: Contabilidade): void {
    this.exibindoFormulario = true;
    this.erro = null;
    this.sucesso = null;
    
    if (contabilidade) {
      this.editandoId = contabilidade.id;
      this.formulario.patchValue({
        nome_contabilidade: contabilidade.nome_contabilidade,
        cnpj: contabilidade.cnpj,
        email: contabilidade.email || '',
        telefone: contabilidade.telefone || '',
        responsavel: contabilidade.responsavel || ''
      });
      // Desabilita CNPJ na edição
      this.formulario.get('cnpj')?.disable();
    } else {
      this.editandoId = null;
      this.formulario.reset();
      this.formulario.get('cnpj')?.enable();
    }
  }

  fecharFormulario(): void {
    this.exibindoFormulario = false;
    this.editandoId = null;
    this.formulario.reset();
    this.erro = null;
    this.sucesso = null;
  }

  salvar(): void {
    if (this.formulario.invalid) {
      this.marcarCamposComErro();
      return;
    }

    this.carregando = true;
    this.erro = null;
    this.sucesso = null;

    const dados = this.formulario.getRawValue();

    if (this.editandoId) {
      // Atualizar
      const updateData: ContabilidadeUpdate = {
        nome_contabilidade: dados.nome_contabilidade,
        email: dados.email || undefined,
        telefone: dados.telefone || undefined,
        responsavel: dados.responsavel || undefined
      };

      this.contabilidadeService.atualizar(this.editandoId, updateData).subscribe({
        next: () => {
          this.sucesso = 'Contabilidade atualizada com sucesso!';
          this.carregarContabilidades();
          setTimeout(() => this.fecharFormulario(), 1500);
        },
        error: (error) => {
          this.erro = error.message || 'Erro ao atualizar contabilidade';
          this.carregando = false;
        }
      });
    } else {
      // Criar
      const createData: ContabilidadeCreate = {
        nome_contabilidade: dados.nome_contabilidade,
        cnpj: this.limparCNPJ(dados.cnpj),
        email: dados.email || undefined,
        telefone: dados.telefone || undefined,
        responsavel: dados.responsavel || undefined
      };

      this.contabilidadeService.criar(createData).subscribe({
        next: () => {
          this.sucesso = 'Contabilidade cadastrada com sucesso!';
          this.carregarContabilidades();
          setTimeout(() => this.fecharFormulario(), 1500);
        },
        error: (error) => {
          this.erro = error.message || 'Erro ao cadastrar contabilidade';
          this.carregando = false;
        }
      });
    }
  }

  excluir(contabilidade: Contabilidade): void {
    if (!confirm(`Deseja realmente excluir a contabilidade "${contabilidade.nome_contabilidade}"?`)) {
      return;
    }

    this.carregando = true;
    this.erro = null;

    this.contabilidadeService.excluir(contabilidade.id).subscribe({
      next: () => {
        this.sucesso = 'Contabilidade excluída com sucesso!';
        this.carregarContabilidades();
        setTimeout(() => this.sucesso = null, 3000);
      },
      error: (error) => {
        this.erro = error.message || 'Erro ao excluir contabilidade';
        this.carregando = false;
      }
    });
  }

  validarCNPJ(control: any): { [key: string]: any } | null {
    if (!control.value) return null;
    
    const cnpjLimpo = control.value.replace(/[^\d]/g, '');
    
    if (cnpjLimpo.length !== 14) {
      return { cnpjInvalido: true };
    }
    
    return null;
  }

  limparCNPJ(cnpj: string): string {
    return cnpj.replace(/[^\d]/g, '');
  }

  formatarCNPJ(cnpj: string): string {
    const limpo = this.limparCNPJ(cnpj);
    if (limpo.length !== 14) return cnpj;
    return limpo.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  }

  marcarCamposComErro(): void {
    Object.keys(this.formulario.controls).forEach(key => {
      const control = this.formulario.get(key);
      if (control?.invalid) {
        control.markAsTouched();
      }
    });
  }

  get campoInvalido(): { [key: string]: boolean } {
    return {
      'campo-invalido': true
    };
  }
}






