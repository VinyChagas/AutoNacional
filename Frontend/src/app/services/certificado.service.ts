import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

@Injectable({
  providedIn: 'root'
})
export class CertificadoService {
  private baseUrl = 'http://localhost:8000/api'; // backend Python

  constructor(private http: HttpClient) {}

  uploadCertificado(cnpj: string, senha: string, arquivo: File): Observable<any> {
    const formData = new FormData();
    formData.append('cnpj', cnpj);
    formData.append('senha', senha);
    formData.append('certificado', arquivo);

    console.log('📤 Enviando requisição para:', `${this.baseUrl}/certificados`);
    console.log('📤 CNPJ:', cnpj);
    console.log('📤 Arquivo:', arquivo.name, arquivo.size, 'bytes');
    console.log('📤 Base URL:', this.baseUrl);

    return this.http.post(`${this.baseUrl}/certificados`, formData, {
      // Timeout de 60 segundos para uploads grandes
      // reportProgress: true, // Para acompanhar progresso se necessário
    }).pipe(
      catchError((error: HttpErrorResponse) => {
        console.error('❌ Erro HTTP na requisição:', error);
        console.error('❌ Status:', error.status);
        console.error('❌ Status Text:', error.statusText);
        console.error('❌ Error:', error.error);
        console.error('❌ URL:', error.url);
        console.error('❌ Name:', error.name);
        
        // Se não houver status, é erro de conexão
        if (!error.status || error.status === 0) {
          console.error('❌ Erro de conexão - servidor não está respondendo');
          console.error('❌ Verifique se o servidor está rodando em:', this.baseUrl);
        }
        
        return throwError(() => error);
      })
    );
  }
}