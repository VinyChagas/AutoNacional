import { Component } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { CertificadoService } from '../../services/certificado.service';

@Component({
  selector: 'app-certificado-upload',
  standalone: true,
  imports: [ReactiveFormsModule, CommonModule],
  templateUrl: './certificado-upload.component.html',
  styleUrls: ['./certificado-upload.component.scss'],
})
export class CertificadoUploadComponent {
  certForm: FormGroup;
  selectedFile: File | null = null;
  mensagem = '';
  carregando = false;

  constructor(
    private fb: FormBuilder,
    private certificadoService: CertificadoService
  ) {
    this.certForm = this.fb.group({
      cnpj: ['', [Validators.required]],
      senha: ['', [Validators.required]],
    });
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.selectedFile = input.files[0];
    }
  }

  onSubmit() {
    if (!this.certForm.valid || !this.selectedFile) return;

    this.carregando = true;
    this.mensagem = '';

    const { cnpj, senha } = this.certForm.value;

    this.certificadoService.uploadCertificado(cnpj, senha, this.selectedFile).subscribe({
      next: (response: any) => {
        console.log('📥 Resposta RAW do servidor:', response);
        console.log('📥 Tipo da resposta:', typeof response);
        console.log('📥 response.body:', response.body);
        console.log('📥 response.status:', response.status);
        
        // Trata tanto resposta direta quanto HttpResponse
        const data = response.body || response;
        console.log('✅ Dados extraídos:', data);
        console.log('✅ data.cnpj:', data?.cnpj);
        console.log('✅ data.message:', data?.message);
        console.log('✅ data.success:', data?.success);
        
        // Verifica se a resposta indica sucesso
        if (data && (data.success !== false)) {
          if (data.cnpj) {
            this.mensagem = `✅ Certificado salvo com sucesso para o CNPJ ${data.cnpj}`;
          } else if (data.message) {
            this.mensagem = `✅ ${data.message}`;
          } else {
            this.mensagem = '✅ Certificado salvo com sucesso!';
          }
          
          this.certForm.reset();
          this.selectedFile = null;
          this.carregando = false;
        } else {
          console.warn('⚠️ Resposta não indica sucesso:', data);
          this.mensagem = '⚠️ Resposta inesperada do servidor. Verifique os logs.';
          this.carregando = false;
        }
      },
      error: (err: any) => {
        console.error('❌ ERRO ao fazer upload:', err);
        console.error('❌ err.status:', err.status);
        console.error('❌ err.statusText:', err.statusText);
        console.error('❌ err.error:', err.error);
        console.error('❌ err.message:', err.message);
        console.error('❌ err.name:', err.name);
        console.error('❌ err completo:', JSON.stringify(err, null, 2));
        
        let mensagemErro = 'Erro ao salvar certificado';
        
        // Verifica se é um erro de rede (sem resposta do servidor)
        if (!err.status && !err.error) {
          console.error('❌ Erro de conexão detectado - sem status e sem error');
          mensagemErro = 'Erro de conexão. Verifique se o servidor está rodando em http://localhost:8000';
        } else if (err.status === 0) {
          console.error('❌ Status 0 - erro de CORS ou conexão');
          mensagemErro = 'Erro de conexão ou CORS. Verifique se o servidor está rodando e se CORS está configurado.';
        } else if (err.status >= 200 && err.status < 300) {
          // Status 2xx não deveria entrar aqui, mas vamos tratar
          console.warn('⚠️ Status 2xx no error handler, pode ser um falso positivo');
          this.mensagem = 'Operação concluída, mas resposta inesperada. Verifique os logs.';
          this.carregando = false;
          return;
        } else if (err.error) {
          // Tenta diferentes formatos de erro
          if (err.error.detail) {
            mensagemErro = err.error.detail;
          } else if (err.error.message) {
            mensagemErro = err.error.message;
          } else if (typeof err.error === 'string') {
            mensagemErro = err.error;
          } else if (err.error.errors && Array.isArray(err.error.errors)) {
            // Erros de validação do FastAPI
            const erros = err.error.errors.map((e: any) => `${e.field}: ${e.message}`).join(', ');
            mensagemErro = `Erro de validação: ${erros}`;
          }
        } else if (err.message) {
          mensagemErro = err.message;
        }
        
        // Adiciona informações de debug
        if (err.status) {
          mensagemErro += ` (Status: ${err.status})`;
        }
        
        this.mensagem = mensagemErro;
        this.carregando = false;
      }
    });
  }
}