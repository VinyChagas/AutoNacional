/**
 * Protocolo mínimo versionado do canal admin UDS.
 * Somente health | status nesta etapa.
 */
import {
  ADMIN_MAX_MESSAGE_BYTES,
  ADMIN_PROTOCOL_VERSION,
} from './admin-config';
import { HomologacaoNfseError } from '../types';

export const ADMIN_OPS = ['health', 'status'] as const;
export type AdminOp = (typeof ADMIN_OPS)[number];

export interface AdminRequest {
  readonly v: typeof ADMIN_PROTOCOL_VERSION;
  readonly op: AdminOp;
  readonly token: string;
  readonly id: string;
}

export interface AdminResponseOk {
  readonly v: typeof ADMIN_PROTOCOL_VERSION;
  readonly ok: true;
  readonly op: AdminOp;
  readonly id: string;
  readonly data: Record<string, unknown>;
}

export interface AdminResponseErro {
  readonly v: typeof ADMIN_PROTOCOL_VERSION;
  readonly ok: false;
  readonly op?: string;
  readonly id?: string;
  readonly codigo: string;
  readonly mensagem: string;
}

export type AdminResponse = AdminResponseOk | AdminResponseErro;

export function parseAdminRequest(raw: Buffer | string): AdminRequest {
  const texto = typeof raw === 'string' ? raw : raw.toString('utf8');
  if (Buffer.byteLength(texto, 'utf8') > ADMIN_MAX_MESSAGE_BYTES) {
    throw new HomologacaoNfseError('CONTEXTO_INVALIDO', 'Mensagem admin excede limite.');
  }
  const trimmed = texto.trim();
  if (!trimmed) {
    throw new HomologacaoNfseError('CONTEXTO_INVALIDO', 'Mensagem admin vazia.');
  }
  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    throw new HomologacaoNfseError('CONTEXTO_INVALIDO', 'JSON admin inválido.');
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new HomologacaoNfseError('CONTEXTO_INVALIDO', 'Envelope admin inválido.');
  }
  const rec = obj as Record<string, unknown>;
  if (rec.v !== ADMIN_PROTOCOL_VERSION) {
    throw new HomologacaoNfseError('CONTEXTO_INVALIDO', 'Versão de protocolo admin inválida.');
  }
  if (typeof rec.op !== 'string' || !(ADMIN_OPS as readonly string[]).includes(rec.op)) {
    throw new HomologacaoNfseError('CONTEXTO_INVALIDO', 'Comando admin desconhecido ou inválido.');
  }
  if (typeof rec.token !== 'string' || !rec.token) {
    throw new HomologacaoNfseError('CONTEXTO_INVALIDO', 'Token admin ausente.');
  }
  if (typeof rec.id !== 'string' || !rec.id.trim() || rec.id.length > 64) {
    throw new HomologacaoNfseError('CONTEXTO_INVALIDO', 'id de requisição inválido.');
  }
  // Rejeita campos perigosos / execução arbitrária.
  for (const proibido of ['cmd', 'shell', 'eval', 'script', 'exec', 'path']) {
    if (proibido in rec) {
      throw new HomologacaoNfseError('CONTEXTO_INVALIDO', 'Campo proibido na mensagem admin.');
    }
  }
  return {
    v: ADMIN_PROTOCOL_VERSION,
    op: rec.op as AdminOp,
    token: rec.token,
    id: rec.id.trim(),
  };
}

export function montarRespostaOk(
  op: AdminOp,
  id: string,
  data: Record<string, unknown>
): AdminResponseOk {
  return { v: ADMIN_PROTOCOL_VERSION, ok: true, op, id, data: sanitizarData(data) };
}

export function montarRespostaErro(
  codigo: string,
  mensagem: string,
  parcial?: { op?: string; id?: string }
): AdminResponseErro {
  return {
    v: ADMIN_PROTOCOL_VERSION,
    ok: false,
    op: parcial?.op,
    id: parcial?.id,
    codigo,
    mensagem: sanitizarTexto(mensagem),
  };
}

function sanitizarData(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (/senha|secret|token|password|pfx|cookie/i.test(k)) continue;
    if (typeof v === 'string') out[k] = sanitizarTexto(v);
    else if (typeof v === 'number' || typeof v === 'boolean' || v === null) out[k] = v;
    else if (typeof v === 'object' && v && !Array.isArray(v)) {
      out[k] = sanitizarData(v as Record<string, unknown>);
    }
  }
  return out;
}

function sanitizarTexto(texto: string): string {
  return texto
    .replace(/senha[=:\s]\S+/gi, 'senha=***')
    .replace(/token[=:\s]\S+/gi, 'token=***')
    .replace(/secret[=:\s]\S+/gi, 'secret=***')
    .slice(0, 200);
}
