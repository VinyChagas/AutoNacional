import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '../../environments/environment';

// ============================================================================
// Interfaces
// ============================================================================

export interface DashboardResumo {
  empresas_total: number;
  empresas_operacionais: number;
  empresas_operacionais_variacao?: number; // % vs período anterior
  certificados_vencendo: number;
  credenciais_invalidas: number;
  execucoes_mes: number;
  taxa_sucesso: number;
  notas_encontradas: number;
  erros_mes: number;
  empresas_sem_metodo?: number;
  certificados_vencidos?: number;
  empresas_nao_validadas?: number;
}

export interface ExecucaoPorDia {
  data: string;
  total: number;
  sucesso: number;
  erro: number;
}

export interface DistribuicaoRegime {
  regime: string;
  quantidade: number;
}

// ============================================================================
// Mock Data (fallback quando API não disponível)
// ============================================================================

const MOCK_RESUMO: DashboardResumo = {
  empresas_total: 24,
  empresas_operacionais: 18,
  empresas_operacionais_variacao: 12.5,
  certificados_vencendo: 2,
  credenciais_invalidas: 1,
  execucoes_mes: 156,
  taxa_sucesso: 94.2,
  notas_encontradas: 1247,
  erros_mes: 9,
  empresas_sem_metodo: 3,
  certificados_vencidos: 1,
  empresas_nao_validadas: 2,
};

function gerarMockExecucoes(): ExecucaoPorDia[] {
  const list: ExecucaoPorDia[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const total = 8 + Math.floor(Math.random() * 18);
    const erro = Math.floor(Math.random() * 2);
    list.push({
      data: d.toISOString().slice(0, 10),
      total,
      sucesso: total - erro,
      erro,
    });
  }
  return list;
}

const MOCK_DISTRIBUICAO: DistribuicaoRegime[] = [
  { regime: 'Simples Nacional', quantidade: 14 },
  { regime: 'Lucro Presumido', quantidade: 6 },
  { regime: 'Lucro Real', quantidade: 3 },
  { regime: 'Outros', quantidade: 1 },
];

// ============================================================================
// Service
// ============================================================================

@Injectable({
  providedIn: 'root',
})
export class DashboardService {
  private baseUrl = `${environment.apiUrl}/dashboard`;
  private useMock = false;

  constructor(private http: HttpClient) {}

  /**
   * Resumo geral do dashboard
   */
  getResumo(period: string = '30d'): Observable<DashboardResumo> {
    if (this.useMock) {
      return of({ ...MOCK_RESUMO });
    }
    return this.http
      .get<DashboardResumo>(`${this.baseUrl}/resumo?period=${period}`)
      .pipe(
        catchError(() => of({ ...MOCK_RESUMO }))
      );
  }

  /**
   * Execuções por dia (gráfico de barras)
   */
  getExecucoes(period: string = '7d'): Observable<ExecucaoPorDia[]> {
    if (this.useMock) {
      return of(gerarMockExecucoes());
    }
    return this.http
      .get<ExecucaoPorDia[]>(`${this.baseUrl}/execucoes?period=${period}`)
      .pipe(
        catchError(() => of(gerarMockExecucoes()))
      );
  }

  /**
   * Distribuição por regime tributário (gráfico pizza)
   */
  getDistribuicaoRegime(): Observable<DistribuicaoRegime[]> {
    if (this.useMock) {
      return of([...MOCK_DISTRIBUICAO]);
    }
    return this.http
      .get<DistribuicaoRegime[]>(`${this.baseUrl}/distribuicao-regime`)
      .pipe(
        catchError(() => of([...MOCK_DISTRIBUICAO]))
      );
  }

  /**
   * Força uso de dados mock (para desenvolvimento sem backend)
   */
  setUseMock(value: boolean): void {
    this.useMock = value;
  }
}
