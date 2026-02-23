import { Injectable } from '@angular/core';
import {
  HttpClient,
  HttpErrorResponse,
  HttpParams,
} from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import type {
  EmpresaListagemResponse,
  EmpresaDetalhes,
  EmpresasSummaryResponse,
  CadastroCredencialPayload,
  CadastroResult,
  PreviewCertificadosResponse,
  ConfirmarCertificadosPayload,
  ConfirmarCertificadosResponse,
  PreviewCredenciaisResponse,
  ConfirmarCredenciaisPayload,
  ConfirmarCredenciaisResponse,
} from '../models/empresas-unificado.model';

interface ApiSuccess<T> {
  success: true;
  data?: T;
  message?: string;
}

function unwrap<T>(resp: ApiSuccess<T>): T | undefined {
  return resp?.data;
}

@Injectable({
  providedIn: 'root',
})
export class EmpresasUnificadoService {
  private baseUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  listar(params: {
    search?: string;
    contabilidade_id?: number | null;
    has_cert?: boolean | null;
    has_cred?: boolean | null;
    sem_cert?: boolean;
    sem_cred?: boolean;
    sem_metodo?: boolean;
    page?: number;
    limit?: number;
    sort?: string;
    order?: 'asc' | 'desc';
  }): Observable<EmpresaListagemResponse> {
    let httpParams = new HttpParams();
    if (params.search?.trim()) {
      httpParams = httpParams.set('search', params.search.trim());
    }
    if (params.contabilidade_id != null && params.contabilidade_id > 0) {
      httpParams = httpParams.set(
        'contabilidade_id',
        String(params.contabilidade_id)
      );
    }
    if (params.has_cert != null) {
      httpParams = httpParams.set('has_cert', String(params.has_cert));
    }
    if (params.has_cred != null) {
      httpParams = httpParams.set('has_cred', String(params.has_cred));
    }
    if (params.sem_cert) {
      httpParams = httpParams.set('sem_cert', 'true');
    }
    if (params.sem_cred) {
      httpParams = httpParams.set('sem_cred', 'true');
    }
    if (params.sem_metodo) {
      httpParams = httpParams.set('sem_metodo', 'true');
    }
    if (params.sort) {
      httpParams = httpParams.set('sort', params.sort);
    }
    if (params.order) {
      httpParams = httpParams.set('order', params.order);
    }
    if (params.page != null) {
      httpParams = httpParams.set('page', String(params.page));
    }
    if (params.limit != null) {
      httpParams = httpParams.set('limit', String(params.limit));
    }

    return this.http
      .get<ApiSuccess<EmpresaListagemResponse>>(`${this.baseUrl}/empresas`, {
        params: httpParams,
      })
      .pipe(
        map((r) => unwrap(r) ?? { items: [], total: 0, page: 1, limit: 20 }),
        catchError(this.handleError)
      );
  }

  atualizar(id: number | string, data: { razao_social?: string; regime?: string; contabilidade_id?: number | null }): Observable<unknown> {
    return this.http
      .put<ApiSuccess<unknown>>(`${this.baseUrl}/empresas/${id}`, {
        razao_social: data.razao_social,
        regime: data.regime,
        contabilidade_id: data.contabilidade_id,
      })
      .pipe(catchError(this.handleError));
  }

  obterPorId(id: number | string): Observable<EmpresaDetalhes> {
    return this.http
      .get<ApiSuccess<EmpresaDetalhes>>(`${this.baseUrl}/empresas/${id}`)
      .pipe(
        map((r) => {
          const d = unwrap(r);
          if (!d) throw new Error('Resposta vazia');
          return d;
        }),
        catchError(this.handleError)
      );
  }

  cadastroCertificado(
    file: File,
    senha: string,
    contabilidade_id?: number | null
  ): Observable<CadastroResult> {
    const form = new FormData();
    form.append('file', file);
    form.append('senha', senha);
    if (contabilidade_id != null && contabilidade_id > 0) {
      form.append('contabilidade_id', String(contabilidade_id));
    }

    return this.http
      .post<ApiSuccess<CadastroResult>>(
        `${this.baseUrl}/empresas/cadastro/certificado`,
        form
      )
      .pipe(
        map((r) => {
          const d = unwrap(r);
          if (!d) throw new Error('Resposta vazia');
          return d;
        }),
        catchError(this.handleError)
      );
  }

  cadastroCredencial(payload: CadastroCredencialPayload): Observable<CadastroResult> {
    return this.http
      .post<ApiSuccess<CadastroResult>>(
        `${this.baseUrl}/empresas/cadastro/credencial`,
        payload
      )
      .pipe(
        map((r) => {
          const d = unwrap(r);
          if (!d) throw new Error('Resposta vazia');
          return d;
        }),
        catchError(this.handleError)
      );
  }

  previewCertificados(files: File[], senha: string): Observable<PreviewCertificadosResponse> {
    const form = new FormData();
    form.append('senha', senha);
    files.forEach((f) => form.append('files', f));

    return this.http
      .post<ApiSuccess<PreviewCertificadosResponse>>(
        `${this.baseUrl}/imports/certificados/preview`,
        form
      )
      .pipe(
        map((r) => {
          const d = unwrap(r);
          if (!d) throw new Error('Resposta vazia');
          return d;
        }),
        catchError(this.handleError)
      );
  }

  confirmarCertificados(payload: ConfirmarCertificadosPayload): Observable<ConfirmarCertificadosResponse> {
    return this.http
      .post<ApiSuccess<ConfirmarCertificadosResponse>>(
        `${this.baseUrl}/imports/certificados/confirmar`,
        payload
      )
      .pipe(
        map((r) => {
          const d = unwrap(r);
          if (!d) throw new Error('Resposta vazia');
          return d;
        }),
        catchError(this.handleError)
      );
  }

  previewCredenciais(file: File): Observable<PreviewCredenciaisResponse> {
    const form = new FormData();
    form.append('arquivo', file);

    return this.http
      .post<ApiSuccess<PreviewCredenciaisResponse>>(
        `${this.baseUrl}/imports/credenciais/preview`,
        form
      )
      .pipe(
        map((r) => {
          const d = unwrap(r);
          if (!d) throw new Error('Resposta vazia');
          return d;
        }),
        catchError(this.handleError)
      );
  }

  confirmarCredenciais(
    payload: ConfirmarCredenciaisPayload
  ): Observable<ConfirmarCredenciaisResponse> {
    return this.http
      .post<ApiSuccess<ConfirmarCredenciaisResponse>>(
        `${this.baseUrl}/imports/credenciais/confirmar`,
        payload
      )
      .pipe(
        map((r) => {
          const d = unwrap(r);
          if (!d) throw new Error('Resposta vazia');
          return d;
        }),
        catchError(this.handleError)
      );
  }

  getSummary(params?: {
    contabilidade_id?: number | null;
    search?: string;
    has_cert?: boolean;
    has_cred?: boolean;
    sem_cert?: boolean;
    sem_cred?: boolean;
    sem_metodo?: boolean;
  }): Observable<EmpresasSummaryResponse> {
    let httpParams = new HttpParams();
    if (params?.contabilidade_id != null && params.contabilidade_id > 0) {
      httpParams = httpParams.set('contabilidade_id', String(params.contabilidade_id));
    }
    if (params?.search?.trim()) {
      httpParams = httpParams.set('search', params.search.trim());
    }
    if (params?.has_cert != null) {
      httpParams = httpParams.set('has_cert', String(params.has_cert));
    }
    if (params?.has_cred != null) {
      httpParams = httpParams.set('has_cred', String(params.has_cred));
    }
    if (params?.sem_cert) {
      httpParams = httpParams.set('sem_cert', 'true');
    }
    if (params?.sem_cred) {
      httpParams = httpParams.set('sem_cred', 'true');
    }
    if (params?.sem_metodo) {
      httpParams = httpParams.set('sem_metodo', 'true');
    }
    const defaultSummary: EmpresasSummaryResponse = {
      total_empresas: 0,
      certificados_vencidos: 0,
      credenciais_para_validar: 0,
      operacionais: 0,
    };
    return this.http
      .get<ApiSuccess<EmpresasSummaryResponse> | EmpresasSummaryResponse>(
        `${this.baseUrl}/empresas/summary`,
        { params: httpParams }
      )
      .pipe(
        map((r) => {
          const d = (r as ApiSuccess<EmpresasSummaryResponse>)?.data ?? (r as EmpresasSummaryResponse);
          if (d && typeof d === 'object' && 'total_empresas' in d) {
            return {
              total_empresas: Number(d.total_empresas ?? 0),
              certificados_vencidos: Number(d.certificados_vencidos ?? 0),
              credenciais_para_validar: Number(d.credenciais_para_validar ?? 0),
              operacionais: Number(d.operacionais ?? 0),
            };
          }
          return defaultSummary;
        }),
        catchError(this.handleError)
      );
  }

  excluir(id: number | string): Observable<void> {
    return this.http
      .delete<void>(`${this.baseUrl}/empresas/${id}`)
      .pipe(catchError(this.handleError));
  }

  /** Remove certificado digital da empresa pelo CNPJ */
  removerCertificado(cnpj: string): Observable<void> {
    const cnpjLimpo = (cnpj || '').replace(/\D/g, '');
    return this.http
      .delete<void>(`${this.baseUrl}/certificados/cnpj/${cnpjLimpo}`)
      .pipe(catchError(this.handleError));
  }

  excluirEmMassa(ids: number[]): Observable<{ success: boolean; deleted: number }> {
    return this.http
      .request<ApiSuccess<{ success: boolean; deleted: number }>>(
        'DELETE',
        `${this.baseUrl}/empresas`,
        { body: { ids }, observe: 'response' }
      )
      .pipe(
        map((r) => {
          const body = r.body;
          if (body && typeof body === 'object' && 'data' in body) {
            const d = (body as ApiSuccess<{ success: boolean; deleted: number }>).data;
            return d ?? { success: true, deleted: ids.length };
          }
          return { success: true, deleted: ids.length };
        }),
        catchError(this.handleError)
      );
  }

  private handleError = (error: HttpErrorResponse): Observable<never> => {
    const msg =
      error.error?.detail ||
      error.error?.message ||
      error.message ||
      `Erro ${error.status}`;
    return throwError(() => new Error(msg));
  };
}
