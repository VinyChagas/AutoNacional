import { Injectable, signal, computed } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly STORAGE_KEY = 'autonacional-theme';

  private darkMode = signal<boolean>(this.loadInitialTheme());

  isDark = computed(() => this.darkMode());

  constructor() {
    this.apply();
  }

  private loadInitialTheme(): boolean {
    if (typeof localStorage === 'undefined') return false;
    const stored = localStorage.getItem(this.STORAGE_KEY);
    if (stored !== null) return stored === 'dark';
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  }

  toggle(): void {
    this.darkMode.update((v) => !v);
    this.apply();
  }

  setDark(value: boolean): void {
    this.darkMode.set(value);
    this.apply();
  }

  private apply(): void {
    const dark = this.darkMode();
    if (typeof document === 'undefined') return;
    document.documentElement.classList.toggle('dark', dark);
    localStorage?.setItem(this.STORAGE_KEY, dark ? 'dark' : 'light');
  }
}
