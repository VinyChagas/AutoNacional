import {
  Component,
  OnInit,
  computed,
  signal,
  ChangeDetectorRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { RentabilidadeService } from '../../services/rentabilidade.service';
import { ContabilidadeService } from '../../services/contabilidade.service';
import { BillingSummary } from '../../models/billing-summary.model';
import { Contabilidade } from '../../models/contabilidade.model';
import type {
  CenarioRentabilidade,
  CustosFixos,
  CustosVariaveis,
  MetaPreco,
  ModeloCobrancaPorEmpresa,
  ModeloCobrancaPorNota,
  ModeloMensalidadeFixa,
  ModeloMinimoMensal,
  ModeloFranquiaExcedente,
} from '../../models/rentabilidade.model';

const CENARIOS_STORAGE_KEY = 'autonacional_cenarios_rentabilidade';

@Component({
  selector: 'app-rentabilidade',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './rentabilidade.component.html',
  styleUrls: ['./rentabilidade.component.scss'],
})
export class RentabilidadeComponent implements OnInit {
  competencia = signal<string>(this.obterCompetenciaAtual());
  contabilidadeId = signal<number | null>(null);
  summary = signal<BillingSummary | null>(null);
  carregando = signal(false);
  erro = signal<string | null>(null);

  contabilidades: Contabilidade[] = [];
  carregandoContabilidades = false;

  // Modelos de cobrança
  modeloPorEmpresa = signal<ModeloCobrancaPorEmpresa>({
    ativo: false,
    valorPorEmpresa: 0,
    considerarApenasOk: true,
  });
  modeloPorNota = signal<ModeloCobrancaPorNota>({
    ativo: false,
    valorPorNota: 0,
  });
  modeloMensalidade = signal<ModeloMensalidadeFixa>({
    ativo: false,
    valorMensal: 0,
  });
  modeloMinimo = signal<ModeloMinimoMensal>({
    ativo: false,
    valorMinimo: 0,
  });
  modeloFranquia = signal<ModeloFranquiaExcedente>({
    ativo: false,
    franquiaNotas: 0,
    valorPorNotaExcedente: 0,
  });

  // Custos
  custosFixos = signal<CustosFixos>({
    infraVps: 0,
    energiaInternet: 0,
    licencasServicos: 0,
    suporteHoras: 0,
    suporteValorHora: 0,
  });
  custosVariaveis = signal<CustosVariaveis>({
    custoPorExecucao: 0,
    custoPorNota: 0,
    outros: [],
  });

  // Meta
  metaPreco = signal<MetaPreco>({
    metaLucro: undefined,
    metaMargem: undefined,
  });

  // Cenários
  cenarios = signal<CenarioRentabilidade[]>([]);
  novoCenarioNome = '';

  constructor(
    private rentabilidadeService: RentabilidadeService,
    private contabilidadeService: ContabilidadeService,
    private cdr: ChangeDetectorRef
  ) {
    this.carregarCenarios();
  }

  private obterCompetenciaAtual(): string {
    const now = new Date();
    const mes = String(now.getMonth() + 1).padStart(2, '0');
    return `${now.getFullYear()}-${mes}`;
  }

  ngOnInit() {
    this.carregarContabilidades();
    this.carregarBillingSummary();
  }

  async carregarContabilidades() {
    this.carregandoContabilidades = true;
    try {
      const res = await firstValueFrom(this.contabilidadeService.listar());
      this.contabilidades = res.contabilidades || [];
    } catch (e) {
      console.error('Erro ao carregar contabilidades:', e);
    } finally {
      this.carregandoContabilidades = false;
      this.cdr.markForCheck();
    }
  }

  async carregarBillingSummary() {
    this.carregando.set(true);
    this.erro.set(null);
    try {
      const s = await firstValueFrom(
        this.rentabilidadeService.obterBillingSummary(
          this.competencia(),
          this.contabilidadeId()
        )
      );
      this.summary.set(s);
    } catch (e: any) {
      this.summary.set(null);
      this.erro.set(
        e?.error?.detail || e?.message || 'Erro ao carregar dados do mês'
      );
    } finally {
      this.carregando.set(false);
      this.cdr.markForCheck();
    }
  }

  onCompetenciaChange(val: string) {
    this.competencia.set(val);
    this.carregarBillingSummary();
  }

  onContabilidadeChange(val: number | null) {
    this.contabilidadeId.set(val);
    this.carregarBillingSummary();
  }

  // --- Cálculos reativos ---

  receitaCalculada = computed(() => {
    const s = this.summary();
    const porEmp = this.modeloPorEmpresa();
    const porNota = this.modeloPorNota();
    const mensal = this.modeloMensalidade();
    const minimo = this.modeloMinimo();
    const franq = this.modeloFranquia();

    let receita = 0;

    if (porEmp.ativo && s) {
      const empresas =
        porEmp.considerarApenasOk ? s.empresas_ok : s.empresas_processadas_total;
      receita += empresas * Math.max(0, porEmp.valorPorEmpresa);
    }
    if (porNota.ativo && s) {
      receita += s.total_notas * Math.max(0, porNota.valorPorNota);
    }
    if (mensal.ativo) {
      receita += Math.max(0, mensal.valorMensal);
    }
    if (franq.ativo && s) {
      const excedente = Math.max(0, s.total_notas - Math.max(0, franq.franquiaNotas));
      receita += excedente * Math.max(0, franq.valorPorNotaExcedente);
    }

    if (minimo.ativo && minimo.valorMinimo > 0) {
      receita = Math.max(receita, minimo.valorMinimo);
    }

    return receita;
  });

  custoTotal = computed(() => {
    const fixos = this.custosFixos();
    const vars = this.custosVariaveis();
    const s = this.summary();

    let total =
      Math.max(0, fixos.infraVps) +
      Math.max(0, fixos.energiaInternet) +
      Math.max(0, fixos.licencasServicos) +
      (Math.max(0, fixos.suporteHoras) * Math.max(0, fixos.suporteValorHora));

    total +=
      (s?.empresas_processadas_total ?? 0) * Math.max(0, vars.custoPorExecucao) +
      (s?.total_notas ?? 0) * Math.max(0, vars.custoPorNota);

    for (const o of vars.outros) {
      total += Math.max(0, o.valor);
    }

    return total;
  });

  lucro = computed(() => {
    return Math.max(0, this.receitaCalculada()) - this.custoTotal();
  });

  margem = computed(() => {
    const rec = this.receitaCalculada();
    if (rec <= 0) return 0;
    return (this.lucro() / rec) * 100;
  });

  ticketMedioEmpresa = computed(() => {
    const s = this.summary();
    const emp = s?.empresas_processadas_total ?? 0;
    if (emp <= 0) return 0;
    return this.receitaCalculada() / emp;
  });

  receitaPorNota = computed(() => {
    const s = this.summary();
    const notas = s?.total_notas ?? 0;
    if (notas <= 0) return 0;
    return this.receitaCalculada() / notas;
  });

  receitaPorHora = computed(() => {
    const s = this.summary();
    const seg = s?.tempo_total_segundos ?? 0;
    if (seg <= 0) return 0;
    return this.receitaCalculada() / (seg / 3600);
  });

  precoEmpresaRecomendado = computed(() => {
    const s = this.summary();
    const emp = s?.empresas_processadas_total ?? 0;
    if (emp <= 0) return 0;

    const meta = this.metaPreco();
    const custo = this.custoTotal();
    let receitaNecessaria = custo;

    if (meta.metaLucro != null && meta.metaLucro > 0) {
      receitaNecessaria = custo + meta.metaLucro;
    } else if (meta.metaMargem != null && meta.metaMargem > 0 && meta.metaMargem < 100) {
      receitaNecessaria = custo / (1 - meta.metaMargem / 100);
    }

    return receitaNecessaria / emp;
  });

  precoNotaRecomendado = computed(() => {
    const s = this.summary();
    const notas = s?.total_notas ?? 0;
    if (notas <= 0) return 0;

    const meta = this.metaPreco();
    const custo = this.custoTotal();
    let receitaNecessaria = custo;

    if (meta.metaLucro != null && meta.metaLucro > 0) {
      receitaNecessaria = custo + meta.metaLucro;
    } else if (meta.metaMargem != null && meta.metaMargem > 0 && meta.metaMargem < 100) {
      receitaNecessaria = custo / (1 - meta.metaMargem / 100);
    }

    return receitaNecessaria / notas;
  });

  // --- Helpers ---

  formatarBRL(val: number): string {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(val);
  }

  formatarTempo(segundos: number): string {
    if (segundos < 60) return `${Math.round(segundos)}s`;
    const min = Math.floor(segundos / 60);
    const seg = Math.round(segundos % 60);
    if (min < 60) return `${min}min ${seg}s`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${h}h ${m}min`;
  }

  parseBRLInput(val: string): number {
    const num = parseFloat(
      String(val || '0')
        .replace(/\./g, '')
        .replace(',', '.')
        .replace(/[^\d.-]/g, '')
    );
    return isNaN(num) ? 0 : num;
  }

  // --- Cenários ---

  carregarCenarios() {
    try {
      const raw = localStorage.getItem(CENARIOS_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      this.cenarios.set(Array.isArray(parsed) ? parsed : []);
    } catch {
      this.cenarios.set([]);
    }
  }

  salvarCenario() {
    const nome = (this.novoCenarioNome || 'Cenário').trim() || 'Cenário';
    const s = this.summary();
    const rec = this.receitaCalculada();
    const custo = this.custoTotal();
    const luc = this.lucro();
    const marg = this.margem();

    const cenario: CenarioRentabilidade = {
      id: `c-${Date.now()}`,
      nome,
      createdAt: new Date().toISOString(),
      competencia: this.competencia(),
      contabilidade_id: this.contabilidadeId(),
      receita: rec,
      custo,
      lucro: luc,
      margem: marg,
      empresas_processadas: s?.empresas_processadas_total ?? 0,
      total_notas: s?.total_notas ?? 0,
      tempo_total_segundos: s?.tempo_total_segundos,
    };

    const lista = [...this.cenarios(), cenario];
    this.cenarios.set(lista);
    localStorage.setItem(CENARIOS_STORAGE_KEY, JSON.stringify(lista));
    this.novoCenarioNome = '';
    this.cdr.markForCheck();
  }

  removerCenario(id: string) {
    const lista = this.cenarios().filter((c) => c.id !== id);
    this.cenarios.set(lista);
    localStorage.setItem(CENARIOS_STORAGE_KEY, JSON.stringify(lista));
    this.cdr.markForCheck();
  }

  adicionarOutroCusto() {
    const v = this.custosVariaveis();
    this.custosVariaveis.set({
      ...v,
      outros: [...v.outros, { label: 'Outro', valor: 0 }],
    });
    this.cdr.markForCheck();
  }

  removerOutroCusto(idx: number) {
    const v = this.custosVariaveis();
    const novos = [...v.outros];
    novos.splice(idx, 1);
    this.custosVariaveis.set({ ...v, outros: novos });
    this.cdr.markForCheck();
  }

  competenciasDisponiveis(): string[] {
    const out: string[] = [];
    const now = new Date();
    for (let i = 0; i < 24; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const mes = String(d.getMonth() + 1).padStart(2, '0');
      out.push(`${d.getFullYear()}-${mes}`);
    }
    return out;
  }

  // Handlers para evitar expressões complexas no template
  setModeloPorEmpresaAtivo(v: boolean) {
    this.modeloPorEmpresa.set({ ...this.modeloPorEmpresa(), ativo: v });
  }
  setModeloPorEmpresaValor(v: number) {
    this.modeloPorEmpresa.set({ ...this.modeloPorEmpresa(), valorPorEmpresa: v });
  }
  setModeloPorEmpresaConsiderarOk(v: boolean) {
    this.modeloPorEmpresa.set({ ...this.modeloPorEmpresa(), considerarApenasOk: v });
  }
  setModeloPorNotaAtivo(v: boolean) {
    this.modeloPorNota.set({ ...this.modeloPorNota(), ativo: v });
  }
  setModeloPorNotaValor(v: number) {
    this.modeloPorNota.set({ ...this.modeloPorNota(), valorPorNota: v });
  }
  setModeloMensalidadeAtivo(v: boolean) {
    this.modeloMensalidade.set({ ...this.modeloMensalidade(), ativo: v });
  }
  setModeloMensalidadeValor(v: number) {
    this.modeloMensalidade.set({ ...this.modeloMensalidade(), valorMensal: v });
  }
  setModeloMinimoAtivo(v: boolean) {
    this.modeloMinimo.set({ ...this.modeloMinimo(), ativo: v });
  }
  setModeloMinimoValor(v: number) {
    this.modeloMinimo.set({ ...this.modeloMinimo(), valorMinimo: v });
  }
  setModeloFranquiaAtivo(v: boolean) {
    this.modeloFranquia.set({ ...this.modeloFranquia(), ativo: v });
  }
  setModeloFranquiaNotas(v: number) {
    this.modeloFranquia.set({ ...this.modeloFranquia(), franquiaNotas: v });
  }
  setModeloFranquiaValorExcedente(v: number) {
    this.modeloFranquia.set({ ...this.modeloFranquia(), valorPorNotaExcedente: v });
  }
  setCustosFixosInfraVps(v: number) {
    this.custosFixos.set({ ...this.custosFixos(), infraVps: v });
  }
  setCustosFixosEnergia(v: number) {
    this.custosFixos.set({ ...this.custosFixos(), energiaInternet: v });
  }
  setCustosFixosLicencas(v: number) {
    this.custosFixos.set({ ...this.custosFixos(), licencasServicos: v });
  }
  setCustosFixosSuporteHoras(v: number) {
    this.custosFixos.set({ ...this.custosFixos(), suporteHoras: v });
  }
  setCustosFixosSuporteValorHora(v: number) {
    this.custosFixos.set({ ...this.custosFixos(), suporteValorHora: v });
  }
  setCustosVariaveisExecucao(v: number) {
    this.custosVariaveis.set({ ...this.custosVariaveis(), custoPorExecucao: v });
  }
  setCustosVariaveisNota(v: number) {
    this.custosVariaveis.set({ ...this.custosVariaveis(), custoPorNota: v });
  }
  setOutroCustoLabel(idx: number, label: string) {
    const v = this.custosVariaveis();
    const outros = v.outros.map((x, i) => (i === idx ? { ...x, label } : x));
    this.custosVariaveis.set({ ...v, outros });
  }
  setOutroCustoValor(idx: number, valor: number) {
    const v = this.custosVariaveis();
    const outros = v.outros.map((x, i) => (i === idx ? { ...x, valor } : x));
    this.custosVariaveis.set({ ...v, outros });
  }
  setMetaLucro(v: number | undefined) {
    this.metaPreco.set({ metaLucro: v, metaMargem: undefined });
  }
  setMetaMargem(v: number | undefined) {
    this.metaPreco.set({ metaMargem: v, metaLucro: undefined });
  }
}
