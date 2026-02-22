import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { ContabilidadeService } from '../../services/contabilidade.service';
import { SidebarService } from '../../services/sidebar.service';
import { ToastService } from '../../services/toast.service';
import { Contabilidade, ContabilidadeCreate, ContabilidadeUpdate } from '../../models/contabilidade.model';
import { ContabilidadeDrawerComponent } from './contabilidade-drawer/contabilidade-drawer.component';

export type DrawerMode = 'create' | 'edit';

@Component({
  selector: 'app-contabilidades',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ContabilidadeDrawerComponent],
  templateUrl: './contabilidades.component.html',
  styleUrls: ['./contabilidades.component.scss'],
})
export class ContabilidadesComponent implements OnInit {
  contabilidades: Contabilidade[] = [];
  isDrawerOpen = false;
  drawerMode: DrawerMode = 'create';
  selectedContabilidade: Contabilidade | null = null;
  carregando = false;
  salvando = false;
  erro: string | null = null;

  // Confirmar exclusão (modal simples)
  excluirConfirmando: Contabilidade | null = null;
  excluindo = false;

  constructor(
    private contabilidadeService: ContabilidadeService,
    private sidebarService: SidebarService,
    private toast: ToastService
  ) {}

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
      },
    });
  }

  abrirDrawerCriar(): void {
    this.drawerMode = 'create';
    this.selectedContabilidade = null;
    this.sidebarService.collapseIfExpanded();
    this.isDrawerOpen = true;
    this.erro = null;
  }

  abrirDrawerEditar(contabilidade: Contabilidade): void {
    this.drawerMode = 'edit';
    this.selectedContabilidade = contabilidade;
    this.sidebarService.collapseIfExpanded();
    this.isDrawerOpen = true;
    this.erro = null;
  }

  fecharDrawer(): void {
    this.isDrawerOpen = false;
    this.selectedContabilidade = null;
    this.erro = null;
  }

  onDrawerSaved(dados: Record<string, unknown>): void {
    this.salvando = true;
    this.erro = null;

    if (this.drawerMode === 'edit' && this.selectedContabilidade) {
      const updateData: ContabilidadeUpdate = {
        nome_contabilidade: dados['nome_contabilidade'] as string,
        email: (dados['email'] as string) || undefined,
        telefone: (dados['telefone'] as string) || undefined,
        responsavel: (dados['responsavel'] as string) || undefined,
      };

      this.contabilidadeService.atualizar(this.selectedContabilidade.id, updateData).subscribe({
        next: () => {
          this.toast.success('Contabilidade atualizada com sucesso!');
          this.carregarContabilidades();
          setTimeout(() => this.fecharDrawer(), 700);
          this.salvando = false;
        },
        error: (error) => {
          this.erro = error.message || 'Erro ao atualizar contabilidade';
          this.salvando = false;
        },
      });
    } else {
      const createData: ContabilidadeCreate = {
        nome_contabilidade: dados['nome_contabilidade'] as string,
        cnpj: this.limparCNPJ((dados['cnpj'] as string) || ''),
        email: (dados['email'] as string) || undefined,
        telefone: (dados['telefone'] as string) || undefined,
        responsavel: (dados['responsavel'] as string) || undefined,
      };

      this.contabilidadeService.criar(createData).subscribe({
        next: () => {
          this.toast.success('Contabilidade cadastrada com sucesso!');
          this.carregarContabilidades();
          setTimeout(() => this.fecharDrawer(), 700);
          this.salvando = false;
        },
        error: (error) => {
          this.erro = error.message || 'Erro ao cadastrar contabilidade';
          this.salvando = false;
        },
      });
    }
  }

  abrirConfirmExcluir(contabilidade: Contabilidade): void {
    this.excluirConfirmando = contabilidade;
  }

  fecharConfirmExcluir(): void {
    if (!this.excluindo) {
      this.excluirConfirmando = null;
    }
  }

  confirmarExcluir(): void {
    if (!this.excluirConfirmando) return;

    this.excluindo = true;
    this.contabilidadeService.excluir(this.excluirConfirmando.id).subscribe({
      next: () => {
        this.toast.success('Contabilidade excluída com sucesso!');
        this.carregarContabilidades();
        this.excluirConfirmando = null;
        this.excluindo = false;
      },
      error: (error) => {
        this.erro = error.message || 'Erro ao excluir contabilidade';
        this.excluindo = false;
      },
    });
  }

  limparCNPJ(cnpj: string): string {
    return cnpj.replace(/[^\d]/g, '');
  }

  formatarCNPJ(cnpj: string): string {
    const limpo = this.limparCNPJ(cnpj);
    if (limpo.length !== 14) return cnpj;
    return limpo.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  }

  getEmpresasVinculadasCount(c: Contabilidade): number {
    return c.empresas_vinculadas_count ?? c.certificados_vinculados ?? 0;
  }
}
