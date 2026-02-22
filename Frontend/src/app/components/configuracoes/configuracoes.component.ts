import {
  Component,
  OnInit,
  OnDestroy,
  ChangeDetectorRef,
  inject,
  HostListener,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, FormsModule, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { SettingsService } from '../../services/settings.service';
import { ToastService } from '../../services/toast.service';
import {
  AutomationSettings,
  ExecutionPreset,
  PRESET_VALUES,
  ConfigStatus,
  TestPathsResponse,
  ViewportPreset,
} from '../../models/automation-settings.model';
import { Subject, takeUntil, debounceTime, distinctUntilChanged } from 'rxjs';

type TabId = 'automacao' | 'arquivos' | 'logs' | 'ambiente';

@Component({
  selector: 'app-configuracoes',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule],
  templateUrl: './configuracoes.component.html',
  styleUrls: ['./configuracoes.component.scss'],
})
export class ConfiguracoesComponent implements OnInit, OnDestroy {
  private fb = inject(FormBuilder);
  private settingsService = inject(SettingsService);
  private toast = inject(ToastService);
  private cdr = inject(ChangeDetectorRef);
  private destroy$ = new Subject<void>();

  settingsForm!: FormGroup;
  activeTab: TabId = 'automacao';
  loading = false;
  saving = false;
  testingPaths = false;
  loadingStatus = false;
  configStatus: ConfigStatus | null = null;
  pathTestResult: TestPathsResponse | null = null;

  presetSelected: ExecutionPreset | '' = '';
  hasUnsavedChanges = false;
  showDiscardModal = false;
  pendingTabSwitch: TabId | null = null;

  readonly tabs: { id: TabId; label: string; icon: string }[] = [
    { id: 'automacao', label: 'Automação', icon: 'play' },
    { id: 'arquivos', label: 'Arquivos e Diretórios', icon: 'folder' },
    { id: 'logs', label: 'Logs e Diagnóstico', icon: 'document' },
    { id: 'ambiente', label: 'Ambiente e Status', icon: 'shield' },
  ];

  readonly presets: { value: ExecutionPreset; label: string }[] = [
    { value: 'RAPIDO', label: 'Rápido' },
    { value: 'PADRAO', label: 'Padrão' },
    { value: 'ESTAVEL', label: 'Estável' },
  ];

  readonly viewportOptions: { value: ViewportPreset; label: string }[] = [
    { value: 'DESKTOP_1366x768', label: 'Desktop (1366×768)' },
    { value: 'HD', label: 'HD (1280×720)' },
    { value: 'FULLHD', label: 'Full HD (1920×1080)' },
    { value: 'QHD', label: 'QHD (2560×1440)' },
    { value: 'CUSTOM', label: 'Personalizado' },
  ];

  previewCnpj = '00.000.000/0001-00';
  previewCompetencia = '2026-01';

  ngOnInit() {
    this.initializeForm();
    this.loadSettings();
    this.loadConfigStatus();
    this.setupDirtyTracking();
    this.setupPreviewSubscription();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(e: BeforeUnloadEvent) {
    if (this.hasUnsavedChanges) e.preventDefault();
  }

  private initializeForm() {
    this.settingsForm = this.fb.group(
      {
        headless: [false],
        companyTimeoutSeconds: [3600, [Validators.required, this.minValidator(1)]],
        maxRetriesPerStep: [3, [Validators.required, this.minValidator(1)]],
        minActionDelayMs: [500, [Validators.required, this.minValidator(0)]],
        maxConcurrentBrowsers: [5, [Validators.required, this.minValidator(1)]],
        defaultConcurrentBrowsers: [3, [Validators.required, this.minValidator(1)]],
        browserLaunchDelayMs: [1000, [Validators.required, this.minValidator(0)]],
        viewportPreset: ['FULLHD', Validators.required],
        viewportWidth: [null as number | null],
        viewportHeight: [null as number | null],
        downloadsBasePath: ['./downloads', Validators.required],
        downloadsPattern: ['{cnpj}/{ano}/{mes}', Validators.required],
        logsPath: ['./logs', Validators.required],
        tempPath: ['./temp', Validators.required],
        logLevel: ['INFO', Validators.required],
        saveErrorScreenshots: [true],
        generatePdfReport: [true],
        logRetentionDays: [30, [Validators.required, this.minValidator(1)]],
        maxErrorsInPanel: [100, [Validators.required, this.minValidator(1)]],
      },
      { validators: this.concurrentBrowsersValidator }
    );

    this.settingsForm.get('viewportPreset')?.valueChanges.pipe(takeUntil(this.destroy$)).subscribe((preset) => {
      const w = this.settingsForm.get('viewportWidth');
      const h = this.settingsForm.get('viewportHeight');
      if (preset === 'CUSTOM') {
        w?.setValidators([Validators.required, this.minValidator(1)]);
        h?.setValidators([Validators.required, this.minValidator(1)]);
      } else {
        w?.clearValidators();
        h?.clearValidators();
        w?.setValue(null);
        h?.setValue(null);
      }
      w?.updateValueAndValidity();
      h?.updateValueAndValidity();
    });
  }

  private minValidator(min: number) {
    return (control: AbstractControl): ValidationErrors | null => {
      const v = control.value;
      if (v == null || v === '') return null;
      const n = typeof v === 'string' ? parseInt(v, 10) : v;
      return !isNaN(n) && n >= min ? null : { min: { min, actual: n } };
    };
  }

  private concurrentBrowsersValidator(group: AbstractControl): ValidationErrors | null {
    const g = group as FormGroup;
    const max = g.get('maxConcurrentBrowsers')?.value ?? 0;
    const def = g.get('defaultConcurrentBrowsers')?.value ?? 0;
    if (max && def && def > max) {
      return { defaultExceedsMax: true };
    }
    return null;
  }

  private setupDirtyTracking() {
    this.settingsForm.valueChanges.pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.hasUnsavedChanges = this.settingsForm.dirty;
      this.cdr.markForCheck();
    });
  }

  private setupPreviewSubscription() {
    const base = this.settingsForm.get('downloadsBasePath');
    const pattern = this.settingsForm.get('downloadsPattern');
    if (base && pattern) {
      base.valueChanges.pipe(debounceTime(300), takeUntil(this.destroy$)).subscribe(() => this.updatePathPreview());
      pattern.valueChanges.pipe(debounceTime(300), takeUntil(this.destroy$)).subscribe(() => this.updatePathPreview());
    }
  }

  get patternPreview(): string {
    const base = this.settingsForm.get('downloadsBasePath')?.value ?? './downloads';
    const pattern = this.settingsForm.get('downloadsPattern')?.value ?? '{cnpj}/{ano}/{mes}';
    const cnpj = this.previewCnpj.replace(/\D/g, '');
    const [ano, mes] = this.previewCompetencia.includes('/')
      ? this.previewCompetencia.split('/').reverse()
      : this.previewCompetencia.includes('-')
        ? this.previewCompetencia.split('-')
        : ['2026', '01'];
    const resolved = pattern
      .replace(/\{cnpj\}/gi, cnpj)
      .replace(/\{ano\}/gi, ano)
      .replace(/\{mes\}/gi, mes);
    return `${base}/${resolved}`.replace(/\/+/g, '/');
  }

  updatePathPreview() {
    this.cdr.markForCheck();
  }

  loadSettings() {
    this.loading = true;
    this.settingsService.getSettings().subscribe({
      next: (res) => {
        const flat = this.flattenSettings(res as unknown as Record<string, unknown>);
        this.settingsForm.patchValue(flat, { emitEvent: false });
        this.settingsForm.markAsPristine();
        this.hasUnsavedChanges = false;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.toast.error('Erro ao carregar configurações');
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  private flattenSettings(res: Record<string, unknown>): Partial<AutomationSettings> {
    if (res['headless'] !== undefined) return res as Partial<AutomationSettings>;
    const exec = res['execution'] as Record<string, unknown> | undefined;
    const browsers = res['browsers'] as Record<string, unknown> | undefined;
    const paths = res['paths'] as Record<string, unknown> | undefined;
    const logs = res['logs'] as Record<string, unknown> | undefined;
    return {
      ...exec,
      ...browsers,
      ...paths,
      ...logs,
    } as Partial<AutomationSettings>;
  }

  loadConfigStatus() {
    this.loadingStatus = true;
    this.settingsService.getConfigStatus().subscribe({
      next: (s) => {
        this.configStatus = s;
        this.loadingStatus = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.configStatus = { apiUp: true, dbConnected: false, supabaseConfigured: false, playwrightOk: false, corsOrigins: [], port: 4321 };
        this.loadingStatus = false;
        this.cdr.markForCheck();
      },
    });
  }

  applyPreset(preset: ExecutionPreset) {
    this.presetSelected = preset;
    const values = PRESET_VALUES[preset];
    this.settingsForm.patchValue(values);
    this.hasUnsavedChanges = true;
    this.toast.info(`Preset "${preset}" aplicado. Clique em Salvar para confirmar.`);
    this.cdr.markForCheck();
  }

  saveSettings() {
    if (this.settingsForm.invalid) {
      this.markAllTouched();
      this.toast.error('Corrija os erros antes de salvar');
      return;
    }
    this.saving = true;
    const val = this.settingsForm.value;
    const payload: Partial<AutomationSettings> = {
      ...val,
      viewportWidth: val.viewportPreset === 'CUSTOM' ? val.viewportWidth : undefined,
      viewportHeight: val.viewportPreset === 'CUSTOM' ? val.viewportHeight : undefined,
    };
    this.settingsService.updateSettings(payload).subscribe({
      next: () => {
        this.settingsForm.markAsPristine();
        this.hasUnsavedChanges = false;
        this.saving = false;
        this.toast.success('Configurações salvas com sucesso');
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.saving = false;
        const msg = err.error?.errors?.[0]?.message ?? err.error?.detail ?? 'Erro ao salvar';
        this.toast.error(msg);
        this.cdr.markForCheck();
      },
    });
  }

  discardChanges() {
    this.loadSettings();
    this.showDiscardModal = false;
    this.pendingTabSwitch = null;
    this.hasUnsavedChanges = false;
    this.toast.info('Alterações descartadas');
  }

  resetToDefaults() {
    if (!confirm('Restaurar todas as configurações para os valores padrão?')) return;
    this.settingsService.resetSettings().subscribe({
      next: (res) => {
        const flat = this.flattenSettings(res as unknown as Record<string, unknown>);
        this.settingsForm.patchValue(flat);
        this.settingsForm.markAsPristine();
        this.hasUnsavedChanges = false;
        this.toast.success('Configurações restauradas');
        this.cdr.markForCheck();
      },
      error: () => this.toast.error('Erro ao restaurar'),
    });
  }

  switchTab(tabId: TabId) {
    if (this.hasUnsavedChanges) {
      this.pendingTabSwitch = tabId;
      this.showDiscardModal = true;
    } else {
      this.activeTab = tabId;
    }
  }

  confirmTabSwitch(discard: boolean) {
    if (discard && this.pendingTabSwitch) {
      this.activeTab = this.pendingTabSwitch;
      this.loadSettings();
      this.hasUnsavedChanges = false;
      this.toast.info('Alterações descartadas');
    }
    this.showDiscardModal = false;
    this.pendingTabSwitch = null;
  }

  cancelTabSwitch() {
    this.showDiscardModal = false;
    this.pendingTabSwitch = null;
  }

  testPaths() {
    const val = this.settingsForm.value;
    this.testingPaths = true;
    this.pathTestResult = null;
    this.settingsService
      .testPaths({
        downloadsBasePath: val.downloadsBasePath,
        downloadsPattern: val.downloadsPattern,
        logsPath: val.logsPath,
        tempPath: val.tempPath,
        sample: { cnpj: this.previewCnpj, competencia: this.previewCompetencia },
      })
      .subscribe({
        next: (r) => {
          this.pathTestResult = r;
          this.testingPaths = false;
          const ok = r.checks.downloadsWritable && r.checks.logsWritable && r.checks.tempWritable;
          this.toast[ok ? 'success' : 'error'](ok ? 'Diretórios válidos' : 'Problemas encontrados nos diretórios');
          this.cdr.markForCheck();
        },
        error: () => {
          this.testingPaths = false;
          this.toast.error('Erro ao testar diretórios');
          this.cdr.markForCheck();
        },
      });
  }

  refreshStatus() {
    this.loadConfigStatus();
  }

  get viewportPreset() {
    return this.settingsForm.get('viewportPreset')?.value as ViewportPreset;
  }

  isFieldInvalid(name: string): boolean {
    const c = this.settingsForm.get(name);
    return !!(c && c.invalid && (c.dirty || c.touched));
  }

  getFieldError(name: string): string {
    const c = this.settingsForm.get(name);
    if (!c?.errors) return '';
    if (c.errors['required']) return 'Obrigatório';
    if (c.errors['min']) return `Mínimo: ${c.errors['min'].min}`;
    if (c.errors['defaultExceedsMax']) return 'Padrão não pode ser maior que o máximo';
    return '';
  }

  private markAllTouched() {
    Object.keys(this.settingsForm.controls).forEach((k) => {
      this.settingsForm.get(k)?.markAsTouched();
    });
  }

  formatStatus(ok: boolean): string {
    return ok ? 'Configurado' : 'Não configurado';
  }

  onDebugTemporario() {
    this.toast.info('Em breve: Debug temporário por 30 minutos');
  }

  onColetarDiagnostico() {
    this.toast.info('Em breve: Coleta de pacote de diagnóstico');
  }

  selectDirectory(fieldName: string) {
    // 1) Tenta o backend primeiro (seletor nativo = caminho absoluto)
    this.settingsService.selectFolder().subscribe({
      next: (res) => {
        if (res.path) {
          this.settingsForm.get(fieldName)?.setValue(res.path);
          this.hasUnsavedChanges = true;
          this.cdr.markForCheck();
        }
      },
      error: (err) => {
        // 400 = usuário cancelou, não fazer fallback. 500/rede = fallback para browser
        if (err?.status === 400) return;
        this.selectDirectoryBrowser(fieldName);
      },
    });
  }

  private async selectDirectoryBrowser(fieldName: string) {
    try {
      if ('showDirectoryPicker' in window) {
        const directoryHandle = await (window as unknown as { showDirectoryPicker: () => Promise<{ name: string }> }).showDirectoryPicker();
        const directoryName = directoryHandle.name;
        this.settingsForm.get(fieldName)?.setValue(directoryName);
        this.hasUnsavedChanges = true;
        this.cdr.markForCheck();
        this.toast.info('Caminho relativo. Para caminho absoluto (ex: D:\\Pasta), o backend deve estar rodando localmente.');
        return;
      }

      const input = document.createElement('input');
      input.type = 'file';
      (input as HTMLInputElement & { webkitdirectory?: boolean }).webkitdirectory = true;
      input.style.display = 'none';

      input.onchange = (event: Event) => {
        const files = (event.target as HTMLInputElement).files;
        if (files && files.length > 0) {
          const file = files[0] as File & { webkitRelativePath?: string };
          const filePath = file.webkitRelativePath || '';
          const directoryPath = filePath ? filePath.substring(0, filePath.lastIndexOf('/')) : file.name;
          this.settingsForm.get(fieldName)?.setValue(directoryPath);
          this.hasUnsavedChanges = true;
          this.cdr.markForCheck();
        }
        document.body.removeChild(input);
      };

      input.oncancel = () => {
        if (document.body.contains(input)) document.body.removeChild(input);
      };

      document.body.appendChild(input);
      input.click();
    } catch (err: unknown) {
      const e = err as { name?: string };
      if (e?.name !== 'AbortError' && e?.name !== 'NotAllowedError') {
        this.toast.error('Erro ao selecionar diretório. Digite o caminho manualmente (ex: D:\\MinhasNotas).');
      }
    }
  }
}
