import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { Empresa, EmpresaCreate, EmpresaUpdate } from '../models/empresas.model';

@Injectable({
  providedIn: 'root'
})
export class EmpresasService {
  private baseUrl = 'http://localhost:8000/api';

  constructor(private http: HttpClient) {}

  listar(): Observable<Empresa[]> {
    return this.http.get<Empresa[]>(`${this.baseUrl}/empresas`).pipe(
      catchError(this.handleError)
    );
  }

  listarPorContabilidade(contabilidadeId: number): Observable<Empresa[]> {
    return this.http.get<Empresa[]>(`${this.baseUrl}/empresas/contabilidade/${contabilidadeId}`).pipe(
      catchError(this.handleError)
    );
  }

  obterPorId(id: string): Observable<Empresa> {
    return this.http.get<Empresa>(`${this.baseUrl}/empresas/${id}`).pipe(
      catchError(this.handleError)
    );
  }

  obterPorCNPJ(cnpj: string): Observable<Empresa> {
    const cnpjLimpo = cnpj.replace(/[^\d]/g, '');
    return this.http.get<Empresa>(`${this.baseUrl}/empresas/cnpj/${cnpjLimpo}`).pipe(
      catchError(this.handleError)
    );
  }

  criar(empresa: EmpresaCreate): Observable<Empresa> {
    const dados = {
      ...empresa,
      cnpj: empresa.cnpj.replace(/[^\d]/g, '')
    };
    return this.http.post<Empresa>(`${this.baseUrl}/empresas`, dados).pipe(
      catchError(this.handleError)
    );
  }

  atualizar(id: string, empresa: EmpresaUpdate): Observable<Empresa> {
    return this.http.put<Empresa>(`${this.baseUrl}/empresas/${id}`, empresa).pipe(
      catchError(this.handleError)
    );
  }

  excluir(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/empresas/${id}`).pipe(
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

