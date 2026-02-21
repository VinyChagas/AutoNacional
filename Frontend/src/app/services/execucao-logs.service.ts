import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import type { ExecutionBatchLogPayload } from '../models/execucao-batch-log.model';

@Injectable({ providedIn: 'root' })
export class ExecucaoLogsService {
  private baseUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  saveExecutionLog(payload: ExecutionBatchLogPayload): Observable<{ success: boolean; batch_log_id: number; saved: boolean }> {
    return this.http
      .post<{ success: boolean; batch_log_id: number; saved: boolean }>(
        `${this.baseUrl}/logs/execucoes/salvar`,
        payload
      )
      .pipe(
        catchError((error) => {
          console.error('Erro ao salvar log de execução:', error);
          return throwError(() => error);
        })
      );
  }
}
