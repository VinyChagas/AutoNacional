import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import {
  AutomationSettings,
  ConfigStatus,
  TestPathsResponse,
} from '../models/automation-settings.model';
import { environment } from '../../environments/environment';

export interface TestPathsRequest {
  downloadsBasePath?: string;
  downloadsPattern?: string;
  logsPath?: string;
  tempPath?: string;
  sample?: { cnpj?: string; competencia?: string };
}

@Injectable({
  providedIn: 'root',
})
export class SettingsService {
  private baseUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  getSettings(): Observable<AutomationSettings> {
    return this.http.get<AutomationSettings>(`${this.baseUrl}/settings`).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Erro ao buscar configurações:', error);
        return throwError(() => error);
      })
    );
  }

  updateSettings(settings: Partial<AutomationSettings>): Observable<AutomationSettings> {
    return this.http.put<AutomationSettings>(`${this.baseUrl}/settings`, settings).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Erro ao atualizar configurações:', error);
        return throwError(() => error);
      })
    );
  }

  getDefaults(): Observable<AutomationSettings> {
    return this.http.get<AutomationSettings>(`${this.baseUrl}/settings/defaults`).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Erro ao buscar padrões:', error);
        return throwError(() => error);
      })
    );
  }

  resetSettings(): Observable<AutomationSettings> {
    return this.http.post<AutomationSettings>(`${this.baseUrl}/settings/reset`, {}).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Erro ao resetar configurações:', error);
        return throwError(() => error);
      })
    );
  }

  testPaths(request: TestPathsRequest): Observable<TestPathsResponse> {
    return this.http.post<TestPathsResponse>(`${this.baseUrl}/settings/test-paths`, request).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Erro ao testar diretórios:', error);
        return throwError(() => error);
      })
    );
  }

  selectFolder(): Observable<{ path: string } | { path: null }> {
    return this.http.post<{ path: string | null }>(`${this.baseUrl}/settings/select-folder`, {}).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Erro ao selecionar pasta:', error);
        return throwError(() => error);
      })
    );
  }

  getConfigStatus(): Observable<ConfigStatus> {
    return this.http.get<ConfigStatus>(`${this.baseUrl}/config/status`).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('Erro ao obter status:', error);
        return throwError(() => error);
      })
    );
  }
}
