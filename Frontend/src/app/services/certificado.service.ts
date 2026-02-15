import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError, BehaviorSubject } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export interface Certificado {
  id: string;
  cnpj: string;
  nomeArquivo: string;
  dataUpload: Date;
  dataValidade: Date | null;
  diasAteExpiracao: number | null;
  status: 'valido' | 'vencido' | 'proximo_vencimento';
  senha?: string; // Não armazenar em produção
  contabilidade_id?: number;
  contabilidade_nome?: string;
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
  private baseUrl = environment.apiUrl;
  private storageKey = 'certificados_armazenados';
  private certificadosSubject = new BehaviorSubject<Certificado[]>([]);
  public certificados$ = this.certificadosSubject.asObservable();

  constructor(private http: HttpClient) {
    this.carregarCertificados();
  }

  private limparCNPJ(cnpj: string): string {
    return cnpj ? cnpj.replace(/[^\d]/g, '') : '';
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
    const cnpjLimpo = this.limparCNPJ(certificado.cnpj);

    // Upsert por CNPJ: se já existir, atualiza; senão, adiciona.
    const index = certificados.findIndex(c => this.limparCNPJ(c.cnpj) === cnpjLimpo);
    if (index !== -1) {
      certificados[index] = { ...certificados[index], ...certificado, id: certificados[index].id };
    } else {
      certificados.push(certificado);
    }

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

  removerCertificado(certificado: Certificado) {
    // Remove primeiro no backend (tabela certificados) para que a contagem
    // nas contabilidades fique sempre consistente.
    const cnpjLimpo = this.limparCNPJ(certificado.cnpj);

    this.http.delete<void>(`${this.baseUrl}/certificados/cnpj/${cnpjLimpo}`)
      .pipe(
        catchError((error: HttpErrorResponse) => {
          console.error('❌ Erro ao remover certificado no backend:', error);
          return throwError(() => error);
        })
      )
      .subscribe({
        next: () => {
          // Atualiza lista local / localStorage
          const certificados = this.certificadosSubject.value.filter(c => c.id !== certificado.id);
          this.salvarCertificados(certificados);
        },
        error: (error) => {
          // Se o backend retornar 404 (já não existe no banco), seguimos com a remoção local
          if (error.status === 404) {
            const certificados = this.certificadosSubject.value.filter(c => c.id !== certificado.id);
            this.salvarCertificados(certificados);
            return;
          }

          alert(error.error?.detail || error.message || 'Erro ao remover certificado.');
        }
      });
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

  extrairInformacoesCertificado(file: File, senha: string): Observable<CertificadoImportado> {
    const formData = new FormData();
    formData.append('certificado', file);
    formData.append('senha', senha);

    const url = `${this.baseUrl}/certificados/extrair`;
    console.log(`[CertificadoService] Extraindo informações do certificado: ${url}`);

    return this.http.post<CertificadoImportado>(url, formData).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('❌ Erro HTTP na requisição:', error);
        if (error.error && typeof error.error === 'object' && 'success' in error.error) {
          return throwError(() => error.error as CertificadoImportado);
        }
        return throwError(() => ({
          success: false,
          message: error.error?.message || error.message || 'Erro ao extrair informações do certificado'
        } as CertificadoImportado));
      })
    );
  }

  importarCertificado(file: File, senha: string): Observable<CertificadoImportado> {
    // Mantido para compatibilidade, mas agora usa extrairInformacoesCertificado
    return this.extrairInformacoesCertificado(file, senha);
  }

  importarCertificadoComContabilidade(file: File, senha: string, contabilidadeId: number): Observable<CertificadoImportado> {
    const formData = new FormData();
    formData.append('certificado', file);
    formData.append('senha', senha);
    formData.append('contabilidade_id', contabilidadeId.toString());

    const url = `${this.baseUrl}/certificados/importar`;
    console.log(`[CertificadoService] Importando certificado com contabilidade_id: ${contabilidadeId}`);

    return this.http.post<CertificadoImportado>(url, formData).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('❌ Erro HTTP na requisição:', error);
        if (error.error && typeof error.error === 'object' && 'success' in error.error) {
          return throwError(() => error.error as CertificadoImportado);
        }
        return throwError(() => ({
          success: false,
          message: error.error?.message || error.message || 'Erro ao importar certificado'
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

  importarCertificadosLote(arquivos: File[], senha: string, contabilidadeId?: number | null): Observable<CertificadoImportacaoLoteResponse> {
    const formData = new FormData();
    
    // Adiciona todos os arquivos
    arquivos.forEach(arquivo => {
      formData.append('certificados', arquivo);
    });
    
    // Adiciona a senha
    formData.append('senha', senha);
    
    // Adiciona contabilidade_id se fornecido
    if (contabilidadeId !== null && contabilidadeId !== undefined) {
      formData.append('contabilidade_id', contabilidadeId.toString());
    }

    return this.http.post<CertificadoImportacaoLoteResponse>(`${this.baseUrl}/certificados/importar-lote`, formData).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('❌ Erro HTTP na requisição de importação em lote:', error);
        return throwError(() => error);
      })
    );
  }

  listarCertificadosPorContabilidade(contabilidadeId: number): Observable<{ certificados: CertificadoResponse[], total: number }> {
    return this.http.get<{ certificados: CertificadoResponse[], total: number }>(
      `${this.baseUrl}/certificados/contabilidade/${contabilidadeId}`
    ).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('❌ Erro HTTP ao buscar certificados por contabilidade:', error);
        return throwError(() => error);
      })
    );
  }
}

export interface CertificadoResponse {
  id: number;
  cnpj: string;
  empresa: string;
  data_vencimento: string;
  contabilidade_id?: number;
}