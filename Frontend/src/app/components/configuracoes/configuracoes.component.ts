import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { SettingsService } from '../../services/settings.service';
import { AutomationSettings } from '../../models/automation-settings.model';

@Component({
  selector: 'app-configuracoes',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './configuracoes.component.html',
  styleUrls: ['./configuracoes.component.scss']
})
export class ConfiguracoesComponent implements OnInit {
  settingsForm!: FormGroup;
  loading = false;
  saving = false;
  originalSettings: AutomationSettings | null = null;
  saveMessage: { type: 'success' | 'error'; text: string } | null = null;

  constructor(
    private fb: FormBuilder,
    private settingsService: SettingsService
  ) {
    this.initializeForm();
  }

  ngOnInit() {
    this.loadSettings();
  }

  private initializeForm() {
    this.settingsForm = this.fb.group({
      // Execução Geral
      headless: [false],
      companyTimeoutSeconds: [0, [Validators.required, this.nonNegativeValidator]],
      maxRetriesPerStep: [0, [Validators.required, this.nonNegativeValidator]],
      minActionDelayMs: [0, [Validators.required, this.nonNegativeValidator]],

      // Navegadores / Concorrência
      maxConcurrentBrowsers: [0, [Validators.required, this.nonNegativeValidator]],
      defaultConcurrentBrowsers: [0, [Validators.required, this.nonNegativeValidator]],
      browserLaunchDelayMs: [0, [Validators.required, this.nonNegativeValidator]],
      viewportPreset: ['HD', Validators.required],
      viewportWidth: [null],
      viewportHeight: [null],

      // Diretórios
      downloadsBasePath: ['', Validators.required],
      downloadsPattern: ['', Validators.required],
      logsPath: ['', Validators.required],
      tempPath: ['', Validators.required],

      // Logs & Relatórios
      logLevel: ['INFO', Validators.required],
      saveErrorScreenshots: [false],
      generatePdfReport: [false],
      logRetentionDays: [0, [Validators.required, this.nonNegativeValidator]],
      maxErrorsInPanel: [0, [Validators.required, this.nonNegativeValidator]]
    });

    // Validação condicional para viewport quando CUSTOM
    this.settingsForm.get('viewportPreset')?.valueChanges.subscribe(preset => {
      if (preset === 'CUSTOM') {
        this.settingsForm.get('viewportWidth')?.setValidators([Validators.required, Validators.min(1)]);
        this.settingsForm.get('viewportHeight')?.setValidators([Validators.required, Validators.min(1)]);
      } else {
        this.settingsForm.get('viewportWidth')?.clearValidators();
        this.settingsForm.get('viewportHeight')?.clearValidators();
      }
      this.settingsForm.get('viewportWidth')?.updateValueAndValidity();
      this.settingsForm.get('viewportHeight')?.updateValueAndValidity();
    });
  }

  private nonNegativeValidator(control: AbstractControl): ValidationErrors | null {
    const value = control.value;
    if (value === null || value === undefined || value === '') {
      return null; // Deixa Validators.required tratar valores vazios
    }
    const numValue = typeof value === 'string' ? parseFloat(value) : value;
    if (isNaN(numValue) || numValue < 0) {
      return { nonNegative: true };
    }
    return null;
  }

  get viewportPreset() {
    return this.settingsForm.get('viewportPreset')?.value;
  }

  loadSettings() {
    this.loading = true;
    this.saveMessage = null;

    this.settingsService.getSettings().subscribe({
      next: (settings) => {
        this.originalSettings = { ...settings };
        this.settingsForm.patchValue(settings);
        this.loading = false;
      },
      error: (error) => {
        console.error('Erro ao carregar configurações:', error);
        this.showMessage('error', 'Erro ao carregar configurações. Tente novamente.');
        this.loading = false;
      }
    });
  }

  saveSettings() {
    if (this.settingsForm.invalid) {
      this.markFormGroupTouched(this.settingsForm);
      this.showMessage('error', 'Por favor, corrija os erros no formulário antes de salvar.');
      return;
    }

    this.saving = true;
    this.saveMessage = null;

    const formValue = this.settingsForm.value;
    const settings: AutomationSettings = {
      ...formValue,
      // Garantir que viewportWidth e viewportHeight sejam undefined se não CUSTOM
      viewportWidth: formValue.viewportPreset === 'CUSTOM' ? formValue.viewportWidth : undefined,
      viewportHeight: formValue.viewportPreset === 'CUSTOM' ? formValue.viewportHeight : undefined
    };

    this.settingsService.updateSettings(settings).subscribe({
      next: () => {
        this.originalSettings = { ...settings };
        this.saving = false;
        this.showMessage('success', 'Configurações salvas com sucesso!');
      },
      error: (error) => {
        console.error('Erro ao salvar configurações:', error);
        this.saving = false;
        this.showMessage('error', 'Erro ao salvar configurações. Tente novamente.');
      }
    });
  }

  reloadDefaults() {
    if (this.originalSettings) {
      this.settingsForm.patchValue(this.originalSettings);
      this.showMessage('success', 'Configurações recarregadas para os valores padrão.');
    } else {
      this.loadSettings();
    }
  }

  private markFormGroupTouched(formGroup: FormGroup) {
    Object.keys(formGroup.controls).forEach(key => {
      const control = formGroup.get(key);
      control?.markAsTouched();
      if (control instanceof FormGroup) {
        this.markFormGroupTouched(control);
      }
    });
  }

  private showMessage(type: 'success' | 'error', text: string) {
    this.saveMessage = { type, text };
    setTimeout(() => {
      this.saveMessage = null;
    }, 5000);
  }

  isFieldInvalid(fieldName: string): boolean {
    const field = this.settingsForm.get(fieldName);
    return !!(field && field.invalid && (field.dirty || field.touched));
  }

  getFieldError(fieldName: string): string {
    const field = this.settingsForm.get(fieldName);
    if (field && field.errors) {
      if (field.errors['required']) {
        return 'Campo obrigatório';
      }
      if (field.errors['nonNegative']) {
        return 'Valor deve ser maior ou igual a 0';
      }
      if (field.errors['min']) {
        return `Valor deve ser maior que ${field.errors['min'].min}`;
      }
    }
    return '';
  }

  async selectDirectory(fieldName: string) {
    try {
      // Tenta usar a File System Access API (Chrome/Edge)
      if ('showDirectoryPicker' in window) {
        // @ts-ignore - File System Access API ainda não tem tipos completos
        const directoryHandle = await (window as any).showDirectoryPicker();
        
        // Tenta obter o caminho completo através do handle
        // Nota: A API moderna não expõe caminhos completos por segurança
        // Usamos o nome do diretório como valor
        const directoryName = directoryHandle.name;
        
        // Se o campo já tiver um valor, tentamos construir o caminho relativo
        const currentValue = this.settingsForm.get(fieldName)?.value || '';
        const newPath = currentValue ? `${currentValue}/${directoryName}` : directoryName;
        
        this.settingsForm.get(fieldName)?.setValue(newPath);
        return;
      }

      // Fallback: usa input file com webkitdirectory
      const input = document.createElement('input');
      input.type = 'file';
      (input as any).webkitdirectory = true;
      input.style.display = 'none';
      
      input.onchange = (event: any) => {
        const files = event.target.files;
        if (files && files.length > 0) {
          // Obtém o diretório do primeiro arquivo
          const filePath = (files[0] as any).webkitRelativePath;
          if (filePath) {
            const directoryPath = filePath.substring(0, filePath.lastIndexOf('/'));
            this.settingsForm.get(fieldName)?.setValue(directoryPath);
          } else {
            // Fallback: usa o nome do arquivo para inferir o diretório
            const fileName = files[0].name;
            this.settingsForm.get(fieldName)?.setValue(fileName.substring(0, fileName.lastIndexOf('/')) || fileName);
          }
        }
        document.body.removeChild(input);
      };

      input.oncancel = () => {
        if (document.body.contains(input)) {
          document.body.removeChild(input);
        }
      };

      document.body.appendChild(input);
      input.click();
    } catch (error: any) {
      // Usuário cancelou ou erro ocorreu
      if (error.name !== 'AbortError' && error.name !== 'NotAllowedError') {
        console.error('Erro ao selecionar diretório:', error);
        this.showMessage('error', 'Erro ao selecionar diretório. Digite o caminho manualmente.');
      }
    }
  }
}

