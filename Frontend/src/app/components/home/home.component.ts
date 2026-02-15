import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { NgChartsModule } from 'ng2-charts';
import type { ChartConfiguration, ChartData } from 'chart.js';
import { DashboardService, DashboardResumo, ExecucaoPorDia, DistribuicaoRegime } from '../../services/dashboard.service';
import { ThemeService } from '../../services/theme.service';
import { trigger, transition, style, animate } from '@angular/animations';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, NgChartsModule],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss'],
  animations: [
    trigger('fadeIn', [
      transition(':enter', [
        style({
          opacity: 0,
          transform: 'translateY(12px) scale(0.99)',
        }),
        animate(
          '450ms cubic-bezier(0.16, 1, 0.3, 1)',
          style({
            opacity: 1,
            transform: 'translateY(0) scale(1)',
          })
        ),
      ]),
    ]),
    trigger('fadeInSlow', [
      transition(':enter', [
        style({ opacity: 0 }),
        animate('600ms 150ms cubic-bezier(0.16, 1, 0.3, 1)', style({ opacity: 1 })),
      ]),
    ]),
  ],
})
export class HomeComponent implements OnInit {
  private dashboard = inject(DashboardService);
  protected theme = inject(ThemeService);

  // Período selecionado
  periodo = '30d';
  periodos = [
    { value: '1d', label: 'Hoje' },
    { value: '7d', label: '7 dias' },
    { value: '30d', label: '30 dias' },
    { value: '1m', label: 'Mês' },
  ];

  // Estado
  loading = true;
  resumo: DashboardResumo | null = null;
  execucoes: ExecucaoPorDia[] = [];
  distribuicao: DistribuicaoRegime[] = [];
  busca = '';
  nomeUsuario = 'Usuário';

  // Gráfico de barras - Execuções
  barChartData: ChartData<'bar'> = {
    labels: [],
    datasets: [
      { label: 'Sucesso', data: [], backgroundColor: '#3B82F6', stack: 'stack' },
      { label: 'Erro', data: [], backgroundColor: '#EF4444', stack: 'stack' },
    ],
  };
  get barChartOptions(): ChartConfiguration<'bar'>['options'] {
    const dark = this.theme.isDark();
    const ticksColor = dark ? 'rgba(234, 240, 255, 0.75)' : 'rgba(15, 23, 42, 0.7)';
    const gridColor = dark ? 'rgba(234, 240, 255, 0.10)' : 'rgba(15, 23, 42, 0.08)';
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top',
          labels: {
            color: dark ? 'rgba(234, 240, 255, 0.75)' : undefined,
          },
        },
        tooltip: {
          mode: 'index',
          intersect: false,
          backgroundColor: dark ? '#182743' : '#ffffff',
          titleColor: dark ? '#EAF0FF' : '#0F172A',
          bodyColor: dark ? '#EAF0FF' : '#0F172A',
          borderColor: dark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(15, 23, 42, 0.1)',
          borderWidth: 1,
        },
      },
      scales: {
        x: {
          stacked: true,
          ticks: { color: ticksColor },
          grid: { color: gridColor },
        },
        y: {
          stacked: true,
          beginAtZero: true,
          ticks: { color: ticksColor },
          grid: { color: gridColor },
        },
      },
    };
  }

  // Gráfico de pizza - Regime tributário
  pieChartData: ChartData<'pie'> = {
    labels: [],
    datasets: [{ data: [], backgroundColor: ['#3B82F6', '#F97316', '#EAB308', '#94A3B8', '#22C55E'] }],
  };
  get pieChartOptions(): ChartConfiguration<'pie'>['options'] {
    const dark = this.theme.isDark();
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: {
            color: dark ? 'rgba(234, 240, 255, 0.75)' : undefined,
          },
        },
        tooltip: {
          backgroundColor: dark ? '#182743' : '#ffffff',
          titleColor: dark ? '#EAF0FF' : '#0F172A',
          bodyColor: dark ? '#EAF0FF' : '#0F172A',
          borderColor: dark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(15, 23, 42, 0.1)',
          borderWidth: 1,
          callbacks: {
            label: (ctx) => {
              const total = (ctx.dataset.data as number[]).reduce((a, b) => a + b, 0);
              const pct = total > 0 ? Math.round(((ctx.raw as number) / total) * 100) : 0;
              return `${ctx.label}: ${ctx.raw} (${pct}%)`;
            },
          },
        },
      },
    };
  }

  ngOnInit(): void {
    this.carregarDados();
  }

  carregarDados(): void {
    this.loading = true;
    this.dashboard.getResumo(this.periodo).subscribe({
      next: (r) => {
        this.resumo = r;
        this.loading = false;
      },
      error: () => (this.loading = false),
    });

    this.dashboard.getExecucoes('7d').subscribe((execs) => {
      this.execucoes = execs;
      this.atualizarGraficoBarras();
    });

    this.dashboard.getDistribuicaoRegime().subscribe((dist) => {
      this.distribuicao = dist;
      this.atualizarGraficoPizza();
    });
  }

  private atualizarGraficoBarras(): void {
    const labels = this.execucoes.map((e) => this.formatarData(e.data));
    this.barChartData = {
      labels,
      datasets: [
        { label: 'Sucesso', data: this.execucoes.map((e) => e.sucesso), backgroundColor: '#3b82f6', stack: 'stack' },
        { label: 'Erro', data: this.execucoes.map((e) => e.erro), backgroundColor: '#ef4444', stack: 'stack' },
      ],
    };
  }

  private atualizarGraficoPizza(): void {
    this.pieChartData = {
      labels: this.distribuicao.map((d) => d.regime),
      datasets: [{
        data: this.distribuicao.map((d) => d.quantidade),
        backgroundColor: ['#3B82F6', '#F97316', '#EAB308', '#94A3B8', '#22C55E'],
      }],
    };
  }

  formatarData(s: string): string {
    const d = new Date(s);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  }

  getDataAtual(): string {
    return new Date().toLocaleDateString('pt-BR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }

  onChangePeriodo(): void {
    this.carregarDados();
  }
}
