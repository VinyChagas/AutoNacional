import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { throwError } from 'rxjs';
import { environment } from '../../environments/environment';

/** Eventos SSE de execução em tempo real */
export interface ExecutionStreamEventStarted {
  type: 'execution:started';
  empresa_id: string;
  cnpj: string;
  razao_social?: string;
  metodo: 'CERTIFICADO' | 'CREDENCIAL';
}

export interface ExecutionStreamEventStage {
  type: 'execution:stage';
  empresa_id: string;
  stage: string;
  message: string;
}

export interface ExecutionStreamEventCounts {
  type: 'execution:counts';
  empresa_id: string;
  qtd_emitidas: number;
  qtd_recebidas: number;
  qtd_canceladas?: number;
}

export interface ExecutionStreamEventFinished {
  type: 'execution:finished';
  empresa_id: string;
  status: 'OK' | 'ERRO';
  message?: string;
  qtd_emitidas?: number;
  qtd_recebidas?: number;
  qtd_canceladas?: number;
}

export type ExecutionStreamEvent =
  | ExecutionStreamEventStarted
  | ExecutionStreamEventStage
  | ExecutionStreamEventCounts
  | ExecutionStreamEventFinished;

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
  qtdNotasCanceladas?: number;
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
  tipoAutenticacao?: 'certificado' | 'credenciais'; // Tipo de autenticação usado
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
  qtd_notas_canceladas?: number;
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
    tipo_autenticacao?: string; // "certificado" ou "credenciais"
  }>;
  dataInicio: string;
  dataFim: string;
  tipo: string;
  headless: boolean;
  contabilidade_id?: number | null;
}

export interface MultiplasExecucoesResponse {
  success?: boolean;
  batch_id?: string;
  started?: number;
  sucesso?: number; // legado
  erros: number;
  execucoes: ExecucaoStatusResponse[];
  detalhes_erros: Array<{
    empresa_id: string;
    cnpj: string;
    erro: string;
  }>;
}

/** Item de empresa para a tela de execução (summary e fila aptas). */
export interface EmpresaExecucaoItem {
  empresa_id: number;
  cnpj: string;
  razao_social: string;
  status_geral: 'OPERACIONAL' | 'ATENCAO' | 'PARCIAL' | 'INOPERANTE';
  login_metodo: 'CERTIFICADO' | 'CREDENCIAL' | null;
}

/** Resposta do endpoint GET /execucao/companies/summary */
export interface ExecutionSummaryResponse {
  total_empresas: number;
  total_aptas: number;
  total_operacional: number;
  total_atencao: number;
  total_inoperante: number;
  total_parcial: number;
  aptas: EmpresaExecucaoItem[];
  inoperantes: EmpresaExecucaoItem[];
  parciais: EmpresaExecucaoItem[];
}

@Injectable({
  providedIn: 'root'
})
export class ExecucaoService {
  private baseUrl = environment.apiUrl;

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

  obterSummaryExecucao(contabilidadeId: number): Observable<ExecutionSummaryResponse> {
    return this.http.get<ExecutionSummaryResponse>(
      `${this.baseUrl}/execucao/companies/summary`,
      { params: { contabilidade_id: contabilidadeId } }
    ).pipe(
      catchError((error) => {
        console.error('Erro ao obter summary de execução:', error);
        return throwError(() => error);
      })
    );
  }

  listarEmpresasAptas(contabilidadeId: number): Observable<EmpresaExecucaoItem[]> {
    return this.http
      .get<{ empresas: EmpresaExecucaoItem[] }>(
        `${this.baseUrl}/execucao/companies`,
        { params: { contabilidade_id: contabilidadeId } }
      )
      .pipe(
        map((res) => res.empresas ?? []),
        catchError((error) => {
          console.error('Erro ao listar empresas aptas:', error);
          return throwError(() => error);
        })
      );
  }

  /**
   * Abre stream SSE de execuções e retorna Observable que emite eventos em tempo real.
   */
  streamExecucoes(batchId: string): Observable<ExecutionStreamEvent> {
    const subject = new Subject<ExecutionStreamEvent>();
    const url = `${this.baseUrl}/execucao/stream/${batchId}`;

    const eventSource = new EventSource(url);

    const eventNames = ['started', 'stage', 'counts', 'finished'] as const;
    eventNames.forEach((name) => {
      eventSource.addEventListener(name, (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data || '{}') as ExecutionStreamEvent;
          subject.next(data);
        } catch {
          /* ignore parse error */
        }
      });
    });

    eventSource.onerror = () => {
      eventSource.close();
      subject.complete();
    };

    return subject.asObservable();
  }
}

