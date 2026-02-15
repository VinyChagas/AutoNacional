/**
 * Armazenamento temporário de arquivos de certificados para o fluxo Preview + Confirmar.
 * Mantém em disco para sobreviver entre requests.
 */
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

const BASE = path.join(process.cwd(), 'temp', 'import-sessions');
const TTL_MS = 60 * 60 * 1000; // 1 hora

export interface StoredCertFile {
  buffer: Buffer;
  originalName: string;
}

function sessionDir(sessionId: string): string {
  return path.join(BASE, sessionId);
}

function ensureBase(): void {
  if (!fs.existsSync(BASE)) {
    fs.mkdirSync(BASE, { recursive: true });
  }
}

function isExpired(dir: string): boolean {
  try {
    const stat = fs.statSync(dir);
    return Date.now() - stat.mtimeMs > TTL_MS;
  } catch {
    return true;
  }
}

export function createSession(files: Express.Multer.File[]): string {
  ensureBase();
  const sessionId = randomUUID();
  const dir = sessionDir(sessionId);
  fs.mkdirSync(dir, { recursive: true });
  files.forEach((f, i) => {
    if (f.buffer?.length) {
      const ext = (f.originalname || '').toLowerCase().endsWith('.p12') ? '.p12' : '.pfx';
      fs.writeFileSync(path.join(dir, `${i}${ext}`), f.buffer);
    }
  });
  return sessionId;
}

export function getSessionFiles(sessionId: string): StoredCertFile[] {
  const dir = sessionDir(sessionId);
  if (!fs.existsSync(dir)) {
    throw new Error('Sessão de importação expirada ou inválida');
  }
  if (isExpired(dir)) {
    destroySession(sessionId);
    throw new Error('Sessão de importação expirada');
  }
  const files: StoredCertFile[] = [];
  const entries = fs.readdirSync(dir).sort((a, b) => {
    const na = parseInt(a.replace(/\D/g, ''), 10);
    const nb = parseInt(b.replace(/\D/g, ''), 10);
    return na - nb;
  });
  for (const e of entries) {
    if (e.endsWith('.pfx') || e.endsWith('.p12')) {
      const fp = path.join(dir, e);
      const buffer = fs.readFileSync(fp);
      files.push({ buffer, originalName: e });
    }
  }
  return files;
}

export function destroySession(sessionId: string): void {
  const dir = sessionDir(sessionId);
  try {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true });
    }
  } catch {
    // ignorar
  }
}

/**
 * Remove sessões expiradas.
 */
export function cleanupExpired(): void {
  try {
    if (!fs.existsSync(BASE)) return;
    for (const name of fs.readdirSync(BASE)) {
      const dir = path.join(BASE, name);
      if (isExpired(dir)) {
        try {
          fs.rmSync(dir, { recursive: true });
        } catch {
          // ignorar
        }
      }
    }
  } catch {
    // ignorar
  }
}
