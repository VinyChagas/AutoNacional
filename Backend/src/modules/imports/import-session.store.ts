/**
 * Armazenamento temporário de arquivos de certificados para o fluxo Preview + Confirmar.
 * Mantém em disco para sobreviver entre requests.
 */
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type { PreviewCertAction } from './import-certificados-classify';

const BASE = path.join(process.cwd(), 'temp', 'import-sessions');
const TTL_MS = 60 * 60 * 1000; // 1 hora

export interface StoredCertFile {
  buffer: Buffer;
  originalName: string;
}

export interface SessionPreviewMetaItem {
  indice: number;
  action: PreviewCertAction;
  can_confirm: boolean;
  cnpj: string;
  existing_cert_id: number | null;
  existing_arquivo: string | null;
  incoming_thumbprint: string | null;
  incoming_serial: string | null;
  incoming_valid_until: string | null;
  existing_valid_until: string | null;
  days_delta: number | null;
  message: string;
}

interface SessionMeta {
  preview: SessionPreviewMetaItem[];
  processed: number[];
}

function sessionDir(sessionId: string): string {
  return path.join(BASE, sessionId);
}

function metaPath(sessionId: string): string {
  return path.join(sessionDir(sessionId), 'meta.json');
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

function touchSession(sessionId: string): void {
  const dir = sessionDir(sessionId);
  try {
    const now = new Date();
    fs.utimesSync(dir, now, now);
  } catch {
    // ignorar
  }
}

function assertSessionAlive(sessionId: string): void {
  const dir = sessionDir(sessionId);
  if (!fs.existsSync(dir)) {
    throw new Error('Sessão de importação expirada ou inválida');
  }
  if (isExpired(dir)) {
    destroySession(sessionId);
    throw new Error('Sessão de importação expirada');
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
  saveSessionMeta(sessionId, { preview: [], processed: [] });
  return sessionId;
}

export function getSessionFiles(sessionId: string): StoredCertFile[] {
  assertSessionAlive(sessionId);
  touchSession(sessionId);
  const dir = sessionDir(sessionId);
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

export function saveSessionMeta(sessionId: string, meta: SessionMeta): void {
  assertSessionAlive(sessionId);
  fs.writeFileSync(metaPath(sessionId), JSON.stringify(meta), 'utf8');
  touchSession(sessionId);
}

export function loadSessionMeta(sessionId: string): SessionMeta {
  assertSessionAlive(sessionId);
  const fp = metaPath(sessionId);
  if (!fs.existsSync(fp)) {
    return { preview: [], processed: [] };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(fp, 'utf8')) as SessionMeta;
    return {
      preview: Array.isArray(raw.preview) ? raw.preview : [],
      processed: Array.isArray(raw.processed) ? raw.processed : [],
    };
  } catch {
    return { preview: [], processed: [] };
  }
}

export function markIndicesProcessed(sessionId: string, indices: number[]): void {
  const meta = loadSessionMeta(sessionId);
  const set = new Set(meta.processed);
  for (const i of indices) set.add(i);
  meta.processed = [...set].sort((a, b) => a - b);
  saveSessionMeta(sessionId, meta);
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
