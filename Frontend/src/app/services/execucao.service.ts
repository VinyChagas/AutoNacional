import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { throwError } from 'rxjs';

export type StatusExecucao = 'fila' | 'executando' | 'finalizado' | 'falhou';
export type ResultadoFinal = 'SEM_MOVIMENTO' | 'NOTAS_EMITIDAS' | 'NOTAS_RECEBIDAS' | 'NFS_ENCONTRADAS';

export interface ExecucaoEmpresa {
  id: string;
  empresa_id?: string;
  cnpj: string;
  nomeEmpresa?: string;
  status: StatusExecucao;
  resultadoFinal?: ResultadoFinal; // preenchido quando status = 'finalizado'
  qtdNotasEmitidas?: number;
  qtdNotasRecebidas?: number;
  etapa_atual?: string;
  progresso: number; // 0-100
  logs: string[];
  mensagem: string;
  urlAtual?: string;
  titulo?: string;
  sucesso?: boolean;
  dataInicio?: Date;
  dataFim?: Date;
  erro?: string;
  mostrarLogs?: boolean; // Propriedade para controlar exibição de logs
}

// Mantém compatibilidade com código antigo
export interface ExecucaoStatus extends ExecucaoEmpresa {
  // Mapeia status antigo para novo
}

export interface NFSeResponse {
  sucesso: boolean;
  url_atual: string;
  titulo: string;
  mensagem: string;
  logs: string[];
}

export interface ExecucaoStatusResponse {
  empresa_id: string;
  cnpj: string;
  status: string;
  etapa_atual: string;
  progresso: number;
  logs: string[];
  mensagem: string;
  data_inicio?: string;
  data_fim?: string;
  erro?: string;
  url_atual?: string;
  titulo?: string;
  qtd_notas_emitidas?: number;
  qtd_notas_recebidas?: number;
  resultado_final?: string;
}

export interface ResumoExecucoesResponse {
  competencia?: string;
  total_empresas: number;
  com_movimento: number;
  sem_movimento: number;
  empresas_com_movimento: Array<{
    cnpj: string;
    nome?: string;
    qtd_notas_emitidas: number;
    qtd_notas_recebidas: number;
  }>;
  empresas_sem_movimento: Array<{
    cnpj: string;
    nome?: string;
  }>;
}

export interface MultiplasExecucoesRequest {
  empresas: Array<{
    empresa_id: string;
    cnpj: string;
  }>;
  dataInicio: string;
  dataFim: string;
  tipo: string;
  headless: boolean;
}

export interface MultiplasExecucoesResponse {
  sucesso: number;
  erros: number;
  execucoes: ExecucaoStatusResponse[];
  detalhes_erros: Array<{
    empresa_id: string;
    cnpj: string;
    erro: string;
  }>;
}

@Injectable({
  providedIn: 'root'
})
export class ExecucaoService {
  private baseUrl = 'http://localhost:8000/api';

  constructor(private http: HttpClient) {}

  executarNFSe(cnpj: string, headless: boolean = false): Observable<NFSeResponse> {
    return this.http.post<NFSeResponse>(
      `${this.baseUrl}/nfse/${cnpj}/abrir?headless=${headless}`,
      {}
    ).pipe(
      catchError((error) => {
        console.error('Erro ao executar NFSe:', error);
        return throwError(() => error);
      })
    );
  }

  executarEmpresa(
    empresaId: string,
    dataInicio: string,
    dataFim: string,
    tipo: string = 'ambas',
    headless: boolean = false
  ): Observable<ExecucaoStatusResponse> {
    return this.http.post<ExecucaoStatusResponse>(
      `${this.baseUrl}/execucao/${empresaId}?dataInicio=${encodeURIComponent(dataInicio)}&dataFim=${encodeURIComponent(dataFim)}&tipo=${tipo}&headless=${headless}`,
      {}
    ).pipe(
      catchError((error) => {
        console.error('Erro ao executar empresa:', error);
        return throwError(() => error);
      })
    );
  }

  obterStatusExecucao(empresaId: string): Observable<ExecucaoStatusResponse> {
    return this.http.get<ExecucaoStatusResponse>(
      `${this.baseUrl}/execucao/${empresaId}/status`
    ).pipe(
      catchError((error) => {
        console.error('Erro ao obter status da execução:', error);
        return throwError(() => error);
      })
    );
  }

  processarLogsEmTempoReal(
    logs: string[],
    callback: (log: string, progresso: number) => void
  ): void {
    let index = 0;
    const intervalo = setInterval(() => {
      if (index < logs.length) {
        const progresso = Math.round(((index + 1) / logs.length) * 100);
        callback(logs[index], progresso);
        index++;
      } else {
        clearInterval(intervalo);
      }
    }, 500); // Atualiza a cada 500ms para simular tempo real
  }

  obterResumoExecucoes(
    competencia?: string,
    statusFiltro: string = 'concluido'
  ): Observable<ResumoExecucoesResponse> {
    let url = `${this.baseUrl}/relatorios/execucoes/resumo?status_filtro=${statusFiltro}`;
    if (competencia) {
      url += `&competencia=${competencia}`;
    }
    return this.http.get<ResumoExecucoesResponse>(url).pipe(
      catchError((error) => {
        console.error('Erro ao obter resumo de execuções:', error);
        return throwError(() => error);
      })
    );
  }

  baixarResumoCSV(
    competencia?: string,
    statusFiltro: string = 'concluido'
  ): Observable<Blob> {
    let url = `${this.baseUrl}/relatorios/execucoes/resumo/csv?status_filtro=${statusFiltro}`;
    if (competencia) {
      url += `&competencia=${competencia}`;
    }
    return this.http.get(url, { responseType: 'blob' }).pipe(
      catchError((error) => {
        console.error('Erro ao baixar CSV de resumo:', error);
        return throwError(() => error);
      })
    );
  }

  adicionarMultiplasExecucoes(
    request: MultiplasExecucoesRequest
  ): Observable<MultiplasExecucoesResponse> {
    return this.http.post<MultiplasExecucoesResponse>(
      `${this.baseUrl}/execucao/multiplas`,
      request
    ).pipe(
      catchError((error) => {
        console.error('Erro ao adicionar múltiplas execuções:', error);
        return throwError(() => error);
      })
    );
  }
}

