import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

const STORAGE_KEY = 'sidebar_collapsed';

@Injectable({ providedIn: 'root' })
export class SidebarService {
  private readonly collapsed$ = new BehaviorSubject<boolean>(this.loadFromStorage());

  get collapsed(): boolean {
    return this.collapsed$.getValue();
  }

  collapsedState = this.collapsed$.asObservable();

  constructor() {}

  private loadFromStorage(): boolean {
    if (typeof localStorage === 'undefined') return false;
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === '1';
  }

  toggle(): void {
    const next = !this.collapsed$.getValue();
    this.collapsed$.next(next);
    localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
  }

  setCollapsed(value: boolean): void {
    this.collapsed$.next(value);
    localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
  }
}
