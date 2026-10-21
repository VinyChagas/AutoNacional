/**
 * Cliente UDS para a CLI administrativa (health / status / preparar / liberar).
 */
import { createConnection } from 'node:net';
import { randomUUID } from 'node:crypto';
import { HomologacaoNfseError } from '../types';
import {
  ADMIN_IO_TIMEOUT_MS,
  ADMIN_MAX_MESSAGE_BYTES,
  ADMIN_PROTOCOL_VERSION,
} from './admin-config';
import type { AdminOp, AdminResponse } from './admin-protocolo';

export async function enviarComandoAdminUds(entrada: {
  socketPath: string;
  token: string;
  op: AdminOp;
  params?: Record<string, unknown>;
  timeoutMs?: number;
}): Promise<AdminResponse> {
  const timeoutMs = entrada.timeoutMs ?? ADMIN_IO_TIMEOUT_MS;
  const id = randomUUID().slice(0, 32);
  const corpo: Record<string, unknown> = {
    v: ADMIN_PROTOCOL_VERSION,
    op: entrada.op,
    token: entrada.token,
    id,
  };
  if (entrada.params && Object.keys(entrada.params).length > 0) {
    corpo.params = entrada.params;
  }
  const payload = `${JSON.stringify(corpo)}\n`;

  if (Buffer.byteLength(payload, 'utf8') > ADMIN_MAX_MESSAGE_BYTES) {
    throw new HomologacaoNfseError('CONTEXTO_INVALIDO', 'Payload admin excede limite.');
  }

  return new Promise<AdminResponse>((resolve, reject) => {
    const socket = createConnection(entrada.socketPath);
    const chunks: Buffer[] = [];
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
      fn();
    };

    const timer = setTimeout(() => {
      finish(() =>
        reject(new HomologacaoNfseError('TIMEOUT', 'Timeout no cliente admin UDS.'))
      );
    }, timeoutMs);

    socket.on('connect', () => {
      socket.write(payload);
    });

    socket.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const buf = Buffer.concat(chunks);
      if (buf.length > ADMIN_MAX_MESSAGE_BYTES) {
        finish(() =>
          reject(new HomologacaoNfseError('CONTEXTO_INVALIDO', 'Resposta admin excessiva.'))
        );
        return;
      }
      if (!buf.includes(0x0a)) return;
      try {
        const linha = buf.toString('utf8').trim().split('\n')[0] ?? '';
        const parsed = JSON.parse(linha) as AdminResponse;
        if (!parsed || typeof parsed !== 'object' || parsed.v !== ADMIN_PROTOCOL_VERSION) {
          throw new Error('resposta inválida');
        }
        finish(() => resolve(parsed));
      } catch {
        finish(() =>
          reject(new HomologacaoNfseError('CONTEXTO_INVALIDO', 'Resposta admin inválida.'))
        );
      }
    });

    socket.on('error', (erro) => {
      finish(() =>
        reject(
          new HomologacaoNfseError(
            'CONTEXTO_INVALIDO',
            `Falha de conexão admin: ${erro.message}`
          )
        )
      );
    });

    socket.on('end', () => {
      if (!settled && chunks.length === 0) {
        finish(() =>
          reject(new HomologacaoNfseError('CONTEXTO_INVALIDO', 'Conexão admin encerrada.'))
        );
      }
    });
  });
}
