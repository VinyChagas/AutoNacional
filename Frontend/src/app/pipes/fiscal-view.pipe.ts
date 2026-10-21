import { Pipe, PipeTransform } from '@angular/core';
import type { ExecutionRow } from '../models/execution-row.model';
import {
  mapearVisaoFiscal,
  type VisaoFiscalLinha,
} from '../models/execution-fiscal-view.model';

/** UI-01d — deriva visão fiscal da linha (pipe puro). */
@Pipe({ name: 'fiscalView', standalone: true, pure: true })
export class FiscalViewPipe implements PipeTransform {
  transform(row: ExecutionRow | null | undefined): VisaoFiscalLinha | null {
    if (!row) return null;
    return mapearVisaoFiscal(row);
  }
}
