import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { throwError } from 'rxjs';

export interface ExecucaoStatus {
  id: string;
  cnpj: string;
  status: 'pendente' | 'em_execucao' | 'concluido' | 'falhou';
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

export interface NFSeResponse {
  sucesso: boolean;
  url_atual: string;
  titulo: string;
  mensagem: string;
  logs: string[];
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
}

