/**
 * Lock exclusivo por CNPJ + ambiente para sincronização ADN.
 * Fail-fast (não enfileira). Sem worker/fila adicional.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { AmbienteAdn } from './endpoints';
import { ErroAdn } from './errors';
import { escreverArquivoAtomico } from './fs-atomic';

export interface SyncLockAdn {
  adquirir(cnpj: string, ambiente: AmbienteAdn): Promise<() => void>;
}

function normalizarCnpj(cnpj: string): string {
  const d = cnpj.replace(/\D/g, '');
  if (!/^\d{14}$/.test(d)) {
    throw new ErroAdn('CNPJ_INVALIDO', 'PERMANENTE', 'CNPJ inválido para lock ADN.');
  }
  return d;
}

function chaveLock(cnpj: string, ambiente: AmbienteAdn): string {
  return `${normalizarCnpj(cnpj)}|${ambiente}`;
}

/** Lock em memória — serializa no mesmo processo; segundo acquire falha. */
export class SyncLockMemoriaAdn implements SyncLockAdn {
  private readonly ativos = new Set<string>();

  async adquirir(cnpj: string, ambiente: AmbienteAdn): Promise<() => void> {
    const k = chaveLock(cnpj, ambiente);
    if (this.ativos.has(k)) {
      throw new ErroAdn(
        'SYNC_EM_ANDAMENTO',
        'BLOQUEANTE',
        `Sincronização ADN já em andamento para ${k}.`
      );
    }
    this.ativos.add(k);
    let liberado = false;
    return () => {
      if (liberado) return;
      liberado = true;
      this.ativos.delete(k);
    };
  }
}

interface LockPayload {
  pid: number;
  criadoEm: string;
  cnpj: string;
  ambiente: AmbienteAdn;
}

/**
 * Lock em arquivo (O_EXCL / wx).
 * Detecta stale por idade ou PID morto (quando possível).
 */
export class SyncLockArquivoAdn implements SyncLockAdn {
  constructor(
    private readonly diretorio: string,
    private readonly staleMs = 60 * 60 * 1000
  ) {
    fs.mkdirSync(this.diretorio, { recursive: true, mode: 0o700 });
  }

  private lockPath(cnpj: string, ambiente: AmbienteAdn): string {
    const safe = normalizarCnpj(cnpj);
    if (ambiente !== 'producao' && ambiente !== 'producao-restrita') {
      throw new ErroAdn('AMBIENTE_INVALIDO', 'PERMANENTE', 'Ambiente ADN inválido para lock.');
    }
    return path.join(this.diretorio, `${safe}-${ambiente}.lock`);
  }

  private tentarRemoverStale(file: string): void {
    if (!fs.existsSync(file)) return;
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as LockPayload;
      const idade = Date.now() - Date.parse(raw.criadoEm || '');
      const pidMorto =
        typeof raw.pid === 'number' &&
        raw.pid > 0 &&
        raw.pid !== process.pid &&
        (() => {
          try {
            process.kill(raw.pid, 0);
            return false;
          } catch {
            return true;
          }
        })();
      if (pidMorto || (Number.isFinite(idade) && idade > this.staleMs)) {
        fs.unlinkSync(file);
      }
    } catch {
      // Lock ilegível: remove para não bloquear indefinidamente.
      try {
        fs.unlinkSync(file);
      } catch {
        /* ignore */
      }
    }
  }

  async adquirir(cnpj: string, ambiente: AmbienteAdn): Promise<() => void> {
    const file = this.lockPath(cnpj, ambiente);
    this.tentarRemoverStale(file);

    let fd: number;
    try {
      fd = fs.openSync(file, 'wx', 0o600);
    } catch (erro) {
      const code = (erro as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') {
        throw new ErroAdn(
          'SYNC_EM_ANDAMENTO',
          'BLOQUEANTE',
          `Sincronização ADN já em andamento (lock arquivo) para ${normalizarCnpj(cnpj)}|${ambiente}.`
        );
      }
      throw erro;
    }

    const payload: LockPayload = {
      pid: process.pid,
      criadoEm: new Date().toISOString(),
      cnpj: normalizarCnpj(cnpj),
      ambiente,
    };
    try {
      fs.writeFileSync(fd, JSON.stringify(payload, null, 2), { encoding: 'utf8' });
    } finally {
      fs.closeSync(fd);
    }

    let liberado = false;
    return () => {
      if (liberado) return;
      liberado = true;
      try {
        fs.unlinkSync(file);
      } catch {
        /* ignore */
      }
    };
  }
}

/**
 * Combina lock de memória (mesmo processo) + arquivo (cross-process).
 */
export class SyncLockCompostoAdn implements SyncLockAdn {
  private readonly memoria = new SyncLockMemoriaAdn();

  constructor(private readonly arquivo: SyncLockArquivoAdn) {}

  async adquirir(cnpj: string, ambiente: AmbienteAdn): Promise<() => void> {
    const liberarMem = await this.memoria.adquirir(cnpj, ambiente);
    try {
      const liberarArq = await this.arquivo.adquirir(cnpj, ambiente);
      return () => {
        try {
          liberarArq();
        } finally {
          liberarMem();
        }
      };
    } catch (erro) {
      liberarMem();
      throw erro;
    }
  }
}

/** Utilitário de teste: grava lock stale artificial. */
export function gravarLockStaleParaTeste(
  diretorio: string,
  cnpj: string,
  ambiente: AmbienteAdn,
  criadoEm: string,
  pid = 999_999_999
): string {
  const safe = cnpj.replace(/\D/g, '');
  const file = path.join(diretorio, `${safe}-${ambiente}.lock`);
  escreverArquivoAtomico(
    file,
    JSON.stringify({ pid, criadoEm, cnpj: safe, ambiente }, null, 2)
  );
  return file;
}
