import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { Contabilidade, ContabilidadeCreate, ContabilidadeUpdate, ContabilidadeListResponse } from '../models/contabilidade.model';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class ContabilidadeService {
  private baseUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  listar(): Observable<ContabilidadeListResponse> {
    return this.http.get<ContabilidadeListResponse>(`${this.baseUrl}/contabilidades`).pipe(
      catchError(this.handleError)
    );
  }

  obterPorId(id: number): Observable<Contabilidade> {
    return this.http.get<Contabilidade>(`${this.baseUrl}/contabilidades/${id}`).pipe(
      catchError(this.handleError)
    );
  }

  criar(contabilidade: ContabilidadeCreate): Observable<Contabilidade> {
    return this.http.post<Contabilidade>(`${this.baseUrl}/contabilidades`, contabilidade).pipe(
      catchError(this.handleError)
    );
  }

  atualizar(id: number, contabilidade: ContabilidadeUpdate): Observable<Contabilidade> {
    return this.http.put<Contabilidade>(`${this.baseUrl}/contabilidades/${id}`, contabilidade).pipe(
      catchError(this.handleError)
    );
  }

  excluir(id: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/contabilidades/${id}`).pipe(
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






