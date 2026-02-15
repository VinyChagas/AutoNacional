/**
 * Cliente Prisma singleton.
 * Conecta ao PostgreSQL (Supabase) via adapter @prisma/adapter-pg.
 * Prisma 7 exige adapter ou accelerateUrl para engine type "client".
 */
import { PrismaClient } from '@prisma/client';
export declare const prisma: PrismaClient<import(".prisma/client").Prisma.PrismaClientOptions, never, import("@prisma/client/runtime/client").DefaultArgs>;
/**
 * Inicializa a conexão com o banco de dados.
 * Cliente de conexão com o banco de dados.
 */
export declare function initDb(): Promise<void>;
/**
 * Desconecta do banco de dados (útil para encerramento gracioso).
 */
export declare function disconnectDb(): Promise<void>;
//# sourceMappingURL=client.d.ts.map