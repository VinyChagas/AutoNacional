import {
  Component,
  Input,
  Output,
  EventEmitter,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import type { EmpresaRow } from '../../../models/empresas-unificado.model';
import {
  computeCertStatus,
  computeCompanyStatusGeral,
  needsRevalidateCredentials,
} from '../status.utils';

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
  @Input({ required: true }) rows: EmpresaRow[] = [];

  @Input() activePreset: EmpresasFilterPreset | null = null;

  @Output() filterRequested = new EventEmitter<EmpresasFilterPreset>();

  get cards(): SummaryCard[] {
    const rows = this.rows;
    const total = rows.length;
    const certVencido = rows.filter(
      (r) => computeCertStatus(r) === 'VENCIDO'
    ).length;
    const credValidar = rows.filter(
      (r) => r.possui_credenciais && needsRevalidateCredentials(r)
    ).length;
    const operacionais = rows.filter(
      (r) =>
        ['OPERACIONAL', 'ATENCAO'].includes(computeCompanyStatusGeral(r))
    ).length;

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
        value: certVencido,
        subtext: 'Renovar certificado',
        preset: { type: 'CERT_VENCIDO' },
      },
      {
        id: 'cred_validar',
        title: 'Credenciais para Validar',
        value: credValidar,
        subtext: 'Revalidar em 7 dias',
        preset: { type: 'CRED_VALIDAR' },
      },
      {
        id: 'operacionais',
        title: 'Operacionais',
        value: operacionais,
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
