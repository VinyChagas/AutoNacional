import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError, BehaviorSubject } from 'rxjs';
import { catchError } from 'rxjs/operators';

export interface Certificado {
  id: string;
  cnpj: string;
  nomeArquivo: string;
  dataUpload: Date;
  dataValidade: Date | null;
  diasAteExpiracao: number | null;
  status: 'valido' | 'vencido' | 'proximo_vencimento';
  senha?: string; // Não armazenar em produção
}

@Injectable({
  providedIn: 'root'
})
export class CertificadoService {
  private baseUrl = 'http://localhost:8000/api';
  private storageKey = 'certificados_armazenados';
  private certificadosSubject = new BehaviorSubject<Certificado[]>([]);
  public certificados$ = this.certificadosSubject.asObservable();

  constructor(private http: HttpClient) {
    this.carregarCertificados();
  }

  private carregarCertificados() {
    const stored = localStorage.getItem(this.storageKey);
    if (stored) {
      try {
        const certificados = JSON.parse(stored).map((c: any) => ({
          ...c,
          dataUpload: new Date(c.dataUpload),
          dataValidade: c.dataValidade ? new Date(c.dataValidade) : null
        }));
        this.certificadosSubject.next(certificados);
      } catch (e) {
        console.error('Erro ao carregar certificados:', e);
      }
    }
  }

  private salvarCertificados(certificados: Certificado[]) {
    localStorage.setItem(this.storageKey, JSON.stringify(certificados));
    this.certificadosSubject.next(certificados);
  }

  uploadCertificado(cnpj: string, senha: string, arquivo: File): Observable<any> {
    const formData = new FormData();
    formData.append('cnpj', cnpj);
    formData.append('senha', senha);
    formData.append('certificado', arquivo);

    return this.http.post(`${this.baseUrl}/certificados`, formData).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('❌ Erro HTTP na requisição:', error);
        return throwError(() => error);
      })
    );
  }

  adicionarCertificadoLocal(certificado: Certificado) {
    const certificados = this.certificadosSubject.value;
    certificados.push(certificado);
    this.salvarCertificados(certificados);
  }

  atualizarCertificado(id: string, atualizacoes: Partial<Certificado>) {
    const certificados = this.certificadosSubject.value;
    const index = certificados.findIndex(c => c.id === id);
    if (index !== -1) {
      certificados[index] = { ...certificados[index], ...atualizacoes };
      this.salvarCertificados(certificados);
    }
  }

  removerCertificado(id: string) {
    const certificados = this.certificadosSubject.value.filter(c => c.id !== id);
    this.salvarCertificados(certificados);
  }

  calcularDiasAteExpiracao(dataValidade: Date | null): number | null {
    if (!dataValidade) return null;
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const validade = new Date(dataValidade);
    validade.setHours(0, 0, 0, 0);
    const diffTime = validade.getTime() - hoje.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  }

  obterStatusCertificado(diasAteExpiracao: number | null): 'valido' | 'vencido' | 'proximo_vencimento' {
    if (diasAteExpiracao === null) return 'valido';
    if (diasAteExpiracao < 0) return 'vencido';
    if (diasAteExpiracao <= 30) return 'proximo_vencimento';
    return 'valido';
  }
}