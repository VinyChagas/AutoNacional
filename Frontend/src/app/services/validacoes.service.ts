/**
 * Serviço de validação de empresas (certificados e credenciais).
 * Suporta SSE para progresso em tempo real.
 */
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject, catchError, map, throwError } from 'rxjs';
import { environment } from '../../environments/environment';

export interface IniciarPayload {
  empresa_ids: number[];
  validar_certificados: boolean;
  validar_credenciais: boolean;
  headless?: boolean;
}

export interface ProgressEvent {
  empresa_id: number;
  cnpj?: string;
  razao_social?: string;
  step: 'cert' | 'cred';
  status: string;
  message?: string;
  updated_at?: string;
  cred_status?: string;
  cert_status?: string;
  status_geral?: string;
}

export interface DoneEvent {
  job_id: string;
  totals: { ok: number; invalidas: number; erros: number };
}

@Injectable({
  providedIn: 'root',
})
export class ValidacoesService {
  private baseUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  iniciar(payload: IniciarPayload): Observable<{ job_id: string }> {
    return this.http
      .post<{ success?: boolean; data?: { job_id: string } }>(
        `${this.baseUrl}/validacoes/iniciar`,
        {
          empresa_ids: payload.empresa_ids,
          validar_certificados: payload.validar_certificados,
          validar_credenciais: payload.validar_credenciais,
          headless: payload.headless ?? true,
        }
      )
      .pipe(
        map((r: { data?: { job_id: string }; job_id?: string }) => {
          const id = r?.data?.job_id ?? r?.job_id;
          if (!id) throw new Error('Resposta inválida: job_id não retornado');
          return { job_id: id };
        }),
        catchError((err) => throwError(() => err))
      );
  }

  /**
   * Abre stream SSE e retorna Observable que emite eventos de progresso e done.
   */
  stream(jobId: string): Observable<ProgressEvent | DoneEvent> {
    const subject = new Subject<ProgressEvent | DoneEvent>();
    const url = `${this.baseUrl}/validacoes/stream/${jobId}`;

    const eventSource = new EventSource(url);

    eventSource.addEventListener('progress', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data || '{}') as ProgressEvent;
        subject.next(data);
      } catch {
        /* ignore parse error */
      }
    });

    eventSource.addEventListener('done', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data || '{}') as DoneEvent;
        subject.next(data);
      } catch {
        /* ignore */
      }
      eventSource.close();
      subject.complete();
    });

    eventSource.onerror = () => {
      eventSource.close();
      subject.complete();
    };

    return subject.asObservable();
  }
}
