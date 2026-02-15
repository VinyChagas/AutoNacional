import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { Empresa, EmpresaCreate, EmpresaUpdate } from '../models/empresas.model';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class EmpresasService {
  private baseUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  listar(skip: number = 0, limit: number = 1000): Observable<Empresa[]> {
    const params = new HttpParams()
      .set('skip', skip.toString())
      .set('limit', limit.toString());
    return this.http.get<Empresa[]>(`${this.baseUrl}/empresas`, { params }).pipe(
      catchError(this.handleError)
    );
  }

  listarPorContabilidade(
    contabilidadeId: number,
    skip: number = 0,
    limit: number = 1000,
    hasCred?: boolean
  ): Observable<Empresa[]> {
    let params = new HttpParams()
      .set('page', '1')
      .set('limit', limit.toString());
    if (hasCred === true) {
      params = params.set('has_cred', 'true');
    }
    return this.http
      .get<{ success?: boolean; data?: { items?: Array<{ id: string; cnpj: string; razao_social: string; contabilidade_id?: number | null }> } }>(
        `${this.baseUrl}/empresas/contabilidade/${contabilidadeId}`,
        { params }
      )
      .pipe(
        map((res) => {
          const data = (res as { data?: { items?: unknown[] } })?.data;
          const items = Array.isArray(data?.items) ? data.items : Array.isArray(res) ? res : [];
          return (items as Array<{ id?: unknown; cnpj?: string; razao_social?: string }>).map((item) => ({
            id: String(item?.id ?? ''),
            cnpj: item?.cnpj ?? '',
            razao_social: item?.razao_social ?? item?.cnpj ?? '',
          }));
        }),
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

