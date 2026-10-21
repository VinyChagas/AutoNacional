/**
 * Checkpoint de cursor NSU isolado por CNPJ + ambiente.
 * Escrita atômica + validação estrutural — sem Prisma/worker.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { AmbienteAdn } from './endpoints';
import { ErroAdn } from './errors';
import { escreverArquivoAtomico } from './fs-atomic';
import type { CheckpointDistribuicaoAdn, StatusSyncAdn } from './types';

export interface PersistenciaCheckpointAdn {
  ler(cnpj: string, ambiente: AmbienteAdn): CheckpointDistribuicaoAdn | null;
  gravar(checkpoint: CheckpointDistribuicaoAdn): void;
}

const STATUS_VALIDOS: ReadonlySet<string> = new Set([
  'COMPLETO',
  'PARCIAL',
  'ERRO',
  'NAO_INICIADO',
]);

export function validarCheckpointAdn(raw: unknown): CheckpointDistribuicaoAdn {
  if (!raw || typeof raw !== 'object') {
    throw new ErroAdn('CHECKPOINT_INVALIDO', 'BLOQUEANTE', 'Checkpoint ADN não é objeto.');
  }
  const o = raw as Record<string, unknown>;
  const cnpj = typeof o.cnpj === 'string' ? o.cnpj.replace(/\D/g, '') : '';
  if (!/^\d{14}$/.test(cnpj)) {
    throw new ErroAdn('CHECKPOINT_INVALIDO', 'BLOQUEANTE', 'Checkpoint ADN com CNPJ inválido.');
  }
  if (o.ambiente !== 'producao' && o.ambiente !== 'producao-restrita') {
    throw new ErroAdn('CHECKPOINT_INVALIDO', 'BLOQUEANTE', 'Checkpoint ADN com ambiente inválido.');
  }
  if (typeof o.ultimoNsuConfirmado !== 'number' || !Number.isFinite(o.ultimoNsuConfirmado) || o.ultimoNsuConfirmado < 0) {
    throw new ErroAdn('CHECKPOINT_INVALIDO', 'BLOQUEANTE', 'Checkpoint ADN com NSU inválido.');
  }
  if (typeof o.lotesProcessados !== 'number' || o.lotesProcessados < 0) {
    throw new ErroAdn('CHECKPOINT_INVALIDO', 'BLOQUEANTE', 'Checkpoint ADN com lotesProcessados inválido.');
  }
  if (typeof o.documentosProcessados !== 'number' || o.documentosProcessados < 0) {
    throw new ErroAdn(
      'CHECKPOINT_INVALIDO',
      'BLOQUEANTE',
      'Checkpoint ADN com documentosProcessados inválido.'
    );
  }
  if (typeof o.status !== 'string' || !STATUS_VALIDOS.has(o.status)) {
    throw new ErroAdn('CHECKPOINT_INVALIDO', 'BLOQUEANTE', 'Checkpoint ADN com status inválido.');
  }
  if (typeof o.atualizadoEm !== 'string' || !o.atualizadoEm) {
    throw new ErroAdn('CHECKPOINT_INVALIDO', 'BLOQUEANTE', 'Checkpoint ADN sem atualizadoEm.');
  }
  if (typeof o.fimDistribuicaoConfirmado !== 'boolean') {
    throw new ErroAdn(
      'CHECKPOINT_INVALIDO',
      'BLOQUEANTE',
      'Checkpoint ADN sem fimDistribuicaoConfirmado.'
    );
  }

  return {
    cnpj,
    ambiente: o.ambiente,
    ultimoNsuConfirmado: o.ultimoNsuConfirmado,
    nsuInicialSessao:
      typeof o.nsuInicialSessao === 'number' ? o.nsuInicialSessao : undefined,
    lotesProcessados: o.lotesProcessados,
    documentosProcessados: o.documentosProcessados,
    status: o.status as StatusSyncAdn,
    atualizadoEm: o.atualizadoEm,
    motivoParada: typeof o.motivoParada === 'string' ? o.motivoParada : undefined,
    fimDistribuicaoConfirmado: o.fimDistribuicaoConfirmado,
  };
}

export class CheckpointStoreMemoria implements PersistenciaCheckpointAdn {
  private readonly mapa = new Map<string, CheckpointDistribuicaoAdn>();

  private chave(cnpj: string, ambiente: AmbienteAdn): string {
    return `${cnpj.replace(/\D/g, '')}|${ambiente}`;
  }

  ler(cnpj: string, ambiente: AmbienteAdn): CheckpointDistribuicaoAdn | null {
    const v = this.mapa.get(this.chave(cnpj, ambiente));
    return v ? { ...v } : null;
  }

  gravar(checkpoint: CheckpointDistribuicaoAdn): void {
    const validado = validarCheckpointAdn(checkpoint);
    this.mapa.set(this.chave(validado.cnpj, validado.ambiente), { ...validado });
  }
}

export class CheckpointStoreArquivo implements PersistenciaCheckpointAdn {
  constructor(private readonly diretorio: string) {
    fs.mkdirSync(this.diretorio, { recursive: true, mode: 0o700 });
  }

  private filePath(cnpj: string, ambiente: AmbienteAdn): string {
    const safe = cnpj.replace(/\D/g, '');
    if (!/^\d{14}$/.test(safe)) {
      throw new ErroAdn('CNPJ_INVALIDO', 'PERMANENTE', 'CNPJ inválido para checkpoint ADN.');
    }
    if (ambiente !== 'producao' && ambiente !== 'producao-restrita') {
      throw new ErroAdn('AMBIENTE_INVALIDO', 'PERMANENTE', 'Ambiente ADN inválido.');
    }
    return path.join(this.diretorio, `${safe}-${ambiente}.json`);
  }

  ler(cnpj: string, ambiente: AmbienteAdn): CheckpointDistribuicaoAdn | null {
    const file = this.filePath(cnpj, ambiente);
    if (!fs.existsSync(file)) return null;
    let rawText: string;
    try {
      rawText = fs.readFileSync(file, 'utf8');
    } catch {
      throw new ErroAdn(
        'CHECKPOINT_ILEGIVEL',
        'BLOQUEANTE',
        'Não foi possível ler o checkpoint ADN.'
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      throw new ErroAdn(
        'CHECKPOINT_CORROMPIDO',
        'BLOQUEANTE',
        'Checkpoint ADN com JSON inválido — não reinicia cursor automaticamente.'
      );
    }
    return validarCheckpointAdn(parsed);
  }

  gravar(checkpoint: CheckpointDistribuicaoAdn): void {
    const validado = validarCheckpointAdn(checkpoint);
    const file = this.filePath(validado.cnpj, validado.ambiente);
    const bak = `${file}.bak`;
    if (fs.existsSync(file)) {
      try {
        fs.copyFileSync(file, bak);
      } catch {
        /* best-effort */
      }
    }
    escreverArquivoAtomico(file, JSON.stringify(validado, null, 2), 0o600);
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
