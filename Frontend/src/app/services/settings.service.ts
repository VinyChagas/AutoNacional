import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { AutomationSettings } from '../models/automation-settings.model';

@Injectable({
  providedIn: 'root'
})
export class SettingsService {
  private baseUrl = 'http://localhost:8000/api';

  constructor(private http: HttpClient) {}

  getSettings(): Observable<AutomationSettings> {
    return this.http.get<AutomationSettings>(`${this.baseUrl}/settings`).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('❌ Erro ao buscar configurações:', error);
        return throwError(() => error);
      })
    );
  }

  updateSettings(settings: AutomationSettings): Observable<void> {
    return this.http.put<void>(`${this.baseUrl}/settings`, settings).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('❌ Erro ao atualizar configurações:', error);
        return throwError(() => error);
      })
    );
  }
}

