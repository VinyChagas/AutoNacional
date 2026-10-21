/**
 * Servidor Unix Domain Socket administrativo (health/status).
 * Não enfileira, não descoberta, não SEFIN.
 */
import { createServer, type Server, type Socket } from 'node:net';
import { getLogger } from '../../../../infrastructure/logger';
import { HomologacaoNfseError } from '../types';
import { obterCanalHomologacaoOperacional } from '../canal-autorizacao';
import { GATE_EXECUCAO_REAL_DISCOVERY_ONLY } from '../gate-execucao-real';
import {
  ADMIN_IO_TIMEOUT_MS,
  ADMIN_MAX_MESSAGE_BYTES,
  ADMIN_PROTOCOL_VERSION,
} from './admin-config';
import {
  montarRespostaErro,
  montarRespostaOk,
  parseAdminRequest,
  type AdminResponse,
} from './admin-protocolo';
import {
  aplicarPermissoesSocket,
  caminhoSocketAdmin,
  prepararDiretorioAdminSocket,
  removerSocketOrfaoSeguro,
  removerSocketProprioNoShutdown,
  tokenAdminValido,
} from './admin-seguranca';

const logger = getLogger('homologacao-admin-uds');

export interface AdminServidorAtivo {
  readonly socketPath: string;
  readonly dir: string;
  fechar(): Promise<void>;
}

export async function iniciarAdminServidorUds(entrada: {
  socketDir: string;
  segredo: string;
}): Promise<AdminServidorAtivo> {
  const dir = await prepararDiretorioAdminSocket(entrada.socketDir);
  const socketPath = caminhoSocketAdmin(dir);
  await removerSocketOrfaoSeguro(socketPath);

  const segredo = entrada.segredo;
  let server: Server | null = null;

  const fechar = async (): Promise<void> => {
    const srv = server;
    server = null;
    if (!srv) return;
    await new Promise<void>((resolve) => {
      srv.close(() => resolve());
    });
    await removerSocketProprioNoShutdown(socketPath);
    logger.info({ socketPath }, 'Canal admin UDS encerrado');
  };

  server = createServer((socket) => {
    void tratarConexao(socket, segredo);
  });

  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject);
    server!.listen(socketPath, () => resolve());
  });

  try {
    await aplicarPermissoesSocket(socketPath);
  } catch (erro) {
    await fechar();
    throw erro;
  }

  logger.info(
    {
      socketPath,
      protocolo: ADMIN_PROTOCOL_VERSION,
      ops: ['health', 'status'],
      discoverAutorizado: false,
      gateAberto: GATE_EXECUCAO_REAL_DISCOVERY_ONLY,
    },
    'Canal admin UDS ativo (somente diagnóstico)'
  );

  return { socketPath, dir, fechar };
}

async function tratarConexao(socket: Socket, segredo: string): Promise<void> {
  socket.setTimeout(ADMIN_IO_TIMEOUT_MS);
  const chunks: Buffer[] = [];
  let total = 0;
  let respondido = false;

  const responder = (resposta: AdminResponse) => {
    if (respondido || socket.destroyed) return;
    respondido = true;
    try {
      socket.end(`${JSON.stringify(resposta)}\n`);
    } catch {
      socket.destroy();
    }
  };

  socket.on('timeout', () => {
    responder(montarRespostaErro('TIMEOUT', 'Timeout na conexão admin.'));
    socket.destroy();
  });

  socket.on('error', () => {
    socket.destroy();
  });

  socket.on('data', (chunk) => {
    const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += piece.length;
    if (total > ADMIN_MAX_MESSAGE_BYTES) {
      responder(montarRespostaErro('CONTEXTO_INVALIDO', 'Mensagem admin excede limite.'));
      socket.destroy();
      return;
    }
    chunks.push(piece);
    const buf = Buffer.concat(chunks);
    if (!buf.includes(0x0a) && buf.length < ADMIN_MAX_MESSAGE_BYTES) {
      return;
    }
    try {
      const req = parseAdminRequest(buf);
      if (!tokenAdminValido(req.token, segredo)) {
        responder(
          montarRespostaErro('CONTEXTO_INVALIDO', 'Cliente admin não autorizado.', {
            op: req.op,
            id: req.id,
          })
        );
        return;
      }
      if (req.op === 'health') {
        responder(
          montarRespostaOk('health', req.id, {
            status: 'ok',
            protocolo: ADMIN_PROTOCOL_VERSION,
            pid: process.pid,
          })
        );
        return;
      }
      if (req.op === 'status') {
        const canal = obterCanalHomologacaoOperacional();
        responder(
          montarRespostaOk('status', req.id, {
            canalHomologacao: canal ? 'configurado' : 'ausente',
            gateExecucaoReal: GATE_EXECUCAO_REAL_DISCOVERY_ONLY,
            adminOps: ['health', 'status'],
            prepararLiberar: false,
            discoverNoAdmin: false,
            sefin: false,
            pid: process.pid,
          })
        );
        return;
      }
      responder(montarRespostaErro('CONTEXTO_INVALIDO', 'Comando desconhecido.', { id: req.id }));
    } catch (erro) {
      const codigo =
        erro instanceof HomologacaoNfseError ? erro.codigo : 'CONTEXTO_INVALIDO';
      const mensagem = erro instanceof Error ? erro.message : 'Falha admin';
      responder(montarRespostaErro(codigo, mensagem));
    }
  });

  socket.on('end', () => {
    if (!respondido && chunks.length === 0) {
      // conexão encerrada sem payload — silencioso
    }
  });
}
