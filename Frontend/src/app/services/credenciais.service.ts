import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { Credencial, CredencialCreate, CredencialUpdate, CredencialResponse, CredencialListResponse } from '../models/credenciais.model';

@Injectable({
  providedIn: 'root'
})
export class CredenciaisService {
  private baseUrl = 'http://localhost:8000/api';

  constructor(private http: HttpClient) {}

  obterPorEmpresa(empresaId: string): Observable<CredencialListResponse> {
    return this.http.get<CredencialListResponse>(`${this.baseUrl}/credenciais/empresa/${empresaId}`).pipe(
      catchError(this.handleError)
    );
  }

  criarOuAtualizar(credencial: CredencialCreate): Observable<CredencialResponse> {
    return this.http.post<CredencialResponse>(`${this.baseUrl}/credenciais`, credencial).pipe(
      catchError(this.handleError)
    );
  }

  atualizar(credencialId: number, credencial: CredencialUpdate): Observable<CredencialResponse> {
    return this.http.put<CredencialResponse>(`${this.baseUrl}/credenciais/${credencialId}`, credencial).pipe(
      catchError(this.handleError)
    );
  }

  excluir(credencialId: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/credenciais/${credencialId}`).pipe(
      catchError(this.handleError)
    );
  }

  validarCredenciais(empresaId: string, cnpj: string): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/credenciais/empresa/${empresaId}/validar`, { cnpj }).pipe(
      catchError(this.handleError)
    );
  }

  obterSenha(credencialId: number, senhaAdmin: string): Observable<{ senha: string }> {
    return this.http.post<{ senha: string }>(`${this.baseUrl}/credenciais/${credencialId}/obter-senha`, { 
      senha_admin: senhaAdmin 
    }).pipe(
      catchError(this.handleError)
    );
  }


  private handleError = (error: HttpErrorResponse): Observable<never> => {
    console.error('❌ Erro HTTP:', error);
    let errorMessage = 'Erro desconhecido';
    
    if (error.error instanceof ErrorEvent) {
      errorMessage = `Erro: ${error.error.message}`;
    } else {
      errorMessage = error.error?.message || error.message || `Erro ${error.status}: ${error.statusText}`;
    }
    
    return throwError(() => new Error(errorMessage));
  };
}

