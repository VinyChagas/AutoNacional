/**
 * Checkpoint de cursor NSU isolado por CNPJ + ambiente.
 * Persistência injetável (memória ou filesystem) — sem Prisma/worker.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { AmbienteAdn } from './endpoints';
import type { CheckpointDistribuicaoAdn, StatusSyncAdn } from './types';

export interface PersistenciaCheckpointAdn {
  ler(cnpj: string, ambiente: AmbienteAdn): CheckpointDistribuicaoAdn | null;
  gravar(checkpoint: CheckpointDistribuicaoAdn): void;
}

export class CheckpointStoreMemoria implements PersistenciaCheckpointAdn {
  private readonly mapa = new Map<string, CheckpointDistribuicaoAdn>();

  private chave(cnpj: string, ambiente: AmbienteAdn): string {
    return `${cnpj.replace(/\D/g, '')}|${ambiente}`;
  }

  ler(cnpj: string, ambiente: AmbienteAdn): CheckpointDistribuicaoAdn | null {
    return this.mapa.get(this.chave(cnpj, ambiente)) ?? null;
  }

  gravar(checkpoint: CheckpointDistribuicaoAdn): void {
    this.mapa.set(this.chave(checkpoint.cnpj, checkpoint.ambiente), { ...checkpoint });
  }
}

export class CheckpointStoreArquivo implements PersistenciaCheckpointAdn {
  constructor(private readonly diretorio: string) {}

  private filePath(cnpj: string, ambiente: AmbienteAdn): string {
    const safe = cnpj.replace(/\D/g, '');
    return path.join(this.diretorio, `${safe}-${ambiente}.json`);
  }

  ler(cnpj: string, ambiente: AmbienteAdn): CheckpointDistribuicaoAdn | null {
    const file = this.filePath(cnpj, ambiente);
    if (!fs.existsSync(file)) return null;
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')) as CheckpointDistribuicaoAdn;
    } catch {
      return null;
    }
  }

  gravar(checkpoint: CheckpointDistribuicaoAdn): void {
    fs.mkdirSync(this.diretorio, { recursive: true });
    const file = this.filePath(checkpoint.cnpj, checkpoint.ambiente);
    fs.writeFileSync(file, JSON.stringify(checkpoint, null, 2), { mode: 0o600 });
  }
}

export function commitCheckpointAposLote(
  store: PersistenciaCheckpointAdn,
  params: {
    cnpj: string;
    ambiente: AmbienteAdn;
    cursorConfirmado: number;
    lotesProcessados: number;
    documentosProcessados: number;
    nsuInicialSessao: number;
    status: StatusSyncAdn;
    motivoParada?: string;
    fimDistribuicaoConfirmado: boolean;
  }
): CheckpointDistribuicaoAdn {
  const next: CheckpointDistribuicaoAdn = {
    cnpj: params.cnpj.replace(/\D/g, ''),
    ambiente: params.ambiente,
    ultimoNsuConfirmado: params.cursorConfirmado,
    nsuInicialSessao: params.nsuInicialSessao,
    lotesProcessados: params.lotesProcessados,
    documentosProcessados: params.documentosProcessados,
    status: params.status,
    atualizadoEm: new Date().toISOString(),
    motivoParada: params.motivoParada,
    fimDistribuicaoConfirmado: params.fimDistribuicaoConfirmado,
  };
  store.gravar(next);
  return next;
}
