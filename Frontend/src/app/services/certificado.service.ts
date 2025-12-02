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

export interface CertificadoImportado {
  success: boolean;
  empresa?: string;
  cnpj?: string;
  dataVencimento?: string;
  message?: string;
}

export interface CertificadoValidacaoLoteItem {
  nome_arquivo: string;
  sucesso: boolean;
  cnpj?: string;
  empresa?: string;
  data_vencimento?: string;
  mensagem_erro?: string;
}

export interface CertificadoValidacaoLoteResponse {
  total: number;
  sucesso: number;
  falha: number;
  resultados: CertificadoValidacaoLoteItem[];
}

export interface CertificadoImportacaoLoteItem {
  nome_arquivo: string;
  sucesso: boolean;
  cnpj?: string;
  empresa?: string;
  data_vencimento?: string;
  mensagem_erro?: string;
}

export interface CertificadoImportacaoLoteResponse {
  total: number;
  sucesso: number;
  falha: number;
  resultados: CertificadoImportacaoLoteItem[];
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

  importarCertificado(file: File, senha: string): Observable<CertificadoImportado> {
    const formData = new FormData();
    formData.append('certificado', file);
    formData.append('senha', senha);

    const url = `${this.baseUrl}/certificados/importar`;
    console.log(`[CertificadoService] Fazendo requisição POST para: ${url}`);
    console.log(`[CertificadoService] Arquivo: ${file.name}, Tamanho: ${file.size} bytes`);

    return this.http.post<CertificadoImportado>(url, formData).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('❌ Erro HTTP na requisição:', error);
        console.error('❌ Status:', error.status);
        console.error('❌ Status Text:', error.statusText);
        console.error('❌ Error Message:', error.message);
        console.error('❌ Error Object:', error.error);
        console.error('❌ URL:', error.url || url);
        
        // Erro "0 Unknown Error" geralmente significa que a requisição não chegou ao servidor
        if (error.status === 0) {
          console.error('⚠️ Erro 0 (Unknown Error) - Possíveis causas:');
          console.error('   1. Servidor não está rodando');
          console.error('   2. CORS bloqueando a requisição');
          console.error('   3. Problema de conectividade');
          console.error('   4. Timeout na requisição');
        }
        
        // Se o backend retornou um JSON com success: false, retorna ele
        if (error.error && typeof error.error === 'object' && 'success' in error.error) {
          return throwError(() => error.error as CertificadoImportado);
        }
        // Caso contrário, cria um objeto de erro padrão
        return throwError(() => ({
          success: false,
          message: error.status === 0 
            ? 'Erro de conexão. Verifique se o servidor está rodando e se há problemas de CORS.'
            : (error.error?.message || error.message || 'Erro ao importar certificado')
        } as CertificadoImportado));
      })
    );
  }

  validarCertificadosLote(arquivos: File[], senha: string): Observable<CertificadoValidacaoLoteResponse> {
    const formData = new FormData();
    
    // Adiciona todos os arquivos
    arquivos.forEach(arquivo => {
      formData.append('certificados', arquivo);
    });
    
    // Adiciona a senha
    formData.append('senha', senha);

    return this.http.post<CertificadoValidacaoLoteResponse>(`${this.baseUrl}/certificados/validar-lote`, formData).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('❌ Erro HTTP na requisição de validação em lote:', error);
        return throwError(() => error);
      })
    );
  }

  importarCertificadosLote(arquivos: File[], senha: string): Observable<CertificadoImportacaoLoteResponse> {
    const formData = new FormData();
    
    // Adiciona todos os arquivos
    arquivos.forEach(arquivo => {
      formData.append('certificados', arquivo);
    });
    
    // Adiciona a senha
    formData.append('senha', senha);

    return this.http.post<CertificadoImportacaoLoteResponse>(`${this.baseUrl}/certificados/importar-lote`, formData).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('❌ Erro HTTP na requisição de importação em lote:', error);
        return throwError(() => error);
      })
    );
  }
}