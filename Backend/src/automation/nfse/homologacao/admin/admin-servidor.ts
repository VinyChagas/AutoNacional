/**
 * Servidor Unix Domain Socket administrativo.
 * Ops: health | status | preparar | liberar.
 * Não inicia Discovery/SEFIN/navegador no handler — liberar apenas enfileira via wire.
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
  executarAdminLiberar,
  executarAdminPreparar,
  handlersAdminPreparacaoLiberacaoAtivos,
} from './admin-handlers';
import {
  aplicarPermissoesSocket,
  caminhoSocketAdmin,
  prepararDiretorioAdminSocket,
  removerSocketOrfaoSeguro,
  removerSocketProprioNoShutdown,
  tokenAdminValido,
} from './admin-seguranca';

const logger = getLogger('homologacao-admin-uds');

const ADMIN_OPS_LIST = ['health', 'status', 'preparar', 'liberar'] as const;

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
      ops: ADMIN_OPS_LIST,
      discoverAutorizado: false,
      gateAberto: GATE_EXECUCAO_REAL_DISCOVERY_ONLY,
      handlersPreparacao: handlersAdminPreparacaoLiberacaoAtivos(),
    },
    'Canal admin UDS ativo'
  );

  return { socketPath, dir, fechar };
}

async function tratarConexao(socket: Socket, segredo: string): Promise<void> {
  socket.setTimeout(ADMIN_IO_TIMEOUT_MS);
  const chunks: Buffer[] = [];
  let total = 0;
  let respondido = false;
  let processando = false;

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
    if (respondido || processando) return;
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
    processando = true;
    void processarPedido(buf, segredo, responder);
  });

  socket.on('end', () => {
    if (!respondido && chunks.length === 0) {
      // conexão encerrada sem payload — silencioso
    }
  });
}

async function processarPedido(
  buf: Buffer,
  segredo: string,
  responder: (r: AdminResponse) => void
): Promise<void> {
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
          adminOps: [...ADMIN_OPS_LIST],
          prepararLiberar: true,
          handlersRegistrados: handlersAdminPreparacaoLiberacaoAtivos(),
          discoverNoAdmin: false,
          sefin: false,
          pid: process.pid,
        })
      );
      return;
    }
    if (req.op === 'preparar') {
      const data = await executarAdminPreparar(req.params ?? {});
      responder(montarRespostaOk('preparar', req.id, data));
      return;
    }
    if (req.op === 'liberar') {
      const data = await executarAdminLiberar(req.params ?? {});
      responder(montarRespostaOk('liberar', req.id, data));
      return;
    }
    responder(montarRespostaErro('CONTEXTO_INVALIDO', 'Comando desconhecido.', { id: req.id }));
  } catch (erro) {
    const codigo =
      erro instanceof HomologacaoNfseError ? erro.codigo : 'CONTEXTO_INVALIDO';
    const mensagem = erro instanceof Error ? erro.message : 'Falha admin';
    responder(montarRespostaErro(codigo, mensagem));
  }
}
