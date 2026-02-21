import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { BillingSummary } from '../models/billing-summary.model';

@Injectable({ providedIn: 'root' })
export class RentabilidadeService {
  private baseUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  obterBillingSummary(competencia: string, contabilidadeId?: number | null): Observable<BillingSummary> {
    let url = `${this.baseUrl}/metrics/billing-summary?competencia=${encodeURIComponent(competencia)}`;
    if (contabilidadeId != null && contabilidadeId > 0) {
      url += `&contabilidade_id=${contabilidadeId}`;
    }
    return this.http.get<BillingSummary>(url).pipe(
      catchError((error) => {
        console.error('Erro ao obter billing summary:', error);
        return throwError(() => error);
      })
    );
  }
}
