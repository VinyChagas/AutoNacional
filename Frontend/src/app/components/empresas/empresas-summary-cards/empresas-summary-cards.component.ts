import {
  Component,
  Input,
  Output,
  EventEmitter,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import type { EmpresasSummaryResponse } from '../../../models/empresas-unificado.model';

export type EmpresasFilterPreset =
  | { type: 'ALL' }
  | { type: 'CERT_VENCIDO' }
  | { type: 'CRED_VALIDAR' }
  | { type: 'OPERACIONAIS' };

export interface SummaryCard {
  id: string;
  title: string;
  value: number;
  subtext: string;
  preset: EmpresasFilterPreset;
}

@Component({
  selector: 'app-empresas-summary-cards',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './empresas-summary-cards.component.html',
  styleUrls: ['./empresas-summary-cards.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmpresasSummaryCardsComponent {
  @Input() summary: EmpresasSummaryResponse = {
    total_empresas: 0,
    certificados_vencidos: 0,
    credenciais_para_validar: 0,
    operacionais: 0,
  };

  @Input() totalFromList: number | null = null;

  @Input() loading = false;

  @Input() activePreset: EmpresasFilterPreset | null = null;

  @Output() filterRequested = new EventEmitter<EmpresasFilterPreset>();

  get cards(): SummaryCard[] {
    const total = this.summary.total_empresas > 0
      ? this.summary.total_empresas
      : (this.totalFromList ?? 0);
    return [
      {
        id: 'total',
        title: 'Total de Empresas',
        value: total,
        subtext: 'Cadastradas',
        preset: { type: 'ALL' },
      },
      {
        id: 'cert_vencido',
        title: 'Certificados Vencidos',
        value: this.summary.certificados_vencidos,
        subtext: 'Renovar certificado',
        preset: { type: 'CERT_VENCIDO' },
      },
      {
        id: 'cred_validar',
        title: 'Credenciais para Validar',
        value: this.summary.credenciais_para_validar,
        subtext: 'Revalidar em 7 dias',
        preset: { type: 'CRED_VALIDAR' },
      },
      {
        id: 'operacionais',
        title: 'Operacionais',
        value: this.summary.operacionais,
        subtext: 'Aptas para automação',
        preset: { type: 'OPERACIONAIS' },
      },
    ];
  }

  isCardActive(card: SummaryCard): boolean {
    const p = this.activePreset;
    return p != null && p.type === card.preset.type;
  }

  onCardClick(preset: EmpresasFilterPreset): void {
    this.filterRequested.emit(preset);
  }
}
