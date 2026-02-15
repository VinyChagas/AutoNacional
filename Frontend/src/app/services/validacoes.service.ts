import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export interface StartValidacaoPayload {
  targets: ('CERTIFICADO' | 'CREDENCIAL')[];
  scope: {
    mode: 'SELECTED' | 'FILTERED' | 'ALL';
    empresa_ids?: number[];
  };
  filters?: Record<string, unknown>;
  options?: {
    concurrency?: number;
    timeoutSeconds?: number;
    stopOnConsecutiveErrors?: number;
  };
}

export interface JobStatus {
  job_id: string;
  status: 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELED';
  progress: number;
  total: number;
  ok: number;
  errors: number;
  processed: number;
}

interface ApiSuccess<T> {
  success: true;
  data?: T;
  message?: string;
}

@Injectable({
  providedIn: 'root',
})
export class ValidacoesService {
  private baseUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  start(payload: StartValidacaoPayload): Observable<{ job_id: string }> {
    return this.http
      .post<ApiSuccess<{ job_id: string }>>(`${this.baseUrl}/validacoes/start`, payload)
      .pipe(
        map((r) => {
          const d = r?.data;
          if (!d?.job_id) throw new Error('Resposta inválida');
          return d;
        }),
        catchError(this.handleError)
      );
  }

  getStatus(jobId: string): Observable<JobStatus> {
    return this.http
      .get<ApiSuccess<JobStatus>>(`${this.baseUrl}/validacoes/${jobId}`)
      .pipe(
        map((r) => {
          const d = r?.data;
          if (!d) throw new Error('Resposta inválida');
          return { ...d, job_id: d.job_id ?? jobId };
        }),
        catchError(this.handleError)
      );
  }

  cancel(jobId: string): Observable<unknown> {
    return this.http
      .post<ApiSuccess<unknown>>(`${this.baseUrl}/validacoes/${jobId}/cancel`, {})
      .pipe(catchError(this.handleError));
  }

  private handleError = (error: HttpErrorResponse): Observable<never> => {
    const msg =
      error.error?.detail ||
      error.error?.message ||
      error.message ||
      `Erro ${error.status}`;
    return throwError(() => Object.assign(new Error(msg), { data: error.error?.data }));
  };
}
