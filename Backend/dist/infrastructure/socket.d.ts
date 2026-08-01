/**
 * Inicialização do Socket.IO para a Central Manual de Captchas.
 * Mantém o SSE de execução intacto.
 */
import type { Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';
export declare function initSocketIo(httpServer: HttpServer): SocketServer;
//# sourceMappingURL=socket.d.ts.map